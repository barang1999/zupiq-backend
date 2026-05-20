import { Content, Part, Type } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { normalizeDiagramBlocks } from "../../utils/diagram-blocks.js";
import { buildMathBlocks, buildRenderBlocks, type RenderBlock } from "../../utils/render-blocks.js";
import { getGeminiClient } from "./core/client.js";
import { buildSystemInstruction, LANGUAGE_NAMES } from "./core/system-instruction.js";
import type { AIRequestOptions } from "./core/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface ChatUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number;
  source: "provider" | "estimate";
}

export interface ChatResult {
  text: string;
  usage: ChatUsage;
  finishReason?: string;
  visualTable?: any;
}

export type { AIRequestOptions } from "./core/types.js";

export interface ImagePart {
  data: string; // base64
  mimeType: string;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function coerceTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function estimateTokenCount(text: string): number {
  const normalized = (text ?? "").trim();
  if (!normalized) return 0;
  // Practical approximation for LLM tokens across mixed-language text.
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function extractProviderUsage(response: unknown): Omit<ChatUsage, "source"> | null {
  const candidate = response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    response?: {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
  };

  const usage = candidate.usageMetadata ?? candidate.response?.usageMetadata;
  if (!usage) return null;

  const promptTokens = coerceTokenCount(usage.promptTokenCount);
  const completionTokens = coerceTokenCount(usage.candidatesTokenCount);
  const totalFromProvider = coerceTokenCount(usage.totalTokenCount);
  const totalTokens = totalFromProvider
    ?? ((promptTokens ?? 0) + (completionTokens ?? 0));

  if (totalTokens <= 0) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function estimateChatUsage(messages: ChatMessage[], responseText: string): ChatUsage {
  const inputText = messages.map((m) => m.content ?? "").join("\n");
  const promptTokens = estimateTokenCount(inputText);
  const completionTokens = estimateTokenCount(responseText ?? "");
  const totalTokens = Math.max(1, promptTokens + completionTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    source: "estimate",
  };
}

/** Keywords that indicate the user is asking for a table in the chat. */
const TABLE_REQUEST_PATTERN = /\b(table|sign\s*analysis|tableau|sign\s*chart|generate\s*a\s*table|fill\s*(the\s*)?.*table|តារាង|bảng)/i;

export async function chat(
  messages: ChatMessage[],
  options: AIRequestOptions = {},
  imagePart?: ImagePart
): Promise<ChatResult> {
  const client = getGeminiClient();

  const history: Content[] = messages.slice(0, -1).map((m) => ({
    role: m.role,
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  // Detect whether this message is asking for a sign/visual table.
  // If so, we handle it with a dedicated structured call after the conversational reply,
  // rather than asking the model to embed JSON in its prose (which is unreliable).
  const wantsTable = TABLE_REQUEST_PATTERN.test(lastMessage.content);

  const chatSession = client.chats.create({
    model: env.GEMINI_MODEL,
    config: {
      systemInstruction: buildSystemInstruction(options),
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
    history,
  });

  const parts: Part[] = [{ text: lastMessage.content }];
  if (imagePart) {
    parts.unshift({
      inlineData: {
        data: imagePart.data,
        mimeType: imagePart.mimeType,
      },
    });
  }

  const response = await chatSession.sendMessage({ message: parts });
  const text = (response.text ?? "").trim();
  const providerUsage = extractProviderUsage(response);
  const finishReason = extractFinishReason(response);

  // If the user asked for a table, generate it as a separate structured call
  // using responseMimeType + responseSchema so the output is always valid JSON.
  let visualTable: any = undefined;
  if (wantsTable) {
    const subject = options.subject ?? "General";
    // Build the problem description from the recent conversation context (last few turns)
    const contextMessages = messages.slice(-4);
    const problem = contextMessages.map((m) => m.content).join("\n");
    visualTable = await generateVisualTable(problem, subject, options, imagePart).catch(() => null);
  }

  const usage: ChatUsage = providerUsage
    ? { ...providerUsage, source: "provider" }
    : estimateChatUsage(messages, text);

  return { text, usage, finishReason, visualTable };
}

// ─── Explain a concept ────────────────────────────────────────────────────────

export async function explainConcept(
  concept: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const prompt = `Explain the following concept clearly and concisely: "${concept}"

  Structure your response with:
  1. A simple definition
  2. Key points / formula (if applicable)
  3. A practical example
  4. A common misconception to avoid`;

  return generateText(prompt, options);
}

// ─── Solve a problem ─────────────────────────────────────────────────────────

export async function solveProblem(
  problem: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const prompt = `Solve the following problem step by step: "${problem}"

  Show all working clearly. After solving, briefly explain the key concept used.`;

  return generateText(prompt, options);
}

// ─── Give a hint ──────────────────────────────────────────────────────────────

export async function giveHint(
  problem: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const prompt = `Give me a helpful hint (NOT the full solution) for this problem: "${problem}"

  The hint should guide the student toward the approach without giving away the answer.`;

  return generateText(prompt, options);
}

// ─── Summarize content ────────────────────────────────────────────────────────

export async function summarizeContent(
  content: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const prompt = `Summarize the following educational content into key points:

${content}

Format as:
- Main topic
- Key concepts (bullet points)
- Important formulas or rules (if any)
- Summary paragraph`;

  return generateText(prompt, options);
}

// ─── Breakdown a problem into a neural tree ───────────────────────────────────

export interface BreakdownNode {
  id: string;
  type: 'root' | 'branch' | 'leaf';
  label: string;
  description: string;
  mathContent?: string;
  keyFormula?: string;
  labelBlocks?: RenderBlock[];
  descriptionBlocks?: RenderBlock[];
  mathBlocks?: RenderBlock[];
  parentId?: string;
  tags?: string[];
}

export interface ProblemBreakdown {
  title: string;
  subject: string;
  topic?: string;
  nodes: BreakdownNode[];
  insights: {
    simpleBreakdown: string;
    keyFormula: string;
  };
}

export interface ProblemSolutionFirst {
  version: 2 | 3;
  mode: "solution-first";
  title: string;
  subject: string;
  topic?: string;
  problem: string;
  finalAnswer: string;
  solutionText: string;
  solutionFormat: "markdown-latex";
  solutionBlocks?: RenderBlock[];
  finalAnswerBlocks?: RenderBlock[];
  diagramBlocks?: RenderBlock[];
  explanationStatus: "not_generated" | "generated";
  explanation?: {
    nodes: BreakdownNode[];
  } | null;
  insights?: {
    simpleBreakdown: string;
    keyFormula: string;
  };
}

interface JsonGenerationConfig<T> {
  prompt: string;
  options: AIRequestOptions;
  temperature: number;
  maxOutputTokens: number;
  taskName: string;
  maxAttempts?: number;
  recoverFromRaw?: (raw: string) => T | null;
  imagePart?: ImagePart;
  /** When true, do not set responseMimeType=application/json — avoids truncation for complex outputs */
  noJsonMime?: boolean;
  /** Optional JSON Schema passed to responseSchema for constrained structured output */
  responseSchema?: object;
}

type StructuredJsonSource = "parsed" | "recovered" | "none";

const GENERIC_BREAKDOWN_STEP_PATTERN = /(known values|target unknown|governing formula|problem relationship|substitute -> simplify|ទិន្នន័យដែលមាន|អថេរត្រូវរក|ប្រើទំនាក់ទំនងដើម្បីគណនា|ជំនួស -> សម្រួល)/i;
const FRACTION_PLACEHOLDER_PATTERN = /[☒□▢☐]\s*\((.*?)\)\s*\/\s*\(([^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)/g;
const SUBSCRIPT_DIGITS: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
};
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
};

function isUsableProblemBreakdown(value: unknown): value is ProblemBreakdown {
  if (!value || typeof value !== "object") return false;
  const candidate = value as any;

  if (!Array.isArray(candidate.nodes) && Array.isArray(candidate.tree)) {
    candidate.nodes = candidate.tree;
  }
  if (!Array.isArray(candidate.nodes) && Array.isArray(candidate.steps)) {
    candidate.nodes = candidate.steps;
  }

  if (!Array.isArray(candidate.nodes) || candidate.nodes.length < 5) return false;

  // Normalize node keys (e.g. title -> label, desc -> description, math -> mathContent)
  candidate.nodes = candidate.nodes.map((node: any) => {
    if (!node || typeof node !== "object") return node;
    const n = { ...node };
    if (!n.label && n.title) n.label = n.title;
    if (!n.description && n.desc) n.description = n.desc;
    if (!n.mathContent && n.math) n.mathContent = n.math;
    return n;
  });

  const rootNode = candidate.nodes.find((n: any) => n?.id === "root" || n?.parentId == null);
  if (rootNode) {
    if (!candidate.title && rootNode.title) candidate.title = rootNode.title;
    if (!candidate.title && rootNode.label) candidate.title = rootNode.label;
    if (!candidate.subject && rootNode.subject) candidate.subject = rootNode.subject;
  }
  if (!candidate.title) candidate.title = "Problem Breakdown";
  if (!candidate.subject) candidate.subject = "Math";
  if (!candidate.insights) {
    candidate.insights = { simpleBreakdown: "", keyFormula: "" };
  }

  // Prefer explicitly typed branch nodes; recovery responses often omit `type`,
  // so fall back to non-root nodes (parentId === "root" or id !== "root") as branch candidates.
  let branchNodes = candidate.nodes.filter((node) => node?.type === "branch");
  if (branchNodes.length < 2) {
    branchNodes = candidate.nodes.filter(
      (node) => node?.parentId === "root" || (node?.id !== "root" && !node?.type)
    );
  }
  if (branchNodes.length < 2) return false;

  const hasConcreteBranch = branchNodes.some((node) => {
    const math = `${node?.mathContent ?? ""}`.trim();
    const desc = `${node?.description ?? ""}`.trim();
    if (!math && !desc) return false;
    if (GENERIC_BREAKDOWN_STEP_PATTERN.test(math) || GENERIC_BREAKDOWN_STEP_PATTERN.test(desc)) return false;
    return (math.length >= 8 || desc.length >= 18);
  });

  return hasConcreteBranch;
}

function isUsableProblemSolutionFirst(value: unknown): value is ProblemSolutionFirst {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ProblemSolutionFirst;
  return Boolean(
    `${candidate.title ?? ""}`.trim()
    && `${candidate.subject ?? ""}`.trim()
    && `${candidate.finalAnswer ?? ""}`.trim()
    && `${candidate.solutionText ?? ""}`.trim()
  );
}

const FALLBACK_CONTENT_PATTERNS = [
  /problem could not be read/i,
  /could not solve/i,
  /^see solution$/i,
  /^n\/a$/i,
  /unable to (solve|determine|read)/i,
  /cannot be determined/i,
  /image could not be/i,
];

function isFallbackContent(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length < 2) return true;
  return FALLBACK_CONTENT_PATTERNS.some((p) => p.test(t));
}

function buildFallbackSolutionFirst(
  problem: string,
  subject: string,
  rawSolution: string,
): ProblemSolutionFirst {
  const cleaned = (rawSolution ?? "").trim();
  const solutionText = cleaned && !/"nodes"|"title"|"insights"/.test(cleaned)
    ? cleaned
    : `We need to solve:\n\n$$${problem}$$\n\nA full written solution could not be generated automatically.`;

  return {
    version: 2,
    mode: "solution-first",
    title: problem.slice(0, 70) || "New Solution",
    subject,
    topic: subject.toLowerCase().includes("physic")
      ? "mechanics"
      : subject.toLowerCase().includes("chem")
        ? "general-chemistry"
        : "algebra",
    problem,
    finalAnswer: "See solution",
    solutionText,
    solutionFormat: "markdown-latex",
    explanationStatus: "not_generated",
    explanation: null,
    insights: {
      simpleBreakdown: "",
      keyFormula: "",
    },
  };
}

/**
 * Strips a "Problem: ..." preamble that Phase 1 sometimes prepends to its output,
 * and wraps any lines containing bare LaTeX commands (not already inside $ delimiters)
 * in $$...$$ so the frontend renderer can handle them correctly.
 */
function sanitizeSolutionText(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return text;

  // Strip "Problem:" or "**Problem:**" preamble at the START (up to first blank line)
  text = text.replace(/^\s*(?:\*{0,2}Problem:?\*{0,2})[^\n]*\n+/i, "").trim();

  // Strip trailing "Problem:" / "Final Answer:" tail that Phase 1 sometimes appends
  // e.g. "\n\n**Problem:** ...\n**Final Answer:** ..."
  text = text.replace(/\n+\s*\*{0,2}(?:Problem|Final Answer):?\*{0,2}[\s\S]*$/i, "").trim();

  // Wrap lines that contain bare LaTeX commands but no $ delimiters
  const BARE_LATEX_LINE = /\\[a-zA-Z]+/;
  const HAS_DELIMITER = /\$/;
  const lines = text.split("\n");
  let insideAligned = false;
  let insideDisplayMath = false; // Track bare $$ open/close lines
  const processed = lines.map((line) => {
    const trimmed = line.trim();
    // Track standalone $$ delimiter lines (multi-line display math blocks)
    if (trimmed === "$$") {
      insideDisplayMath = !insideDisplayMath;
      return line;
    }
    // Track \begin{...} / \end{...} blocks
    if (/\\begin\{/.test(trimmed)) insideAligned = true;
    if (/\\end\{/.test(trimmed)) { insideAligned = false; return line; }
    if (insideAligned || insideDisplayMath) return line;
    // If line has LaTeX but no delimiters, wrap as display math
    if (BARE_LATEX_LINE.test(trimmed) && !HAS_DELIMITER.test(trimmed) && trimmed.length > 1) {
      return `$$${trimmed}$$`;
    }
    return line;
  });
  return processed.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function repairGeneratedMathText(input: string): string {
  const text = `${input ?? ""}`;
  if (!text.trim()) return "";

  // Fix LaTeX commands corrupted by JSON escape sequence parsing:
  const repaired = text
    .replace(/\n(otin|umber|ame|ew)/g, "\\n$1")
    .replace(/\t(an|heta|imes)/g, "\\t$1")
    .replace(/[\b](eta)/g, "\\b$1")
    .replace(/\f(rac)/g, "\\f$1")
    .replace(/\r(ight)/g, "\\r$1");

  return repaired
    .split("\n")
    .map((line) => {
      const dollarCount = (line.match(/\$/g) ?? []).length;
      if (line.trim() === "$") return "";
      if (dollarCount === 1) return line.replace(/\$/g, "");
      return line;
    })
    .join("\n")
    .replace(/\f\s*(?:rac|frac)?/gi, "\\frac")
    .replace(/\\?ext\s*pm\b/gi, "\\pm")
    .replace(/\\?extpm\b/gi, "\\pm")
    .replace(/\\?ext\s*radical\b/gi, "\\sqrt")
    .replace(/\\?extradical\b/gi, "\\sqrt")
    .replace(/\/(frac|sqrt|pm|Delta|times|div|cdot|neq|leq|geq|approx)\b/g, "\\$1")
    .replace(/[A-Za-z][₀₁₂₃₄₅₆₇₈₉]+/g, (token) => `${token[0]}_{${token.slice(1).split("").map((ch) => SUBSCRIPT_DIGITS[ch] ?? ch).join("")}}`)
    .replace(/([A-Za-z0-9)])([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_match, base, power) => `${base}^{${`${power}`.split("").map((ch) => SUPERSCRIPT_DIGITS[ch] ?? ch).join("")}}`)
    .replace(FRACTION_PLACEHOLDER_PATTERN, (_match, numerator, denominator) => `\\frac{${`${numerator}`.trim()}}{${`${denominator}`.trim()}}`)
    .replace(/[☒□▢☐]\s*\{([^{}\n]+)\}\s*\{([^{}\n]+)\}/g, (_match, numerator, denominator) => `\\frac{${`${numerator}`.trim()}}{${`${denominator}`.trim()}}`)
    .replace(/[☒□▢☐]/g, "\\frac")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function completeDanglingSolutionText(solutionText: string, finalAnswer: string): string {
  const answer = repairGeneratedMathText(finalAnswer).trim();
  if (!solutionText.trim() || !answer) return solutionText;
  if (solutionText.includes(answer)) return solutionText;
  if (/(ដូចនេះ|ដូច្នេះ|ហេតុនេះ|therefore|thus|hence)(?:\s+ចម្លើយគឺ)?\s*[:：]?\s*$/i.test(solutionText.trim())) {
    return `${solutionText.trim()} ${answer}`.trim();
  }
  return solutionText;
}

function normalizeSolutionFirstPayload(
  payload: ProblemSolutionFirst,
  problem: string,
  subject: string,
): ProblemSolutionFirst {
  const raw = payload.solutionText ?? "";
  const afterSanitize = sanitizeSolutionText(raw);
  const repairedFinalAnswer = repairGeneratedMathText(payload.finalAnswer);
  const afterRepair = completeDanglingSolutionText(repairGeneratedMathText(afterSanitize), repairedFinalAnswer);

  // Debug: trace every stage of solutionText pipeline to catch corruption early
  logger.info("[solutionText:pipeline]", {
    rawLength: raw.length,
    raw: raw.slice(0, 600),
    afterSanitize: afterSanitize.slice(0, 600),
    afterRepair: afterRepair.slice(0, 600),
  });

  return {
    ...payload,
    version: 3,
    mode: "solution-first",
    problem: payload.problem?.trim() || problem,
    subject: payload.subject?.trim() || subject,
    finalAnswer: repairedFinalAnswer,
    solutionText: afterRepair,
    solutionFormat: "markdown-latex",
    solutionBlocks: buildRenderBlocks(afterRepair),
    finalAnswerBlocks: buildRenderBlocks(repairedFinalAnswer, { defaultDisplay: false }),
    diagramBlocks: normalizeDiagramBlocks(payload.diagramBlocks),
    explanationStatus: "not_generated",
    explanation: null,
  };
}

const DIAGRAM_SPEC_GUIDE = `
Diagram spec examples:
- number-line: {"ranges":[{"from":-2,"to":3,"closedStart":true,"closedEnd":false}],"points":[{"value":0,"closed":true}]}
- number-line box plot: {"boxPlot":{"min":2,"q1":4.5,"q2":8,"q3":12.5,"max":15}}
- sign-table: {"rows":[{"label":"x","values":["-∞","2","+∞"]},{"label":"f(x)","signs":["+","0","-"]}]}
- geometry: {"shapes":[{"shape":"triangle","vertices":[[0,0],[100,0],[50,80]],"labels":["A","B","C"]}]}
- geometry vector arrows: {"shapes":[{"shape":"arrow","start":[0,0],"end":[3,2],"label":"\\vec{A}"},{"shape":"arrow","start":[3,2],"end":[4,7],"label":"\\vec{B}"},{"shape":"arrow","start":[0,0],"end":[4,7],"label":"\\vec{A}+\\vec{B}","color":"red"}],"options":{"xMin":-1,"xMax":5,"yMin":-1,"yMax":8,"grid":true,"showOrigin":true,"xAxisLabel":"x","yAxisLabel":"y"}}
- venn-diagram: {"sets":[{"label":"M","total":20},{"label":"S","total":15}],"intersection":8,"regions":{"leftOnly":12,"intersection":8,"rightOnly":7}}
- function-graph: {"functions":[{"kind":"quadratic","params":{"a":1,"b":0,"c":0},"latex":"y=x^2"}],"domain":[-5,5],"range":[-2,25]}
- function-graph line intersection: {"functions":[{"kind":"linear","params":{"m":2,"b":1},"latex":"y=2x+1"},{"kind":"linear","params":{"m":-1,"b":7},"latex":"y=-x+7","color":"red"}],"featurePoints":[{"point":[2,5],"label":"(2,5)"}],"domain":[-2,6],"range":[-2,10]}
- function-graph absolute value: {"functions":[{"kind":"absolute-value","params":{"a":1,"h":3,"k":-2,"xIntercepts":[1,5]},"latex":"y=|x-3|-2"}],"domain":[-1,7],"range":[-4,4]}
- function-graph rational reciprocal: {"functions":[{"kind":"rational-reciprocal","params":{"a":2,"h":1,"k":0,"verticalAsymptote":1,"horizontalAsymptote":0},"latex":"y=\\frac{2}{x-1}"}],"domain":[-5,7],"range":[-6,6]}
- solid-geometry: {"shape":"cube" | "pyramid" | "cylinder" | "cone" | "sphere","dimensions":{"width":100,"height":100,"depth":80},"labels":{"edge":"a"}}`;

const KHMER_DIGITS: Record<string, string> = {
  "០": "0",
  "១": "1",
  "២": "2",
  "៣": "3",
  "៤": "4",
  "៥": "5",
  "៦": "6",
  "៧": "7",
  "៨": "8",
  "៩": "9",
};

function normalizeDigits(input: string): string {
  return `${input ?? ""}`.replace(/[០-៩]/g, (digit) => KHMER_DIGITS[digit] ?? digit);
}

function firstNumberAfter(source: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const raw = match[1] ?? match[2] ?? match[0];
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function inferVennDiagramBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  if (!/(venn|diagram|ដ្យាក្រាម|សំណុំ|ប្រសព្វ|ត្រួតស៊ី|ចូលចិត្តទាំង)/i.test(source)) return [];

  // Prefer labels from the AI-generated block (may have correct set names even if values are missing)
  const emptyVenn = emptyBlocks.find((b) => b.diagramType === "venn-diagram");
  const emptySpec = emptyVenn?.spec as Record<string, unknown> | undefined;
  const emptySets = Array.isArray(emptySpec?.sets) ? emptySpec!.sets as Array<Record<string, unknown>> : [];
  const leftLabelHint = String(emptySets[0]?.label || "M");
  const rightLabelHint = String(emptySets[1]?.label || "S");

  const L = leftLabelHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const R = rightLabelHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const leftTotal = firstNumberAfter(source, [
    new RegExp(`n\\s*\\(\\s*${L}\\s*\\)\\s*=\\s*(\\d+)`, "i"),
    /(\d+)\s*(?:នាក់)?[^\n]*(?:គណិត|math|mathematics)/i,
  ]);
  const rightTotal = firstNumberAfter(source, [
    new RegExp(`n\\s*\\(\\s*${R}\\s*\\)\\s*=\\s*(\\d+)`, "i"),
    /(\d+)\s*(?:នាក់)?[^\n]*(?:វិទ្យាសាស្ត្រ|science)/i,
  ]);
  const intersection = firstNumberAfter(source, [
    new RegExp(`n\\s*\\(\\s*${L}\\s*\\\\cap\\s*${R}\\s*\\)\\s*=\\s*(\\d+)`, "i"),
    /(\d+)\s*(?:នាក់)?[^\n]*(?:ទាំងពីរ|ចូលចិត្តទាំង|both|intersection)/i,
  ]);

  if (!Number.isFinite(leftTotal) || !Number.isFinite(rightTotal) || !Number.isFinite(intersection)) return [];

  return normalizeDiagramBlocks([{
    diagramType: "venn-diagram",
    sets: [
      { label: leftLabelHint, total: leftTotal },
      { label: rightLabelHint, total: rightTotal },
    ],
    intersection,
    regions: {
      leftOnly: Math.max(0, leftTotal - intersection),
      intersection,
      rightOnly: Math.max(0, rightTotal - intersection),
    },
  }]);
}

function inferFunctionGraphBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
  finalAnswer?: string,
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);

  // Only fire for graph/parabola/sketch problems
  if (!/(graph|parabola|sketch|plot|line|linear|intersection|ក្រាហ្វ|ប៉ារ៉ាបូល|គូស|quadratic|បន្ទាត់|ប្រសព្វ)/i.test(source)) return [];

  // Confirm the AI identified this as a function-graph (empty block hint)
  const wantedFunctionGraph = emptyBlocks.some((b) => b.diagramType === "function-graph")
    || /(graph|sketch|plot|line|linear|intersection|បន្ទាត់|ប្រសព្វ)/i.test(source);
  if (!wantedFunctionGraph) return [];

  const parseLinearCoefficient = (raw: string | undefined): number => {
    const value = `${raw ?? ""}`.replace(/\s/g, "");
    if (!value || value === "+") return 1;
    if (value === "-") return -1;
    return Number(value);
  };
  // Match `y = mx + b` and also `y &= mx + b` (LaTeX aligned environments).
  // Include finalAnswer in search so the result line is always found.
  const fullSource = normalizeDigits(`${problem}\n${solutionText}\n${finalAnswer ?? ""}`);
  const lineMatches = Array.from(fullSource.matchAll(/y\s*&?=\s*([+-]?\s*\d*(?:\.\d+)?)\s*x\s*([+-]\s*\d+(?:\.\d+)?)?/gi))
    .map((match) => {
      const m = parseLinearCoefficient(match[1]);
      const b = match[2] ? Number(match[2].replace(/\s/g, "")) : 0;
      const latex = match[0].replace(/\s+/g, "").replace("&", "");
      return Number.isFinite(m) && Number.isFinite(b) ? { m, b, latex } : null;
    })
    .filter((line): line is { m: number; b: number; latex: string } => Boolean(line))
    // Deduplicate by (m, b) — the same equation may appear many times in the solution text
    .filter((line, idx, arr) => arr.findIndex((l) => l.m === line.m && l.b === line.b) === idx);
  if (lineMatches.length >= 2) {
    const [line1, line2] = lineMatches;
    if (line1.m !== line2.m) {
      // Intersecting lines — mark the intersection point
      const x = (line2.b - line1.b) / (line1.m - line2.m);
      const y = line1.m * x + line1.b;
      const domainMin = Math.floor(x - 4);
      const domainMax = Math.ceil(x + 4);
      const evalY = (line: { m: number; b: number }, value: number) => line.m * value + line.b;
      const yValues = [0, y, evalY(line1, domainMin), evalY(line1, domainMax), evalY(line2, domainMin), evalY(line2, domainMax)];
      const yMin = Math.floor(Math.min(...yValues) - 1);
      const yMax = Math.ceil(Math.max(...yValues) + 1);
      const pointLabel = `(${Number(x.toFixed(2))}, ${Number(y.toFixed(2))})`;

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [
          { kind: "linear", params: { m: line1.m, b: line1.b }, latex: line1.latex, color: "primary" },
          { kind: "linear", params: { m: line2.m, b: line2.b }, latex: line2.latex, color: "red" },
        ],
        featurePoints: [{ point: [x, y], label: pointLabel, color: "green" }],
        domain: [domainMin, domainMax],
        range: [yMin, yMax],
        xAxisLabel: "x",
        yAxisLabel: "y",
      }]);
    } else {
      // Parallel lines — same slope, show both with the known point on the new line
      const evalY = (line: { m: number; b: number }, value: number) => line.m * value + line.b;
      const domainMin = -2;
      const domainMax = 6;
      const yValues = [evalY(line1, domainMin), evalY(line1, domainMax), evalY(line2, domainMin), evalY(line2, domainMax), 0];
      const yMin = Math.floor(Math.min(...yValues) - 1);
      const yMax = Math.ceil(Math.max(...yValues) + 1);

      // Try to find the through-point from the problem text (e.g. "(2, 5)")
      const throughPoint = source.match(/\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/);
      const featurePoints: { point: [number, number]; label: string; color: string }[] = [];
      if (throughPoint) {
        const px = Number(throughPoint[1]);
        const py = Number(throughPoint[2]);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          featurePoints.push({ point: [px, py], label: `(${px}, ${py})`, color: "green" });
        }
      }

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [
          { kind: "linear", params: { m: line1.m, b: line1.b }, latex: line1.latex, color: "primary" },
          { kind: "linear", params: { m: line2.m, b: line2.b }, latex: line2.latex, color: "red" },
        ],
        featurePoints,
        domain: [domainMin, domainMax],
        range: [yMin, yMax],
        xAxisLabel: "x",
        yAxisLabel: "y",
      }]);
    }
  }

  const pointMatches = Array.from(source.matchAll(
    /\b([A-Z])\s*(?:\([^()]*\)\s*=\s*)?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g
  ))
    .map((match) => ({
      label: match[1],
      x: Number(match[2]),
      y: Number(match[3]),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .filter((point, index, points) => points.findIndex((candidate) => (
      candidate.label === point.label && candidate.x === point.x && candidate.y === point.y
    )) === index);
  if (pointMatches.length >= 2 && /(slope|ជម្រាល|increasing|decreasing|កើន|ចុះ|line segment|plotted points|ចំណុច)/i.test(source)) {
    const [pointA, pointB] = pointMatches;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    if (dx !== 0) {
      const m = dy / dx;
      const b = pointA.y - m * pointA.x;
      const xMin = Math.floor(Math.min(pointA.x, pointB.x) - 2);
      const xMax = Math.ceil(Math.max(pointA.x, pointB.x) + 2);
      const evalY = (xValue: number) => m * xValue + b;
      const yValues = [0, pointA.y, pointB.y, evalY(xMin), evalY(xMax)];
      const yMin = Math.floor(Math.min(...yValues) - 1);
      const yMax = Math.ceil(Math.max(...yValues) + 1);
      const formatNumber = (value: number) => Number(value.toFixed(6));
      const gcd = (left: number, right: number): number => {
        let a = Math.abs(Math.round(left));
        let bValue = Math.abs(Math.round(right));
        while (bValue) {
          const next = a % bValue;
          a = bValue;
          bValue = next;
        }
        return a || 1;
      };
      const formatFraction = (numerator: number, denominator: number): string => {
        if (denominator < 0) {
          numerator *= -1;
          denominator *= -1;
        }
        if (Number.isInteger(numerator) && Number.isInteger(denominator)) {
          const divisor = gcd(numerator, denominator);
          numerator /= divisor;
          denominator /= divisor;
        }
        if (denominator === 1) return `${formatNumber(numerator)}`;
        return `\\frac{${formatNumber(numerator)}}{${formatNumber(denominator)}}`;
      };
      const slopeLatex = Number.isInteger(m) ? `${m}` : formatFraction(dy, dx);
      const interceptLatex = Number.isInteger(b) ? `${Math.abs(b)}` : formatFraction(Math.abs(dy * -pointA.x + pointA.y * dx), Math.abs(dx));
      const latex = `y=${slopeLatex}x${b < 0 ? "-" : "+"}${interceptLatex}`;

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{
          kind: "linear",
          params: { m, b },
          latex,
          color: "primary",
        }],
        featurePoints: [
          { point: [pointA.x, pointA.y], label: `${pointA.label}(${pointA.x}, ${pointA.y})`, color: "green" },
          { point: [pointB.x, pointB.y], label: `${pointB.label}(${pointB.x}, ${pointB.y})`, color: "red" },
        ],
        domain: [xMin, xMax],
        range: [yMin, yMax],
        xAxisLabel: "x",
        yAxisLabel: "y",
      }]);
    }
  }

  const areaUnderMatch = source.match(
    /(?:area under|ផ្ទៃក្រោម|shaded region|តំបន់ដែលបានដាក់ស្រមោល|អាំងតេក្រាល)[\s\S]{0,240}?(?:y\s*=\s*([+-]?\d+(?:\.\d+)?)?\s*x\^2|([+-]?\d+(?:\.\d+)?)?\s*x\^2)[\s\S]{0,240}?(?:from|ពី)\s*:?\s*\$?\s*x\s*=\s*([+-]?\d+(?:\.\d+)?)[\s\S]{0,120}?(?:to|ដល់)\s*:?\s*\$?\s*x\s*=\s*([+-]?\d+(?:\.\d+)?)/i
  );
  if (areaUnderMatch) {
    const coefficient = areaUnderMatch[1] ?? areaUnderMatch[2];
    const a = coefficient ? parseFloat(coefficient) : 1;
    const from = parseFloat(areaUnderMatch[3]);
    const to = parseFloat(areaUnderMatch[4]);
    if (Number.isFinite(a) && Number.isFinite(from) && Number.isFinite(to) && a !== 0 && from !== to) {
      const xMin = Math.min(from, to);
      const xMax = Math.max(from, to);
      const domainMin = Math.floor(Math.min(0, xMin) - 0.5);
      const domainMax = Math.ceil(xMax + 0.5);
      const evalAt = (x: number) => a * x * x;
      const yValues = [0, evalAt(domainMin), evalAt(domainMax), evalAt(xMin), evalAt(xMax)];
      const yMin = Math.floor(Math.min(...yValues) - 1);
      const yMax = Math.ceil(Math.max(...yValues) + 1);
      const area = (a / 3) * (Math.pow(xMax, 3) - Math.pow(xMin, 3));

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{
          kind: "quadratic",
          params: { a, b: 0, c: 0 },
          latex: a === 1 ? "y=x^2" : `y=${a}x^2`,
          color: "primary",
        }],
        shadedRegions: [{
          from: xMin,
          to: xMax,
          baseline: 0,
          functionIndex: 0,
          label: `A=${Number(area.toFixed(2))}`,
          color: "primary",
        }],
        featurePoints: [
          { point: [xMin, 0], label: `x=${Number(xMin.toFixed(2))}`, color: "muted" },
          { point: [xMax, 0], label: `x=${Number(xMax.toFixed(2))}`, color: "muted" },
        ],
        domain: [domainMin, domainMax],
        range: [yMin, yMax],
        xAxisLabel: "x",
        yAxisLabel: "y",
      }]);
    }
  }

  const absMatch = source.match(
    /(?:y|[a-z]\s*\(\s*[a-z]\s*\))\s*=\s*([+-]?)\s*(\d+(?:\.\d+)?)?\s*\|\s*([a-z])\s*([+-])\s*(\d+(?:\.\d+)?)\s*\|\s*([+-]\s*\d+(?:\.\d+)?)?/i
  );
  if (absMatch) {
    const sign = absMatch[1] === "-" ? -1 : 1;
    const magnitude = absMatch[2] ? parseFloat(absMatch[2]) : 1;
    const a = sign * magnitude;
    const variable = absMatch[3] || "x";
    const h = absMatch[4] === "-" ? parseFloat(absMatch[5]) : -parseFloat(absMatch[5]);
    const k = absMatch[6] ? parseFloat(absMatch[6].replace(/\s/g, "")) : 0;
    if (Number.isFinite(a) && Number.isFinite(h) && Number.isFinite(k) && a !== 0) {
      const rootDistance = -k / a;
      const xIntercepts = rootDistance >= 0
        ? [h - rootDistance, h + rootDistance].filter((value, index, arr) => Number.isFinite(value) && arr.indexOf(value) === index)
        : [];
      const domainMin = Math.floor(Math.min(h - 4, ...xIntercepts) - 1);
      const domainMax = Math.ceil(Math.max(h + 4, ...xIntercepts) + 1);
      const evalAt = (x: number) => a * Math.abs(x - h) + k;
      const yValues = [k, 0, evalAt(domainMin), evalAt(domainMax)];
      const yMin = Math.floor(Math.min(...yValues) - 1);
      const yMax = Math.ceil(Math.max(...yValues) + 1);
      const latexMatch = problem.match(/\$([^$]*\|[^$]*\|[^$]*)\$/);
      const latex = latexMatch ? latexMatch[1].trim() : `y=|${variable}${h >= 0 ? "-" : "+"}${Math.abs(h)}|${k >= 0 ? "+" : ""}${k}`;

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{
          kind: "absolute-value",
          params: { a, h, k, xIntercepts },
          latex,
        }],
        domain: [domainMin, domainMax],
        range: [yMin, yMax],
        xAxisLabel: variable,
        yAxisLabel: "y",
      }]);
    }
  }

  const rationalMatch = source.match(
    /(?:y|[a-z]\s*\(\s*[a-z]\s*\))\s*=\s*(?:\\frac\{([+-]?\d+(?:\.\d+)?)\}\{\s*([a-z])\s*([+-])\s*(\d+(?:\.\d+)?)\s*\}|([+-]?\d+(?:\.\d+)?)\s*\/\s*\(?\s*([a-z])\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)?)(?:\s*([+-]\s*\d+(?:\.\d+)?))?/i
  );
  if (rationalMatch) {
    const numerator = rationalMatch[1] ?? rationalMatch[5];
    const variable = rationalMatch[2] ?? rationalMatch[6] ?? "x";
    const sign = rationalMatch[3] ?? rationalMatch[7] ?? "-";
    const shift = rationalMatch[4] ?? rationalMatch[8] ?? "0";
    const trailing = rationalMatch[9];
    const a = parseFloat(numerator);
    const h = sign === "-" ? parseFloat(shift) : -parseFloat(shift);
    const k = trailing ? parseFloat(trailing.replace(/\s/g, "")) : 0;
    if (Number.isFinite(a) && Number.isFinite(h) && Number.isFinite(k) && a !== 0) {
      const domainMin = Math.floor(h - 6);
      const domainMax = Math.ceil(h + 6);
      const ySpan = Math.max(6, Math.ceil(Math.abs(a) * 3));
      const latexMatch = problem.match(/\$([^$]*(?:\\frac|\/)[^$]*)\$/);
      const latex = latexMatch ? latexMatch[1].trim() : `y=\\frac{${a}}{${variable}${h >= 0 ? "-" : "+"}${Math.abs(h)}}${k ? `${k >= 0 ? "+" : ""}${k}` : ""}`;

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{
          kind: "rational-reciprocal",
          params: {
            a,
            h,
            k,
            verticalAsymptote: h,
            horizontalAsymptote: k,
          },
          latex,
        }],
        domain: [domainMin, domainMax],
        range: [Math.floor(k - ySpan), Math.ceil(k + ySpan)],
        xAxisLabel: variable,
        yAxisLabel: "y",
      }]);
    }
  }

  // Extract cubic: f(x) = ax^3 [+ bx^2] [+ cx] [+ d]
  // Must be checked before quadratic since x^3 contains x which would confuse qMatch
  const cubicMatch = source.match(
    /=\s*([+-]?\s*\d*(?:\.\d+)?)\s*x\^3(?:\s*([+-]\s*\d+(?:\.\d+)?)\s*x\^2)?(?:\s*([+-]\s*\d+(?:\.\d+)?)\s*x(?!\^))?(?:\s*([+-]\s*\d+(?:\.\d+)?))?/i
  );
  if (cubicMatch) {
    const rawA = (cubicMatch[1] ?? "1").replace(/\s/g, "");
    const cubicA = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : parseFloat(rawA);
    const cubicB = cubicMatch[2] ? parseFloat(cubicMatch[2].replace(/\s/g, "")) : 0;
    const cubicC = cubicMatch[3] ? parseFloat(cubicMatch[3].replace(/\s/g, "")) : 0;
    const cubicD = cubicMatch[4] ? parseFloat(cubicMatch[4].replace(/\s/g, "")) : 0;

    if (Number.isFinite(cubicA) && cubicA !== 0) {
      const evalCubic = (x: number) => cubicA * x ** 3 + cubicB * x ** 2 + cubicC * x + cubicD;

      // Critical points: f'(x) = 3ax^2 + 2bx + c = 0
      const dDisc = (2 * cubicB) ** 2 - 4 * (3 * cubicA) * cubicC;
      const criticalXs: number[] = dDisc > 0
        ? [(-2 * cubicB - Math.sqrt(dDisc)) / (6 * cubicA), (-2 * cubicB + Math.sqrt(dDisc)) / (6 * cubicA)].filter(Number.isFinite)
        : Math.abs(dDisc) < 1e-10
          ? [(-2 * cubicB) / (6 * cubicA)].filter(Number.isFinite)
          : [];

      const critXMin = criticalXs.length ? Math.min(...criticalXs) : 0;
      const critXMax = criticalXs.length ? Math.max(...criticalXs) : 0;
      const domainMin = Math.floor(critXMin - 2);
      const domainMax = Math.ceil(critXMax + 2);

      const NUM_SAMPLES = 60;
      const samplePoints: [number, number][] = Array.from({ length: NUM_SAMPLES }, (_, i) => {
        const x = domainMin + ((domainMax - domainMin) * i) / (NUM_SAMPLES - 1);
        return [Math.round(x * 1000) / 1000, Math.round(evalCubic(x) * 1000) / 1000];
      });

      const featurePoints = criticalXs.map((x) => ({
        point: [Math.round(x * 100) / 100, Math.round(evalCubic(x) * 100) / 100] as [number, number],
        label: `(${Number(x.toFixed(2))}, ${Number(evalCubic(x).toFixed(2))})`,
      }));

      const yValues = samplePoints.map((p) => p[1]);
      const rawYMin = Math.min(...yValues);
      const rawYMax = Math.max(...yValues);
      const yPad = Math.max((rawYMax - rawYMin) * 0.1, 2);

      const cubicLatexMatch = problem.match(/\$([^$]*x\^3[^$]*)\$/i);
      const cubicLatex = cubicLatexMatch ? cubicLatexMatch[1].trim() : "";

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{ kind: "cubic", points: samplePoints, latex: cubicLatex, color: "primary" }],
        featurePoints,
        domain: [domainMin, domainMax],
        range: [Math.floor(rawYMin - yPad), Math.ceil(rawYMax + yPad)],
        xAxisLabel: "x",
        yAxisLabel: "y",
      }]);
    }
  }

  // Extract exponential: P(t) = 500(1.08)^t or y = a * b^x or f(x) = b^x
  // Let's try matching with constant coefficient "a" first: P(t) = 500(1.08)^t
  const expoMatch = source.match(
    /(?:([a-z]+)\s*\(\s*([a-z])\s*\)|([a-z]+))\s*=\s*(\d+(?:\.\d+)?)\s*(?:\*|\\times|\\cdot|\\s*|\s*)\(?\s*(\d+(?:\.\d+)?)\s*\)?\^(?:([a-z])|\{([a-z])\})/i
  );
  // Also try matching without "a" coefficient (implied a = 1): y = 2^x
  const expoMatchNoA = !expoMatch ? source.match(
    /(?:([a-z]+)\s*\(\s*([a-z])\s*\)|([a-z]+))\s*=\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?\^(?:([a-z])|\{([a-z])\})/i
  ) : null;

  if (expoMatch || expoMatchNoA) {
    let expoA = 1;
    let expoB = 1;
    let xAxisLabel = "x";
    let yAxisLabel = "y";

    if (expoMatch) {
      yAxisLabel = expoMatch[1] || expoMatch[3] || "y";
      xAxisLabel = expoMatch[2] || expoMatch[6] || expoMatch[7] || "x";
      expoA = parseFloat(expoMatch[4]);
      expoB = parseFloat(expoMatch[5]);
    } else if (expoMatchNoA) {
      yAxisLabel = expoMatchNoA[1] || expoMatchNoA[3] || "y";
      xAxisLabel = expoMatchNoA[2] || expoMatchNoA[5] || expoMatchNoA[6] || "x";
      expoA = 1;
      expoB = parseFloat(expoMatchNoA[4]);
    }

    if (Number.isFinite(expoA) && Number.isFinite(expoB) && expoA > 0 && expoB > 0 && expoB !== 1) {
      const targetVal = firstNumberAfter(source, [
        /(?:after|បន្ទាប់ពី|រយៈពេល)\s*(\d+(?:\.\d+)?)\s*(?:years|months|days|hours|ឆ្នាំ|ខែ|ថ្ងៃ|ម៉ោង)/i,
        /(\d+(?:\.\d+)?)\s*(?:years|months|days|hours|ឆ្នាំ|ខែ|ថ្ងៃ|ម៉ោង)/i,
      ]) || 5;

      const domainMin = 0;
      const domainMax = Math.max(8, Math.ceil(targetVal * 1.6));

      const NUM_SAMPLES = 60;
      const samplePoints: [number, number][] = [];
      for (let i = 0; i < NUM_SAMPLES; i++) {
        const tVal = domainMin + ((domainMax - domainMin) * i) / (NUM_SAMPLES - 1);
        const pVal = expoA * Math.pow(expoB, tVal);
        samplePoints.push([
          Math.round(tVal * 100) / 100,
          Math.round(pVal * 100) / 100
        ]);
      }

      const targetY = expoA * Math.pow(expoB, targetVal);
      const featurePoints = [
        { point: [0, expoA] as [number, number], label: `(0, ${expoA})`, color: "muted" },
        { point: [targetVal, Math.round(targetY * 100) / 100] as [number, number], label: `(${targetVal}, ${Math.round(targetY)})`, color: "primary" }
      ];

      const yValues = samplePoints.map((p) => p[1]);
      const rawYMin = Math.min(...yValues);
      const rawYMax = Math.max(...yValues);
      const yPad = Math.max((rawYMax - rawYMin) * 0.1, 2);

      const latexMatch = problem.match(/\$([^$]*=[^$]*\^[^$]*)\$/);
      const latex = latexMatch ? latexMatch[1].trim() : `${yAxisLabel}(${xAxisLabel}) = ${expoA}(${expoB})^${xAxisLabel}`;

      return normalizeDiagramBlocks([{
        diagramType: "function-graph",
        functions: [{ kind: "exponential", points: samplePoints, latex, color: "primary" }],
        featurePoints,
        domain: [domainMin, domainMax],
        range: [Math.floor(rawYMin), Math.ceil(rawYMax + yPad)],
        xAxisLabel,
        yAxisLabel,
      }]);
    }
  }

  // Extract quadratic: f(t) = -5t^2 + 20t + 15 or f(x) = ax^2 + bx + c
  const qMatch = source.match(
    /=\s*([+-]?\s*\d*(?:\.\d+)?)\s*[a-z]\^2\s*(?:([+-]\s*\d*(?:\.\d+)?)\s*[a-z])?(?:\s*([+-]\s*\d+(?:\.\d+)?))?(?!\s*[a-z])/i
  );
  if (!qMatch) return [];

  const rawA = (qMatch[1] ?? "").replace(/\s/g, "");
  const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : parseFloat(rawA);

  const b = qMatch[2] !== undefined
    ? (() => {
      const rawB = qMatch[2].replace(/\s/g, "");
      return rawB === "" || rawB === "+" ? 1 : rawB === "-" ? -1 : parseFloat(rawB);
    })()
    : 0;

  const c = qMatch[3] ? parseFloat(qMatch[3].replace(/\s/g, "")) : 0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a === 0) return [];

  const vertexX = -b / (2 * a);
  const vertexY = a * vertexX * vertexX + b * vertexX + c;
  const discriminant = b * b - 4 * a * c;

  let domainMin = vertexX - 3;
  let domainMax = vertexX + 3;
  if (discriminant >= 0) {
    const sqrtD = Math.sqrt(discriminant);
    const x1 = (-b - sqrtD) / (2 * a);
    const x2 = (-b + sqrtD) / (2 * a);
    const xLeft = Math.min(x1, x2);
    const xRight = Math.max(x1, x2);
    const pad = Math.max((xRight - xLeft) * 0.2, 0.5);
    domainMin = xLeft - pad;
    domainMax = xRight + pad;
  }

  const evalAt = (x: number) => a * x * x + b * x + c;
  const yValues = [vertexY, evalAt(domainMin), evalAt(domainMax), 0];
  const rawYMin = Math.min(...yValues);
  const rawYMax = Math.max(...yValues);
  const yPad = Math.max((rawYMax - rawYMin) * 0.12, 2);

  // Try to grab the latex label and axis variable names from the problem statement
  // e.g. "$h(t) = -5t^2 + 20t + 15$" → xAxisLabel="t", yAxisLabel="h"
  const latexMatch = problem.match(/\$([^$]*[a-z]\s*=\s*[^$]*[a-z]\^2[^$]*)\$/i);
  const latex = latexMatch ? latexMatch[1].trim() : "";
  const funcSigMatch = problem.match(/\$\s*([a-z])\s*\(\s*([a-z])\s*\)/i);
  const yAxisLabel = funcSigMatch ? funcSigMatch[1] : "y";
  const xAxisLabel = funcSigMatch ? funcSigMatch[2] : "x";

  return normalizeDiagramBlocks([{
    diagramType: "function-graph",
    functions: [{ kind: "quadratic", params: { a, b, c }, latex }],
    domain: [Math.floor(domainMin - 0.5), Math.ceil(domainMax + 0.5)],
    range: [Math.floor(rawYMin - yPad), Math.ceil(rawYMax + yPad)],
    xAxisLabel,
    yAxisLabel,
  }]);
}

function inferNumberLineBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): ReturnType<typeof normalizeDiagramBlocks> {
  const source = normalizeDigits(`${problem}\n${solutionText}`);

  // 1. Try Box Plot extraction first
  const isBoxPlot = /(box.?plot|boxplot|ក្វាទែល|មេដ្យាន|quartile)/i.test(source);
  if (isBoxPlot) {
    const minVal = firstNumberAfter(source, [
      /(?:អប្បបរមា|minimum|min)[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /\bmin\s*=\s*([+-]?\d+(?:\.\d+)?)/i
    ]);
    const q1Val = firstNumberAfter(source, [
      /q_?1[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី\s*១[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី១[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i
    ]);
    const q2Val = firstNumberAfter(source, [
      /q_?2[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /median[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /មេដ្យាន[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី\s*២[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី២[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i
    ]);
    const q3Val = firstNumberAfter(source, [
      /q_?3[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី\s*៣[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /ក្វាទែលទី៣[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i
    ]);
    const maxVal = firstNumberAfter(source, [
      /(?:អតិបរមា|maximum|max)[^\d\n]*?([+-]?\d+(?:\.\d+)?)/i,
      /\bmax\s*=\s*([+-]?\d+(?:\.\d+)?)/i
    ]);

    if (
      minVal !== null && Number.isFinite(minVal) &&
      q1Val !== null && Number.isFinite(q1Val) &&
      q2Val !== null && Number.isFinite(q2Val) &&
      q3Val !== null && Number.isFinite(q3Val) &&
      maxVal !== null && Number.isFinite(maxVal)
    ) {
      return normalizeDiagramBlocks([{
        diagramType: "number-line",
        spec: {
          boxPlot: {
            min: minVal,
            q1: q1Val,
            q2: q2Val,
            q3: q3Val,
            max: maxVal
          }
        }
      }]);
    }
  }

  const wantedNumberLine = emptyBlocks.some((b) => b.diagramType === "number-line")
    || /(number.?line|inequalit|solution.?set|interval.?notation|ចន្លោះ|វិសមភាព)/i.test(source);
  if (!wantedNumberLine) return [];

  const isOpen = (op: string) => op === "<" || op === ">" || op === "\\lt" || op === "\\gt";

  // Try compound inequality: a OP x OP b  (e.g. -1 < x \le 3)
  const compoundRe = /([+-]?\s*\d+(?:\.\d+)?)\s*(\\le[q]?|\\ge[q]?|<=|>=|[<>≤≥])\s*&?\s*x\s*(\\le[q]?|\\ge[q]?|<=|>=|[<>≤≥])\s*([+-]?\s*\d+(?:\.\d+)?)/i;
  const cm = source.match(compoundRe);
  if (cm) {
    const left = parseFloat(cm[1].replace(/\s/g, ""));
    const op1 = cm[2];
    const op2 = cm[3];
    const right = parseFloat(cm[4].replace(/\s/g, ""));
    if (Number.isFinite(left) && Number.isFinite(right)) {
      const [from, to] = left < right ? [left, right] : [right, left];
      // op1 is operator between left and x; op2 is operator between x and right.
      // If op1 is < or \lt, left side is open. If op2 is ≤ or \le, right side is closed.
      const closedStart = !isOpen(op1);
      const closedEnd = !isOpen(op2);
      return normalizeDiagramBlocks([{
        diagramType: "number-line",
        spec: { ranges: [{ from, to, closedStart, closedEnd }], points: [] },
      }]);
    }
  }

  // Try interval notation: (-1, 3] or [-1, 3) or [-1, 3]
  const intervalRe = /([([])?\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*([\])])/;
  const im = source.match(intervalRe);
  if (im) {
    const from = parseFloat(im[2]);
    const to = parseFloat(im[3]);
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      const closedStart = im[1] === "[";
      const closedEnd = im[4] === "]";
      return normalizeDiagramBlocks([{
        diagramType: "number-line",
        spec: { ranges: [{ from, to, closedStart, closedEnd }], points: [] },
      }]);
    }
  }

  return [];
}

function parseMarkdownTable(text: string): { label: string; cells: string[] }[] | null {
  const lines = text.split("\n");
  const tableRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.every((c) => /^[:\s\-]+$/.test(c))) {
        continue;
      }
      tableRows.push(cells);
    }
  }

  if (tableRows.length < 2) return null;

  const cleanCellText = (cell: string): string => {
    return cell
      .replace(/\$/g, "") // strip $
      .replace(/\\infty/g, "∞")
      .replace(/-\\infty/g, "-∞")
      .replace(/\+\\infty/g, "+∞")
      .replace(/\\pm/g, "±")
      .replace(/\\ge/g, "≥")
      .replace(/\\le/g, "≤")
      .trim();
  };

  return tableRows.map((row) => {
    const label = cleanCellText(row[0]);
    const cells = row.slice(1).map(cleanCellText);
    return { label, cells };
  });
}

function inferSignTableBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): ReturnType<typeof normalizeDiagramBlocks> {
  const source = normalizeDigits(`${problem}\n${solutionText}`);

  // Only fire for derivative / monotonicity / sign analysis problems
  const wantedSignTable = emptyBlocks.some((b) => b.diagramType === "sign-table")
    || /(sign table|variation table|sign chart|monoton|increasing|decreasing|critical point|f'\s*\(|ចន្លោះកើន|ចន្លោះចុះ|តារាងសញ្ញា|ចំណុចវិបាក)/i.test(source);
  if (!wantedSignTable) return [];

  // 1. Try to parse sign table from markdown in solutionText
  const parsedMarkdownRows = parseMarkdownTable(solutionText);
  if (parsedMarkdownRows && parsedMarkdownRows.length >= 2) {
    // Check if all rows have the exact same number of cells (meaning they are already aligned)
    const lengths = parsedMarkdownRows.map((r) => r.cells.length);
    const allSameLength = lengths.every((l) => l === lengths[0]);
    if (allSameLength && lengths[0] >= 3) {
      return normalizeDiagramBlocks([{ diagramType: "sign-table", spec: { rows: parsedMarkdownRows } }]);
    }
  }

  // 2. Fallback to programmatic sign table extraction and evaluation
  // Extract critical x values (e.g. x = 1, x = -1, x = ±k)
  const criticalXSet = new Set<number>();
  for (const m of source.matchAll(/x\s*=\s*([+-]?\s*\d+(?:\.\d+)?)/gi)) {
    const v = parseFloat(m[1].replace(/\s/g, ""));
    if (Number.isFinite(v)) criticalXSet.add(v);
  }
  for (const m of source.matchAll(/x\s*=\s*\\?pm\s*(\d+(?:\.\d+)?)/gi)) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) { criticalXSet.add(-v); criticalXSet.add(v); }
  }

  const criticalXs = Array.from(criticalXSet).sort((a, b) => a - b);
  if (criticalXs.length === 0) return [];

  // Parse derivative or quadratic expression to evaluate signs
  const isDerivative = /f'\s*\(|y'\s*=|derivative|ដេរីវេ/i.test(source);
  const derivMatch = source.match(/f'\s*\(\s*x\s*\)\s*=\s*([^,\n$\\]+)/i);
  const derivExpr = derivMatch ? derivMatch[1].trim() : "";

  // Look for any quadratic expression in problem or solutionText as a fallback
  const qm = derivExpr.match(/([+-]?\s*\d*(?:\.\d+)?)\s*x\^2(?:\s*([+-]\s*\d+(?:\.\d+)?)\s*x)?(?:\s*([+-]\s*\d+(?:\.\d+)?))?/i)
    || source.match(/([+-]?\s*\d*(?:\.\d+)?)\s*x\^2(?:\s*([+-]\s*\d+(?:\.\d+)?)\s*x)?(?:\s*([+-]\s*\d+(?:\.\d+)?))?/i);

  const evalDerivSign = (x: number): "+" | "-" | "0" => {
    if (qm) {
      const rawA = (qm[1] ?? "1").replace(/\s/g, "");
      const dA = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : parseFloat(rawA);
      const dB = qm[2] ? parseFloat(qm[2].replace(/\s/g, "")) : 0;
      const dC = qm[3] ? parseFloat(qm[3].replace(/\s/g, "")) : 0;
      if (Number.isFinite(dA)) {
        const val = dA * x * x + dB * x + dC;
        if (Math.abs(val) < 1e-9) return "0";
        return val > 0 ? "+" : "-";
      }
    }
    return "+";
  };

  // Build perfectly aligned cells for the sign table:
  // xRow:     ["-∞", crit0, "", crit1, ..., "+∞"]
  // signRow:  [sign_before, "0", sign_between, "0", ..., sign_after]
  const xRow: string[] = ["-∞"];
  const signRow: string[] = [];

  for (let i = 0; i < criticalXs.length; i++) {
    // interval before criticalXs[i]
    const testX = i === 0
      ? criticalXs[0] - 1
      : (criticalXs[i - 1] + criticalXs[i]) / 2;
    signRow.push(evalDerivSign(testX));

    if (i > 0) {
      xRow.push(""); // interval spacer between roots in xRow
    }
    xRow.push(String(criticalXs[i]));
    signRow.push("0");
  }

  // interval after the last root
  const testXAfter = criticalXs[criticalXs.length - 1] + 1;
  signRow.push(evalDerivSign(testXAfter));
  xRow.push("+∞");

  const signLabel = isDerivative ? "f'(x)" : "P(x)";
  const rows = [
    { label: "x", cells: xRow },
    { label: signLabel, cells: signRow },
  ];

  return normalizeDiagramBlocks([{ diagramType: "sign-table", spec: { rows } }]);
}

function inferTriangleExteriorAngleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(triangle|ត្រីកោណ|exterior angle|មុំក្រៅ)/i.test(source);
  if (!wantsGeometry || !/(triangle|ត្រីកោណ)/i.test(source) || !/(exterior angle|មុំក្រៅ)/i.test(source)) return [];

  const angleA = firstNumberAfter(source, [
    /\\angle\s*A\s*=\s*(\d+)/i,
    /angle\s*A\s*=\s*(\d+)/i,
    /មុំ\s*A[^\d]*(\d+)/i,
  ]);
  const angleB = firstNumberAfter(source, [
    /\\angle\s*B\s*=\s*(\d+)/i,
    /angle\s*B\s*=\s*(\d+)/i,
    /មុំ\s*B[^\d]*(\d+)/i,
  ]);
  if (!Number.isFinite(angleA) || !Number.isFinite(angleB)) return [];

  const exterior = angleA + angleB;
  const A: [number, number] = [70, 165];
  const B: [number, number] = [250, 165];
  const C: [number, number] = [185, 58];
  const E: [number, number] = [150, 0];

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "triangle", vertices: [A, B, C], labels: ["A", "B", "C"] },
      { shape: "segment", vertices: [C, E], label: "extension", color: "red" },
      { shape: "angle", vertex: A, from: B, to: C, label: `${angleA}°`, radius: 24, color: "muted" },
      { shape: "angle", vertex: B, from: A, to: C, label: `${angleB}°`, radius: 24, color: "muted" },
      { shape: "angle", vertex: C, from: A, to: E, label: `${exterior}°`, radius: 30, color: "red" },
    ],
  }]);
}

function inferCircleInscribedAngleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(circle|រង្វង់|arc|ធ្នូ|inscribed angle|មុំចារឹក)/i.test(source);
  if (!wantsGeometry || !/(circle|រង្វង់)/i.test(source) || !/(arc|ធ្នូ|inscribed angle|មុំចារឹក)/i.test(source)) return [];

  const arcMeasure = firstNumberAfter(source, [
    /(?:arc|ធ្នូ)\s*AB[^\d]*(\d+)/i,
    /AB[^\d]*(\d+)\s*(?:\^\\?circ|°|o)?/i,
    /(\d+)\s*(?:\^\\?circ|°|o)?[^\n]*(?:arc|ធ្នូ)/i,
  ]);
  if (!Number.isFinite(arcMeasure) || arcMeasure <= 0 || arcMeasure >= 360) return [];

  const inscribed = arcMeasure / 2;
  const O: [number, number] = [160, 110];
  const r = 78;
  const startAngle = 210;
  const endAngle = startAngle + arcMeasure;
  const pointAt = (deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [O[0] + Math.cos(rad) * r, O[1] + Math.sin(rad) * r];
  };
  const A = pointAt(startAngle);
  const B = pointAt(endAngle);
  const C: [number, number] = [160, 32];

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "circle", center: O, radius: r, label: "O" },
      { shape: "triangle", vertices: [A, B, C], labels: ["A", "B", "C"] },
      { shape: "segment", vertices: [O, A], color: "muted" },
      { shape: "segment", vertices: [O, B], color: "muted" },
      { shape: "arc", center: O, radius: r + 4, startAngle, endAngle, label: `${arcMeasure}°`, color: "red" },
      { shape: "angle", vertex: C, from: A, to: B, label: `${inscribed}°`, radius: 28, color: "primary" },
    ],
  }]);
}

function inferFerrisWheelBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const problemSource = normalizeDigits(problem);
  const solutionSource = normalizeDigits(solutionText);
  const source = `${problemSource}\n${solutionSource}`;
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(ferris wheel|កង់ហ្វែរីស|circle|រង្វង់|radius|កាំ|ground line|បន្ទាត់ដី|rotational angle|មុំបង្វិល)/i.test(source);
  if (!wantsGeometry || !/(ferris wheel|កង់ហ្វែរីស)/i.test(source)) return [];

  const radiusValue = firstNumberAfter(`${problemSource}\n${solutionSource}`, [
    /(?:radius|កាំ|R)\s*(?:=|:)?\s*(\d+(?:\.\d+)?)/i,
    /(?:radius|កាំ)[^\n]*?(\d+(?:\.\d+)?)/i,
    /R\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  const centerHeight = firstNumberAfter(`${problemSource}\n${solutionSource}`, [
    /(?:center|ផ្ចិត|ចំណុចកណ្តាល)[^\n]*?(?:height|កម្ពស់)?[^\n]*?(\d+(?:\.\d+)?)(?:\s*\\?\s*text\{?m\}?|\s*m)?[^\n]*(?:above|លើ|ដី|ground)/i,
    /(?:height|កម្ពស់)[^\n]*(?:center|ផ្ចិត|ចំណុចកណ្តាល|D)[^\n]*?(\d+(?:\.\d+)?)(?:\s*\\?\s*text\{?m\}?|\s*m)?/i,
    /\bD\s*(?:=|គឺ)\s*(\d+(?:\.\d+)?)/i,
    /\bC(?:enter)?(?:_{shift})?\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  if (!Number.isFinite(radiusValue) || !Number.isFinite(centerHeight) || radiusValue <= 0 || centerHeight <= 0) return [];

  const formulaSource = `${solutionSource}\n${problemSource}`.replace(/\s+/g, "");
  const horizontalStart = /h\(\s*\\theta\s*\)=\d+(?:\.\d+)?\\sin\(\s*\\theta\s*\)\+\d+(?:\.\d+)?/.test(formulaSource)
    || /\\phi=0/.test(formulaSource)
    || /(កម្ពស់ផ្ចិត|center height|ខាងស្តាំ|horizontal)/i.test(source);

  // GeometryDiagram maps y upward. Use drawing units for a readable wheel, while
  // preserving the correct vertical relation: ground is below the wheel center.
  const center: [number, number] = [160, 92];
  const radius = 72;
  const scale = radius / radiusValue;
  const groundY = center[1] - centerHeight * scale;
  const groundLeft: [number, number] = [42, groundY];
  const groundRight: [number, number] = [278, groundY];
  const theta = 45;
  const phi = horizontalStart ? theta : theta - 90;
  const phiRad = (phi * Math.PI) / 180;
  const rimPoint: [number, number] = [
    center[0] + Math.cos(phiRad) * radius,
    center[1] + Math.sin(phiRad) * radius,
  ];
  const bottomPoint: [number, number] = [center[0], center[1] - radius];
  const rightPoint: [number, number] = [center[0] + radius, center[1]];
  const referencePoint = horizontalStart ? rightPoint : bottomPoint;
  const centerGround: [number, number] = [center[0], groundY];

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "segment", vertices: [groundLeft, groundRight], label: "ground", color: "muted" },
      { shape: "circle", center, radius, label: "O" },
      { shape: "segment", vertices: [center, rimPoint], label: `R=${radiusValue} m`, color: "primary" },
      { shape: "segment", vertices: [center, referencePoint], color: "muted" },
      { shape: "angle", vertex: center, from: referencePoint, to: rimPoint, label: "θ", radius: 30, color: "red" },
      { shape: "segment", vertices: [center, centerGround], label: `${centerHeight} m`, color: "green" },
    ],
  }]);
}

function inferLadderRightTriangleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(ladder|ជណ្ដើរ|ជណ្តើរ|wall|ជញ្ជាំង|right triangle|ត្រីកោណកែង|ground|ដី)/i.test(source);
  if (!wantsGeometry || !/(ladder|ជណ្ដើរ|ជណ្តើរ)/i.test(source)) return [];

  const ladderLength = firstNumberAfter(source, [
    /ladder[^\n]*?(\d+(?:\.\d+)?)\s*(?:m|\\text\{m\})?[^\n]*(?:long|length)/i,
    /(?:length|ប្រវែង)[^\n]*(?:ladder|ជណ្ដើរ|ជណ្តើរ|c)[^\n]*?(\d+(?:\.\d+)?)/i,
    /\bc\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  const footDistance = firstNumberAfter(source, [
    /foot[^\n]*?(\d+(?:\.\d+)?)\s*(?:m|\\text\{m\})?[^\n]*(?:wall|ជញ្ជាំង)/i,
    /(?:distance|ចម្ងាយ)[^\n]*(?:wall|ជញ្ជាំង|a)[^\n]*?(\d+(?:\.\d+)?)/i,
    /\ba\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  if (!Number.isFinite(ladderLength) || !Number.isFinite(footDistance) || ladderLength <= 0 || footDistance <= 0 || ladderLength <= footDistance) return [];

  const height = Number(Math.sqrt(ladderLength * ladderLength - footDistance * footDistance).toFixed(6));
  if (!Number.isFinite(height) || height <= 0) return [];

  const wallFoot: [number, number] = [0, 0];
  const ladderFoot: [number, number] = [footDistance, 0];
  const wallTop: [number, number] = [0, height];
  const groundRight: [number, number] = [footDistance + Math.max(1, footDistance * 0.35), 0];
  const wallAbove: [number, number] = [0, height + Math.max(1, height * 0.12)];

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "polygon", vertices: [wallFoot, ladderFoot, wallTop], labels: ["", "", ""] },
      { shape: "segment", vertices: [wallFoot, groundRight], label: "ground", color: "muted" },
      { shape: "segment", vertices: [wallFoot, wallAbove], color: "muted" },
      { shape: "segment", vertices: [wallFoot, ladderFoot], label: `${footDistance} m`, color: "muted" },
      { shape: "segment", vertices: [wallFoot, wallTop], label: `${Number(height.toFixed(2))} m`, color: "green" },
      { shape: "segment", vertices: [ladderFoot, wallTop], label: `${ladderLength} m`, color: "primary" },
      { shape: "angle", vertex: wallFoot, from: ladderFoot, to: wallTop, label: "90°", radius: 20, color: "muted" },
    ],
  }]);
}

function inferVectorRightTriangleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(force|forces|east|north|resultant|vector|magnitude|កម្លាំង|ខាងកើត|ខាងជើង|កម្លាំងសរុប|ពីតាហ្គ័រ|ត្រីកោណកែង)/i.test(source);
  if (!wantsGeometry) return [];

  // Try to find forces/magnitudes in Newtons (N)
  const matches = Array.from(source.matchAll(/(\d+(?:\.\d+)?)\s*(?:N|\\text\{N\}|\bNewtons?\b)/gi));
  let f1 = 0;
  let f2 = 0;
  let fR = 0;

  if (matches.length >= 2) {
    const numbers = matches.map(m => Number(m[1]));
    const uniqueNumbers = [...new Set(numbers)];
    uniqueNumbers.sort((a, b) => a - b);

    if (uniqueNumbers.length === 2) {
      f1 = uniqueNumbers[0];
      f2 = uniqueNumbers[1];
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    } else if (uniqueNumbers.length >= 3) {
      f1 = uniqueNumbers[0];
      f2 = uniqueNumbers[1];
      fR = uniqueNumbers[2];

      const diff = Math.abs(f1 * f1 + f2 * f2 - fR * fR);
      if (diff > 10) {
        f1 = uniqueNumbers[0];
        f2 = uniqueNumbers[1];
        fR = Math.sqrt(f1 * f1 + f2 * f2);
      }
    }
  }

  // Double check with east/north parsing if we don't have valid forces
  if (f1 <= 0 || f2 <= 0) {
    const eastMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:N|Newtons?)?[^\n]*(?:east|ខាងកើត)/i);
    const northMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:N|Newtons?)?[^\n]*(?:north|ខាងជើង)/i);
    if (eastMatch && northMatch) {
      f1 = Number(eastMatch[1]);
      f2 = Number(northMatch[1]);
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    }
  }

  // Check if we still don't have forces, look for generic right triangle sides
  if (f1 <= 0 || f2 <= 0) {
    const numbers = Array.from(source.matchAll(/(?:side|c|a|b|\bប្រវែង\b)[^\d]*?(\d+(?:\.\d+)?)/gi))
      .map(m => Number(m[1]));
    const unique = [...new Set(numbers)];
    if (unique.length >= 2) {
      unique.sort((a, b) => a - b);
      f1 = unique[0];
      f2 = unique[1];
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    }
  }

  if (f1 <= 0 || f2 <= 0 || !Number.isFinite(f1) || !Number.isFinite(f2) || !Number.isFinite(fR)) return [];

  const O: [number, number] = [0, 0];
  const P1: [number, number] = [f1, 0];
  const P2: [number, number] = [f1, f2];

  const paddingX = f1 * 0.15 || 1;
  const paddingY = f2 * 0.15 || 1;

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "polygon", vertices: [O, P1, P2], labels: ["", "", ""] },
      { shape: "arrow", start: O, end: P1, label: `${f1} N (East)`, color: "muted" },
      { shape: "arrow", start: P1, end: P2, label: `${f2} N (North)`, color: "muted" },
      { shape: "arrow", start: O, end: P2, label: `${Number(fR.toFixed(1))} N (Resultant)`, color: "primary" },
      { shape: "angle", vertex: P1, from: O, to: P2, label: "90°", radius: 18, color: "muted" },
    ],
    options: {
      xMin: -paddingX,
      xMax: f1 + paddingX,
      yMin: -paddingY,
      yMax: f2 + paddingY,
    }
  }]);
}

function inferRectangleSemicircleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(rectangle|ចតុកោណ|semicircle|កន្លះរង្វង់|composite|រូបផ្សំ|area|ផ្ទៃក្រឡា)/i.test(source);
  if (!wantsGeometry || !/(rectangle|ចតុកោណ)/i.test(source) || !/(semicircle|កន្លះរង្វង់)/i.test(source)) return [];

  const length = firstNumberAfter(source, [
    /length[^\d]*(\d+(?:\.\d+)?)/i,
    /ប្រវែង[^\d]*(\d+(?:\.\d+)?)/i,
    /l\s*\)?\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  const width = firstNumberAfter(source, [
    /width[^\d]*(\d+(?:\.\d+)?)/i,
    /ទទឹង[^\d]*(\d+(?:\.\d+)?)/i,
    /w\s*\)?\s*=\s*(\d+(?:\.\d+)?)/i,
  ]);
  if (!Number.isFinite(length) || !Number.isFinite(width)) return [];

  const rectLeft = 46;
  const rectTop = 58;
  const rectW = 178;
  const rectH = 116;
  const rectRight = rectLeft + rectW;
  const rectBottom = rectTop + rectH;
  const centerY = rectTop + rectH / 2;
  const radius = rectH / 2;
  const rValue = width / 2;

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      {
        shape: "polygon",
        vertices: [[rectLeft, rectTop], [rectRight, rectTop], [rectRight, rectBottom], [rectLeft, rectBottom]],
        labels: ["", "", "", ""],
        label: `rectangle area=${length}×${width}`,
      },
      {
        shape: "semicircle",
        center: [rectRight, centerY],
        radius,
        startAngle: -90,
        endAngle: 90,
        label: `r=${rValue}`,
        color: "primary",
      },
      {
        shape: "segment",
        vertices: [[rectLeft, rectBottom + 22], [rectRight, rectBottom + 22]],
        label: `${length}`,
        color: "muted",
      },
      {
        shape: "segment",
        vertices: [[rectLeft - 20, rectTop], [rectLeft - 20, rectBottom]],
        label: `${width}`,
        color: "muted",
      },
    ],
  }]);
}

const diagramBlockSchema = {
  type: Type.ARRAY,
  nullable: true,
  items: {
    type: Type.OBJECT,
    properties: {
      diagramType: { type: Type.STRING, enum: ["geometry", "function-graph", "number-line", "sign-table", "venn-diagram", "solid-geometry"] },
      spec: { type: Type.OBJECT },
    },
  },
};

function inferSolidGeometryBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
): RenderBlock[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const hasSolidBlock = emptyBlocks.some((b) => b.diagramType === "solid-geometry");
  const hasKeywords = /(cylinder|ស៊ីឡាំង|cone|កោន|sphere|ស្វ៊ែរ|cube|គូប|pyramid|ពីរ៉ាមីត)/i.test(source);

  if (!hasSolidBlock && !hasKeywords) return [];

  // 1. Cylinder or Cone
  if (/(cylinder|ស៊ីឡាំង|cone|កោន)/i.test(source)) {
    const radius = firstNumberAfter(source, [
      /(?:radius|កាំ|r)\s*(?:=|ស្មើ)?[^\d]*?(\d+(?:\.\d+)?)/i,
      /\br\s*=\s*(\d+(?:\.\d+)?)/i
    ]);
    const height = firstNumberAfter(source, [
      /(?:height|កម្ពស់|h)\s*(?:=|ស្មើ)?[^\d]*?(\d+(?:\.\d+)?)/i,
      /\bh\s*=\s*(\d+(?:\.\d+)?)/i
    ]);
    const shape = /(cone|កោន)/i.test(source) ? "cone" : "cylinder";
    const rVal = Number.isFinite(radius) ? radius : 3;
    const hVal = Number.isFinite(height) ? height : 10;
    return normalizeDiagramBlocks([{
      diagramType: "solid-geometry",
      spec: {
        shape,
        dimensions: { radius: rVal, height: hVal },
        labels: { r: `r=${rVal}`, h: `h=${hVal}` }
      }
    }]);
  }

  // 2. Sphere
  if (/(sphere|ស្វ៊ែរ)/i.test(source)) {
    const radius = firstNumberAfter(source, [
      /(?:radius|កាំ|R|r)\s*(?:=|ស្មើ)?[^\d]*?(\d+(?:\.\d+)?)/i,
      /\bR\s*=\s*(\d+(?:\.\d+)?)/i,
      /\br\s*=\s*(\d+(?:\.\d+)?)/i
    ]);
    const rVal = Number.isFinite(radius) ? radius : 5;
    return normalizeDiagramBlocks([{
      diagramType: "solid-geometry",
      spec: {
        shape: "sphere",
        dimensions: { radius: rVal },
        labels: { R: `R=${rVal}` }
      }
    }]);
  }

  // 3. Cube or Pyramid
  if (/(cube|គូប|pyramid|ពីរ៉ាមីត)/i.test(source) || hasSolidBlock) {
    const edge = firstNumberAfter(source, [
      /(?:edge|side|ជ្រុង|ទ្រនុង|a)\s*(?:=|ស្មើ)?[^\d]*?(\d+(?:\.\d+)?)/i,
      /\ba\s*=\s*(\d+(?:\.\d+)?)/i
    ]);
    const shape = /(pyramid|ពីរ៉ាមីត)/i.test(source) ? "pyramid" : "cube";
    const aVal = Number.isFinite(edge) ? edge : 100;
    return normalizeDiagramBlocks([{
      diagramType: "solid-geometry",
      spec: {
        shape,
        dimensions: { width: aVal, height: aVal, depth: aVal * 0.8 },
        labels: { edge: `a=${aVal}` }
      }
    }]);
  }

  return [];
}

function inferPieChartBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: ReturnType<typeof normalizeDiagramBlocks> = [],
  finalAnswer = "",
): ReturnType<typeof normalizeDiagramBlocks> {
  const source = normalizeDigits(`${problem}\n${finalAnswer}\n${solutionText}`);
  const isPieChart = /(pie.?chart|piechart|តារាងចំណិតជុំ|ចំណិតជុំ|រង្វង់ចំណិត|ចំណិតនំ)/i.test(source);
  if (!isPieChart) return [];

  const sectors: Array<{ label: string; percentage: number }> = [];
  const lines = source.split("\n");
  for (const line of lines) {
    if (line.includes(",") || (line.match(/%/g) || []).length > 1) {
      continue;
    }

    // 1. Try format: <Label> : <Percentage>%   or   <Label> : <something> ( <Percentage>% )
    const match1 = line.match(/(?:[*+-]|\b)\s*([^:\n]+?)\s*:\s*(?:[^%]*?\(\s*([^)]*?\s+|)(\d+(?:\.\d+)?)\s*\\?%|[^%]*?(\d+(?:\.\d+)?)\s*\\?%)/);
    if (match1) {
      const label = match1[1].replace(/[$*{}]/g, "").trim();
      const pctVal = parseFloat(match1[3] ?? match1[4]);
      if (label && Number.isFinite(pctVal) && pctVal > 0 && pctVal <= 100) {
        if (!/^(min|max|q1|q2|q3|minimum|maximum|total|ភាគរយសរុប|មុំសរុប|មុំ|មេដ្យាន)$/i.test(label)) {
          const dupIdx = sectors.findIndex((s) => {
            const labelOverlap = s.label.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(s.label.toLowerCase());
            const pctMatch = s.percentage === pctVal;
            return labelOverlap || pctMatch;
          });
          if (dupIdx !== -1) {
            const existingHasKhmer = /[\u1780-\u17FF]/.test(sectors[dupIdx].label);
            const newHasKhmer = /[\u1780-\u17FF]/.test(label);
            if (newHasKhmer && !existingHasKhmer) {
              sectors[dupIdx].label = label;
            } else if (newHasKhmer === existingHasKhmer) {
              if (label.length < sectors[dupIdx].label.length) {
                sectors[dupIdx].label = label;
              }
            }
          } else {
            sectors.push({ label, percentage: pctVal });
          }
          continue;
        }
      }
    }

    // 2. Try format: <Percentage>% like <Label>  or  <Percentage>% <Label>
    const match2 = line.match(/(?:[*+-]|\b)\s*(\d+(?:\.\d+)?)\s*\\?%\s*(?:like\s+|of\s+|)\s*([^\n]+)/i);
    if (match2) {
      const pctVal = parseFloat(match2[1]);
      let label = match2[2].replace(/[$*{}]/g, "").trim();
      label = label.replace(/^(like|of)\s+/i, "");
      if (label && Number.isFinite(pctVal) && pctVal > 0 && pctVal <= 100) {
        if (!/^(min|max|q1|q2|q3|minimum|maximum|total|ភាគរយសរុប|មុំសរុប|មុំ|មេដ្យាន)$/i.test(label)) {
          const dupIdx = sectors.findIndex((s) => {
            const labelOverlap = s.label.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(s.label.toLowerCase());
            const pctMatch = s.percentage === pctVal;
            return labelOverlap || pctMatch;
          });
          if (dupIdx !== -1) {
            const existingHasKhmer = /[\u1780-\u17FF]/.test(sectors[dupIdx].label);
            const newHasKhmer = /[\u1780-\u17FF]/.test(label);
            if (newHasKhmer && !existingHasKhmer) {
              sectors[dupIdx].label = label;
            } else if (newHasKhmer === existingHasKhmer) {
              if (label.length < sectors[dupIdx].label.length) {
                sectors[dupIdx].label = label;
              }
            }
          } else {
            sectors.push({ label, percentage: pctVal });
          }
          continue;
        }
      }
    }
  }

  const totalPercentage = sectors.reduce((sum, s) => sum + s.percentage, 0);
  logger.info("[inferPieChartBlocks] check:", { isPieChart, totalSectors: sectors.length, sectors, totalPercentage });
  if (sectors.length >= 2 && totalPercentage >= 90 && totalPercentage <= 110) {
    return normalizeDiagramBlocks([{
      diagramType: "pie-chart",
      spec: {
        sectors
      }
    }]);
  }

  return [];
}

async function extractDiagramBlocksForSolution(
  problem: string,
  solutionText: string,
  options: AIRequestOptions,
  finalAnswer?: string,
): Promise<RenderBlock[]> {
  const subject = `${options.subject || ""}`.toLowerCase();
  const source = `${problem}\n${solutionText}`.toLowerCase();
  const likelyUseful = subject.includes("math")
    || subject.includes("physics")
    || /(geometry|triangle|circle|graph|plot|number line|inequal|interval|sign table|variation|derivative|cube|pyramid|cylinder|sphere|coordinate|parabola|quadratic|linear function|venn|set|sets|union|intersection|pie.?chart|piechart|force|resultant|vector)/i.test(source)
    || /[\u1780-\u17FF]*(ត្រីកោណ|រង្វង់|ក្រាប|អនុគមន៍|វិសមភាព|ចន្លោះ|តារាងសញ្ញា|គូប|ពីរ៉ាមីត|ដ្យាក្រាម|សំណុំ|ប្រសព្វ|ត្រួតស៊ី|ចំណិតជុំ|កម្លាំង|កែង|ពីតាហ្គ័រ)/.test(source);
  if (!likelyUseful) return [];

  const result = await generateStructuredJson<{ diagramBlocks?: unknown[] }>({
    prompt: `Decide whether this solved math problem needs a visual diagram. Return JSON only.

If a diagram helps, return exactly ONE diagramBlock (choose the single most helpful diagram type) in this exact structure:
{
  "diagramBlocks": [
    {
      "diagramType": "geometry" | "function-graph" | "number-line" | "sign-table" | "venn-diagram" | "solid-geometry" | "pie-chart",
      "spec": { ... }
    }
  ]
}

If no diagram helps, return {"diagramBlocks":[]}.

CRITICAL: Limit diagram blocks to a maximum of ONE block. Choose the single most helpful diagram type. Never generate multiple diagram blocks.
Every diagramBlock you return MUST have both "diagramType" and a fully populated "spec" with all required fields. If you cannot determine the complete spec values from the problem and solution, return {"diagramBlocks":[]} instead. Never return a diagramBlock with an empty or incomplete spec.
AI must output structured JSON only. Never output SVG, HTML, CSS, or drawing commands.

Problem:
${problem}

Solution:
${solutionText.slice(0, 1800)}

${DIAGRAM_SPEC_GUIDE}`,
    options,
    temperature: 0,
    maxOutputTokens: 2048,
    taskName: "extractDiagramBlocksForSolution",
    maxAttempts: 2,
  });

  const normalized = normalizeDiagramBlocks(result.data?.diagramBlocks);
  // Filter out blocks the normalizer flagged as empty (AI produced a diagram type but no data).
  // This lets the inferVennDiagramBlocks fallback recover values from the solution text.
  // If the problem needs solid-geometry, prioritize our highly robust solid geometry inference.
  // This prevents AI errors (like returning empty specs or defaulting cylinders to cubes).
  if (/(cylinder|ស៊ីឡាំង|cone|កោន|sphere|ស្វ៊ែរ)/i.test(problem + "\n" + solutionText)) {
    const solidFallback = inferSolidGeometryBlocks(problem, solutionText, normalized);
    if (solidFallback.length) return solidFallback;
  }

  const useful = normalized.filter(
    (block) => !Array.isArray(block.warnings) || !block.warnings.some((w) => w.startsWith("empty-"))
  );
  if (useful.length) return useful;

  // Type-specific inference fallbacks — each uses the empty AI blocks as a hint
  const numberLineFallback = inferNumberLineBlocks(problem, solutionText, normalized);
  if (numberLineFallback.length) return numberLineFallback;

  const vennFallback = inferVennDiagramBlocks(problem, solutionText, normalized);
  if (vennFallback.length) return vennFallback;

  const pieChartFallback = inferPieChartBlocks(problem, solutionText, normalized, finalAnswer);
  if (pieChartFallback.length) return pieChartFallback;

  const graphFallback = inferFunctionGraphBlocks(problem, solutionText, normalized, finalAnswer);
  if (graphFallback.length) return graphFallback;

  const signTableFallback = inferSignTableBlocks(problem, solutionText, normalized);
  if (signTableFallback.length) return signTableFallback;

  const triangleFallback = inferTriangleExteriorAngleBlocks(problem, solutionText, normalized);
  if (triangleFallback.length) return triangleFallback;

  const circleFallback = inferCircleInscribedAngleBlocks(problem, solutionText, normalized);
  if (circleFallback.length) return circleFallback;

  const ferrisWheelFallback = inferFerrisWheelBlocks(problem, solutionText, normalized);
  if (ferrisWheelFallback.length) return ferrisWheelFallback;

  const ladderFallback = inferLadderRightTriangleBlocks(problem, solutionText, normalized);
  if (ladderFallback.length) return ladderFallback;

  const vectorFallback = inferVectorRightTriangleBlocks(problem, solutionText, normalized);
  if (vectorFallback.length) return vectorFallback;

  const solidFallback = inferSolidGeometryBlocks(problem, solutionText, normalized);
  if (solidFallback.length) return solidFallback;

  return inferRectangleSemicircleBlocks(problem, solutionText, normalized);
}

// ─── Two-phase generation helpers ────────────────────────────────────────────

/**
 * Phase 1: Generate a free-form solution as plain text.
 * No JSON schema → no truncation risk.
 */
const PHASE1_TIMEOUT_MS = 40_000;

async function generateRawSolution(
  prompt: string,
  options: AIRequestOptions,
  imagePart?: ImagePart,
): Promise<string> {
  const client = getGeminiClient();
  const parts: Part[] = [
    ...(imagePart
      ? [{ inlineData: { data: imagePart.data, mimeType: imagePart.mimeType } } as Part]
      : []),
    { text: prompt },
  ];

  const generatePromise = client.models.generateContent({
    model: env.GEMINI_PRO_MODEL,
    config: {
      systemInstruction: buildSystemInstruction(options),
      temperature: 0.1,
      maxOutputTokens: 8192,
      safetySettings: [
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      ] as any,
    },
    contents: [{ role: "user", parts }],
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`generateRawSolution timed out after ${PHASE1_TIMEOUT_MS}ms`)), PHASE1_TIMEOUT_MS)
  );

  const response = await Promise.race([generatePromise, timeoutPromise]);
  return (response.text ?? "").trim();
}

interface SolutionMetadata {
  title: string;
  subject: string;
  topic: string;
  problem: string;
  finalAnswer: string;
  problemText?: string;
}

/**
 * Phase 2: Extract compact metadata from a raw solution text.
 * Only short string fields — output is always <512 tokens, never truncates.
 */
async function extractSolutionMetadata(
  rawSolution: string,
  problemHint: string,
  options: AIRequestOptions,
  includeProblemText = false,
): Promise<SolutionMetadata> {
  const schemaProperties: Record<string, object> = {
    title: { type: Type.STRING },
    subject: { type: Type.STRING, enum: ["Math", "Physics", "Chemistry"] },
    topic: {
      type: Type.STRING,
      enum: [
        "algebra", "geometry", "calculus", "probability-stats", "arithmetic",
        "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics",
        "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry"
      ]
    },
    problem: { type: Type.STRING },
    finalAnswer: { type: Type.STRING },
  };
  const requiredFields = ["title", "subject", "topic", "problem", "finalAnswer"];

  if (includeProblemText) {
    (schemaProperties as any).problemText = { type: Type.STRING };
    requiredFields.push("problemText");
  }

  const problemTextInstruction = includeProblemText
    ? "\n- problemText: the original problem as extracted from the image, with proper LaTeX"
    : "";

  const prompt = `Extract metadata from this math solution.

SOLUTION:
${rawSolution.slice(0, 4000)}

PROBLEM HINT: "${problemHint.slice(0, 200)}"

Return JSON with:
- title: short descriptive title specifically for the math/science problem itself (max 70 chars). DO NOT use generic words like "Math", "Mathematics", "Physics", "Chemistry", "គណិតវិទ្យា", "រូបវិទ្យា", "គីមីវិទ្យា", "លំហាត់", "លំហាត់គណិតវិទ្យា" or similar. Describe the specific problem (e.g. "គណនាលំដាប់ស៊េរីតេឡេស្កូប", "Evaluate rational integral", "Difference of squares").
- subject: Must be strictly one of: "Math", "Physics", "Chemistry" (and nothing else! No subtopics, no other languages).
- topic: Must be the closest matching sub-subject/topic slug. Read this list carefully and choose the most relevant one:
  * For Math: "algebra" (equations, polynomials, sequences, series), "geometry" (shapes, coordinates, trig), "calculus" (limits, derivatives, integrals), "probability-stats", "arithmetic" (basic numbers, roots, fractions).
  * For Physics: "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics".
  * For Chemistry: "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry".
- problem: the problem statement with proper LaTeX math notation
- finalAnswer: only the final result (e.g. "x = 3", "$v = 12\\ \\text{m/s}$")${problemTextInstruction}`;

  const { data } = await generateStructuredJson<SolutionMetadata>({
    prompt,
    options,
    temperature: 0.1,
    maxOutputTokens: 1536,
    taskName: "extractSolutionMetadata",
    maxAttempts: 2,
    responseSchema: {
      type: Type.OBJECT,
      properties: schemaProperties,
      required: requiredFields,
    },
  });

  const fallbackTitle = problemHint.slice(0, 70) || "New Solution";
  return {
    title: `${data?.title ?? ""}`.trim() || fallbackTitle,
    subject: `${data?.subject ?? ""}`.trim() || options.subject || "Math",
    topic: `${data?.topic ?? ""}`.trim() || "algebra",
    problem: `${data?.problem ?? ""}`.trim() || problemHint,
    finalAnswer: `${data?.finalAnswer ?? ""}`.trim() || "",
    ...(includeProblemText
      ? { problemText: `${(data as any)?.problemText ?? ""}`.trim() || problemHint }
      : {}),
  };
}

export async function solveProblemSolutionFirst(
  problem: string,
  options: AIRequestOptions = {},
  imagePart?: ImagePart
): Promise<ProblemSolutionFirst> {
  const targetLangCode = (options.language ?? "en").toLowerCase();
  const targetLangName = LANGUAGE_NAMES[targetLangCode] ?? "English";
  const subject = options.subject ?? "General";
  const imageContext = imagePart
    ? `The problem was extracted from an attached image. Refer to both image and text.\n\n`
    : "";

  // ── Phase 1: Free-form solve — no JSON schema, no truncation risk ─────────
  const phase1Prompt = `${imageContext}Solve this problem completely and write a professional solution.

Problem: "${problem}"

Requirements:
- All prose MUST be in ${targetLangName}.
- CRITICAL: Every mathematical expression MUST be inside LaTeX delimiters.
  - Inline (short, inside a sentence): $expression$
  - Display (standalone equation on its own line): $$expression$$
  - NEVER write LaTeX commands such as \\binom, \\frac, \\sqrt, \\times, \\begin directly in prose without $ or $$ delimiters.
- Use KaTeX-compatible LaTeX: \\frac{a}{b}, \\sqrt{x}, \\pm, x_1, x_2, \\binom{n}{k}
- For multi-line derivations use: $$\\begin{aligned} ... \\end{aligned}$$
- Do NOT repeat or restate the problem. Begin directly with the solution.
- No "Step 1:", "Step 2:" headers. Let equations flow naturally.
- No internal reasoning or self-corrections. Output only the final polished derivation.
- End with: **Final Answer:** [result]`;

  let rawSolution = "";
  try {
    rawSolution = await generateRawSolution(phase1Prompt, options, imagePart);
  } catch (err) {
    logger.warn("[solveProblemSolutionFirst] Phase 1 failed, falling back to single-phase", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (rawSolution && !isFallbackContent(rawSolution)) {
    const metadata = await extractSolutionMetadata(rawSolution, problem, { ...options, subject });
    if (!isFallbackContent(metadata.finalAnswer)) {
      const diagramBlocks = await extractDiagramBlocksForSolution(problem, rawSolution, { ...options, subject }, metadata.finalAnswer).catch((err) => {
        logger.warn("[solveProblemSolutionFirst] diagram extraction failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
      return normalizeSolutionFirstPayload(
        {
          version: 2,
          mode: "solution-first",
          title: metadata.title,
          subject: metadata.subject,
          topic: metadata.topic,
          problem: metadata.problem || problem,
          finalAnswer: metadata.finalAnswer,
          solutionText: rawSolution,
          solutionFormat: "markdown-latex",
          diagramBlocks,
          explanationStatus: "not_generated",
          explanation: null,
          insights: { simpleBreakdown: "", keyFormula: "" },
        },
        problem,
        subject,
      );
    }
  }

  // ── Fallback: Single-phase with generous token budget ─────────────────────
  const prompt = `${imageContext}Solve this problem in a solution-first format.

Problem: "${problem}"

Return the result as JSON only.

Rules:
1. All prose MUST be in ${targetLangName}.
2. Do NOT create a step-by-step explanation tree.
3. solutionText should look like a clean, professional, A+ student-written solution.
4. solutionText should be mostly equations and short labels. Avoid explanatory sentences.
5. Use KaTeX-friendly LaTeX for math. For multi-line math, make solutionText one display block like "$$\\begin{aligned} ... \\end{aligned}$$".
6. finalAnswer must be the final answer only.
7. explanationStatus must be "not_generated" and explanation must be null.
8. Use exact LaTeX commands: \\frac{numerator}{denominator}, \\sqrt{value}, \\pm, x_1, x_2.
9. Never output placeholder boxes, "extpm", "extradical", "/frac", "/sqrt", or standalone "$" lines.
10. Do not put prose sentences inside $$...$$, \\begin{aligned}, or any math block.
11. Do not use single "$" inline delimiters unless they are correctly paired on the same line.
12. CRITICAL: NEVER include your internal reasoning process, self-corrections, or conversational filler.
13. ABSOLUTELY FORBIDDEN: Phrases like "Wait," "Let me recheck," "I made a mistake," "Let's recalculate," or "I found a different solution online."
14. Finality: Perform all reasoning internally. Output ONLY the final, polished, and correct mathematical derivation. It should look like a finished exam paper, not a scratchpad.
15. Do NOT use "Step 1:", "Step 2:", or any numbered step headers. The solution should flow naturally.
16. title: Must be a short descriptive title specifically for this problem (max 70 chars). DO NOT use generic words like "Math", "Mathematics", "Physics", "Chemistry", "គណិតវិទ្យា", "រូបវិទ្យា", "គីមីវិទ្យា", "លំហាត់", "លំហាត់គណិតវិទ្យា" or similar.
17. subject: Must be strictly one of: "Math", "Physics", "Chemistry". No subtopics, no other languages, no other subjects.
18. topic: Must be the closest matching sub-subject/topic slug. Read this list carefully and choose the most relevant one:
  * For Math: "algebra", "geometry", "calculus", "probability-stats", "arithmetic".
  * For Physics: "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics".
  * For Chemistry: "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry".
19. Optional diagramBlocks: include only when a visual meaningfully helps. Output structured diagram JSON only, never SVG/HTML. Supported diagramType values: "number-line", "sign-table", "venn-diagram", "geometry", "function-graph", "solid-geometry".`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      version: { type: Type.NUMBER },
      mode: { type: Type.STRING, enum: ["solution-first"] },
      title: { type: Type.STRING },
      subject: { type: Type.STRING, enum: ["Math", "Physics", "Chemistry"] },
      topic: {
        type: Type.STRING,
        enum: [
          "algebra", "geometry", "calculus", "probability-stats", "arithmetic",
          "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics",
          "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry"
        ]
      },
      problem: { type: Type.STRING },
      finalAnswer: { type: Type.STRING },
      solutionText: { type: Type.STRING },
      diagramBlocks: diagramBlockSchema,
      solutionFormat: { type: Type.STRING, enum: ["markdown-latex"] },
      explanationStatus: { type: Type.STRING, enum: ["not_generated"] },
      explanation: { type: Type.OBJECT, nullable: true },
      insights: {
        type: Type.OBJECT,
        properties: {
          simpleBreakdown: { type: Type.STRING },
          keyFormula: { type: Type.STRING },
        },
      },
    },
    required: [
      "version",
      "mode",
      "title",
      "subject",
      "topic",
      "problem",
      "finalAnswer",
      "solutionText",
      "solutionFormat",
      "explanationStatus",
    ],
  };

  const primary = await generateStructuredJson<ProblemSolutionFirst>({
    prompt: `${prompt}\n${DIAGRAM_SPEC_GUIDE}`,
    options,
    temperature: 0.15,
    maxOutputTokens: 8192,
    taskName: "solveProblemSolutionFirst",
    maxAttempts: 2,
    imagePart,
    responseSchema: schema,
  });

  if (isUsableProblemSolutionFirst(primary.data)) {
    const diagramBlocks = normalizeDiagramBlocks(primary.data.diagramBlocks).length
      ? primary.data.diagramBlocks
      : await extractDiagramBlocksForSolution(problem, `${primary.data.solutionText}\n${primary.data.finalAnswer}`, { ...options, subject: primary.data.subject }).catch(() => []);
    return normalizeSolutionFirstPayload({ ...primary.data, diagramBlocks }, problem, subject);
  }

  const recovery = await generateStructuredJson<ProblemSolutionFirst>({
    prompt: `${prompt}

Return ONE complete JSON object only. Keep it compact and include a usable solutionText.`,
    options,
    temperature: 0.1,
    maxOutputTokens: 8192,
    taskName: "solveProblemSolutionFirstRecovery",
    maxAttempts: 1,
    imagePart,
    noJsonMime: true,
  });

  if (isUsableProblemSolutionFirst(recovery.data)) {
    return normalizeSolutionFirstPayload(recovery.data, problem, subject);
  }

  return normalizeSolutionFirstPayload(
    buildFallbackSolutionFirst(problem, subject, recovery.raw || primary.raw),
    problem,
    subject,
  );
}

// ─── Solve directly from image (OCR + solve in a single Gemini call) ─────────
// Replaces the sequential extractProblemFromImage → solveProblemSolutionFirst
// pattern used in /instant-session. One round-trip instead of 2-4.

export async function solveFromImageDirect(
  imagePart: ImagePart,
  options: AIRequestOptions = {}
): Promise<{ problemText: string; solution: ProblemSolutionFirst }> {
  const targetLangCode = (options.language ?? "en").toLowerCase();
  const targetLangName = LANGUAGE_NAMES[targetLangCode] ?? "English";

  // ── Phase 1: Free-form vision solve — no JSON, no truncation risk ─────────
  const phase1Prompt = `You are a math and science tutor with vision capabilities.

Look at this image carefully.
1. Extract the problem text exactly as written, using KaTeX-compatible LaTeX ($...$ inline, $$...$$ display).
2. Solve the problem completely in a clean professional format.

ALL prose MUST be in ${targetLangName}.

Solution format:
- Clean student-written style, mostly equations with short labels.
- No "Step 1:", "Step 2:" headers. Let equations flow naturally.
- For multi-line derivations: $$\\begin{aligned} ... \\end{aligned}$$
- Use exact LaTeX: \\frac{a}{b}, \\sqrt{x}, \\pm, x_1, x_2
- No internal reasoning, no self-corrections. Output only the final polished derivation.

End your response with:
**Problem:** [the extracted problem statement with LaTeX]
**Final Answer:** [the final result]`;

  let rawSolution = "";
  try {
    rawSolution = await generateRawSolution(phase1Prompt, options, imagePart);
  } catch (err) {
    logger.warn("[solveFromImageDirect] Phase 1 failed, falling back to single-phase", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (rawSolution && !isFallbackContent(rawSolution)) {
    const problemTextMatch = rawSolution.match(/\*\*Problem:\*\*\s*(.+?)(?:\n|$)/i);
    const extractedHint = problemTextMatch?.[1]?.trim() || "";

    const metadata = await extractSolutionMetadata(rawSolution, extractedHint, options, true);
    const finalProblemText = (metadata.problemText || extractedHint || "").trim();

    if (finalProblemText && !isFallbackContent(finalProblemText) && !isFallbackContent(metadata.finalAnswer)) {
      const diagramBlocks = await extractDiagramBlocksForSolution(finalProblemText, rawSolution, { ...options, subject: metadata.subject }, metadata.finalAnswer).catch((err) => {
        logger.warn("[solveFromImageDirect] diagram extraction failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
      const solution = normalizeSolutionFirstPayload(
        {
          version: 2,
          mode: "solution-first",
          title: metadata.title,
          subject: metadata.subject,
          topic: metadata.topic,
          problem: metadata.problem || finalProblemText,
          finalAnswer: metadata.finalAnswer,
          solutionText: rawSolution,
          solutionFormat: "markdown-latex",
          diagramBlocks,
          explanationStatus: "not_generated",
          explanation: null,
          insights: { simpleBreakdown: "", keyFormula: "" },
        },
        finalProblemText,
        metadata.subject,
      );
      return { problemText: finalProblemText, solution };
    }
  }

  // ── Fallback: Single-phase with generous token budget ─────────────────────
  const prompt = `You are a math and science tutor with vision capabilities.

Look at this image carefully.
1. Extract the problem text exactly as written, preserving all math notation using KaTeX-compatible LaTeX (use $...$ for inline, $$...$$ for display).
2. Solve the problem completely in a solution-first format.

ALL prose text (title, subject, problemText, solutionText, finalAnswer) MUST be in ${targetLangName}.

Rules for solutionText:
- Should look like a clean student-written solution submitted to a teacher.
- Mostly equations and short labels, minimal explanatory prose.
- CRITICAL: Do NOT use "Step 1:", "Step 2:", or numbered step headers. Focus on a natural mathematical flow.
- For multi-line math, use one display block: $$\\begin{aligned} ... \\end{aligned}$$
- Use exact KaTeX LaTeX: \\frac{a}{b}, \\sqrt{x}, \\pm, x_1, x_2
- Do not use placeholder boxes, "extpm", "extradical", "/frac", "/sqrt", or standalone "$" lines.
- finalAnswer must be the final answer only.
- explanationStatus must be "not_generated", explanation must be null.
- title: Must be a short descriptive title specifically for this problem (max 70 chars). DO NOT use generic words like "Math", "Mathematics", "Physics", "Chemistry", "គណិតវិទ្យា", "រូបវិទ្យា", "គីមីវិទ្យា", "លំហាត់", "លំហាត់គណិតវិទ្យា" or similar.
- subject: Must be strictly one of: "Math", "Physics", "Chemistry". No subtopics, no other languages, no other subjects.
- topic: Must be the closest matching sub-subject/topic slug. Read this list carefully and choose the most relevant one:
  * For Math: "algebra", "geometry", "calculus", "probability-stats", "arithmetic".
  * For Physics: "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics".
  * For Chemistry: "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry".
- Optional diagramBlocks: include only when a visual meaningfully helps. Output structured diagram JSON only, never SVG/HTML. Supported diagramType values: "number-line", "sign-table", "venn-diagram", "geometry", "function-graph", "solid-geometry".
- Diagram spec examples:
  number-line: {"ranges":[{"from":-2,"to":3,"closedStart":true,"closedEnd":false}]}
  sign-table: {"rows":[{"label":"x","values":["-∞","2","+∞"]},{"label":"f(x)","signs":["+","0","-"]}]}
  venn-diagram: {"sets":[{"label":"M","total":20},{"label":"S","total":15}],"intersection":8,"regions":{"leftOnly":12,"intersection":8,"rightOnly":7}}
  geometry: {"shapes":[{"shape":"triangle","vertices":[[0,0],[100,0],[50,80]],"labels":["A","B","C"]}]}
  function-graph: {"functions":[{"kind":"quadratic","params":{"a":1,"b":0,"c":0},"latex":"y=x^2"}],"domain":[-5,5],"range":[-2,25]}
  solid-geometry: {"shape":"cube" | "pyramid" | "cylinder" | "cone" | "sphere","dimensions":{"width":100,"height":100,"depth":80},"labels":{"edge":"a"}}

Return a single JSON object only.`;

  const fallbackSchema = {
    type: Type.OBJECT,
    properties: {
      version: { type: Type.NUMBER },
      mode: { type: Type.STRING, enum: ["solution-first"] },
      title: { type: Type.STRING },
      subject: { type: Type.STRING, enum: ["Math", "Physics", "Chemistry"] },
      topic: {
        type: Type.STRING,
        enum: [
          "algebra", "geometry", "calculus", "probability-stats", "arithmetic",
          "mechanics", "electromagnetism", "thermodynamics", "optics-waves", "modern-physics",
          "general-chemistry", "organic-chemistry", "inorganic-chemistry", "physical-chemistry", "biochemistry"
        ]
      },
      problem: { type: Type.STRING },
      problemText: { type: Type.STRING },
      finalAnswer: { type: Type.STRING },
      solutionText: { type: Type.STRING },
      diagramBlocks: diagramBlockSchema,
      solutionFormat: { type: Type.STRING, enum: ["markdown-latex"] },
      explanationStatus: { type: Type.STRING, enum: ["not_generated"] },
      explanation: { type: Type.OBJECT, nullable: true },
      insights: {
        type: Type.OBJECT,
        properties: {
          simpleBreakdown: { type: Type.STRING },
          keyFormula: { type: Type.STRING },
        },
      },
    },
    required: [
      "version",
      "mode",
      "title",
      "subject",
      "topic",
      "problem",
      "problemText",
      "finalAnswer",
      "solutionText",
      "solutionFormat",
      "explanationStatus",
    ],
  };

  const result = await generateStructuredJson<{ problemText: string } & ProblemSolutionFirst>({
    prompt,
    options,
    temperature: 0.1,
    maxOutputTokens: 8192,
    taskName: "solveFromImageDirect",
    maxAttempts: 2,
    imagePart,
    noJsonMime: true,
    responseSchema: fallbackSchema,
  });

  const data = result.data;
  const extractedProblemText = (data?.problemText ?? "").trim();

  if (data && extractedProblemText && isUsableProblemSolutionFirst(data)) {
    const diagramBlocks = normalizeDiagramBlocks(data.diagramBlocks).length
      ? data.diagramBlocks
      : await extractDiagramBlocksForSolution(extractedProblemText, `${data.solutionText}\n${data.finalAnswer}`, { ...options, subject: data.subject }).catch((err) => {
        logger.warn("[solveFromImageDirect] fallback diagram extraction failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      });
    const solution = normalizeSolutionFirstPayload(
      { ...data, diagramBlocks },
      extractedProblemText,
      data.subject ?? "General"
    );
    return { problemText: extractedProblemText, solution };
  }

  const fallbackProblem = extractedProblemText || "Problem could not be read from image";
  const fallbackSubject = (data as any)?.subject ?? "General";
  const solution = normalizeSolutionFirstPayload(
    buildFallbackSolutionFirst(fallbackProblem, fallbackSubject, result.raw),
    fallbackProblem,
    fallbackSubject
  );
  return { problemText: fallbackProblem, solution };
}

export async function breakdownProblem(
  problem: string,
  options: AIRequestOptions = {},
  imagePart?: ImagePart,
  solutionContext?: string
): Promise<ProblemBreakdown> {
  const targetLangCode = (options.language ?? "en").toLowerCase();
  const targetLangName = LANGUAGE_NAMES[targetLangCode] ?? "English";

  const imageContext = imagePart
    ? `The problem text was extracted from an attached image. Use both the image and the extracted text to build the tree.\n\n`
    : "";

  const solutionRef = solutionContext
    ? `\n\nREFERENCE SOLUTION (Use this to build the steps):
${solutionContext}`
    : "";

  const prompt = `${imageContext}Analyze and break down this problem into a detailed concept tree (5-8 nodes).
  
Problem: "${problem}"${solutionRef}

Rules:
1. All text MUST be in ${targetLangName}.
2. Use standard LaTeX for math ($...$). In 'description' and 'label' fields, write plain English sentences — never use bare LaTeX commands (like \\matrix, \\vec, \\frac) outside of $...$ delimiters.
3. Hierarchy (STRICT): 
   - 1 root node (parentId: null).
   - 3-5 branch nodes (logical steps). ALL branch nodes MUST have parentId: "root".
   - 1-2 leaf nodes (concepts/formulas). EACH leaf node MUST have parentId set to the specific "id" of the branch (step) it supports.
4. The final branch node MUST show the definitive final answer.
5. mathContent MUST be math only, never prose. It must be valid KaTeX-compatible LaTeX wrapped in $...$ or $$...$$.
6. For multi-step mathContent, use one display block with \\begin{aligned} ... \\end{aligned}. Do NOT use manual spacing commands (like \\text{ } or \\quad or \\qquad repeated multiple times) to align or indent math blocks. Use clean, minimal LaTeX alignment. Example: "$$\\begin{aligned} f'(x)&=e^x+\\sin x-\\cos x \\\\ g'(x)&=2x \\\\ \\lim_{x\\to 0}\\frac{f'(x)}{g'(x)}&=\\lim_{x\\to 0}\\frac{e^x+\\sin x-\\cos x}{2x} \\end{aligned}$$".
7. Never write plain-text fake math in mathContent, such as "ex", "limx o_0", "(f'(x))/(g'(x))", or "=>". Use $e^x$, $\\lim_{x\\to 0}$, $\\frac{f'(x)}{g'(x)}$, and $\\Rightarrow$.
8. Even for "Problem Analysis" or "Stating Given Values", provide the relevant variables or formula (e.g., $A = \\frac{1}{2}bh$ or $b=13, h=14$).
9. Do NOT use vague placeholders like "apply formula", "known values -> unknown", or generic template text.
10. Every step MUST have a corresponding math block to ground the explanation in actual numbers/symbols.
11. title: Must be a short descriptive title specifically for this problem (max 70 chars). DO NOT use generic words like "Math", "Mathematics", "Physics", "Chemistry", "គណិតវិទ្យា", "រូបវិទ្យា", "គីមីវិទ្យា", "លំហាត់", "លំហាត់គណិតវិទ្យា" or similar.
12. subject: Must be strictly one of: "Math", "Physics", "Chemistry". No subtopics, no other languages, no other subjects.`;

  const nodeSchema = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      type: { type: Type.STRING, enum: ["root", "branch", "leaf"] },
      label: { type: Type.STRING },
      description: { type: Type.STRING },
      mathContent: { type: Type.STRING },
      keyFormula: { type: Type.STRING },
      parentId: { type: Type.STRING },
    },
    required: ["id", "type", "label", "description", "mathContent"],
  };

  const schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      subject: { type: Type.STRING, enum: ["Math", "Physics", "Chemistry"] },
      nodes: {
        type: Type.ARRAY,
        items: nodeSchema,
        minItems: 5,
        description: "List of at least 5 nodes covering the full solution"
      },
      insights: {
        type: Type.OBJECT,
        properties: {
          simpleBreakdown: { type: Type.STRING },
          keyFormula: { type: Type.STRING },
        },
        required: ["simpleBreakdown", "keyFormula"],
      },
    },
    required: ["title", "subject", "nodes", "insights"],
  };

  const primary = await generateStructuredJson<ProblemBreakdown>({
    prompt,
    options,
    temperature: 0.2,
    maxOutputTokens: 8192,
    taskName: "breakdownProblem",
    maxAttempts: 3,
    imagePart,
    responseSchema: schema,
  });

  if (isUsableProblemBreakdown(primary.data)) {
    return sanitizeBreakdownNodes(primary.data);
  }

  // Recovery pass: disable JSON mime/schema and force strict JSON object output.
  const recovery = await generateStructuredJson<ProblemBreakdown>({
    prompt: `${prompt}

Return ONE complete JSON object only. Ensure every branch includes concrete math transformations for this exact problem.`,
    options,
    temperature: 0.15,
    maxOutputTokens: 8192,
    taskName: "breakdownProblemRecovery",
    maxAttempts: 2,
    imagePart,
    noJsonMime: true,
  });

  if (isUsableProblemBreakdown(recovery.data)) {
    return sanitizeBreakdownNodes(recovery.data);
  }

  return buildFallbackBreakdown(
    problem,
    options.subject ?? "General",
    recovery.raw || primary.raw,
    options.language
  );
}

export async function instantBreakdown(
  imagePart: ImagePart,
  options: AIRequestOptions = {}
): Promise<ProblemBreakdown & { problemText: string }> {
  const targetLangCode = (options.language ?? "en").toLowerCase();
  const targetLangName = LANGUAGE_NAMES[targetLangCode] ?? "English";

  const prompt = `Extract and analyze the math/science problem from this image. 
  1. Transcribe the full problem text into "problemText".
  2. Create a comprehensive neural concept tree with 5-7 nodes.
  3. Hierarchy (STRICT): 
     - 1 root node (parentId: null).
     - 3-4 branch nodes (logical steps). ALL branch nodes MUST have parentId: "root".
     - 1-2 leaf nodes (concepts/formulas). EACH leaf node MUST have parentId set to the specific "id" of the branch (step) it supports.
  4. Include ALL logical steps of the solution.
  5. The final branch node MUST contain the final answer/result.
  6. All text MUST be in ${targetLangName}.
  7. Use standard LaTeX for math ($...$).
  8. title: Must be a short descriptive title specifically for this problem (max 70 chars). DO NOT use generic words like "Math", "Mathematics", "Physics", "Chemistry", "គណិតវិទ្យា", "រូបវិទ្យា", "គីមីវិទ្យា", "លំហាត់", "លំហាត់គណិតវិទ្យា" or similar.
  9. subject: Must be strictly one of: "Math", "Physics", "Chemistry". No subtopics, no other languages, no other subjects.
  10. Do NOT use manual spacing commands (like \\text{ } or \\quad or \\qquad repeated multiple times) to align or indent math blocks. Use clean, minimal LaTeX alignment.`;

  const nodeSchema = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      type: { type: Type.STRING, enum: ["root", "branch", "leaf"] },
      label: { type: Type.STRING },
      description: { type: Type.STRING },
      mathContent: { type: Type.STRING },
      keyFormula: { type: Type.STRING },
      parentId: { type: Type.STRING },
    },
    required: ["id", "type", "label", "description"],
  };

  const schema = {
    type: Type.OBJECT,
    properties: {
      problemText: { type: Type.STRING },
      title: { type: Type.STRING },
      subject: { type: Type.STRING, enum: ["Math", "Physics", "Chemistry"] },
      nodes: {
        type: Type.ARRAY,
        items: nodeSchema,
        minItems: 5
      },
      insights: {
        type: Type.OBJECT,
        properties: {
          simpleBreakdown: { type: Type.STRING },
          keyFormula: { type: Type.STRING },
        },
        required: ["simpleBreakdown", "keyFormula"],
      },
    },
    required: ["problemText", "title", "subject", "nodes", "insights"],
  };

  const primary = await generateStructuredJson<ProblemBreakdown & { problemText: string }>({
    prompt,
    options,
    temperature: 0.1,
    maxOutputTokens: 8192,
    taskName: "instantBreakdown",
    maxAttempts: 2,
    imagePart,
    responseSchema: schema,
  });

  if (primary.data && isUsableProblemBreakdown(primary.data)) {
    const sanitized = sanitizeBreakdownNodes(primary.data);
    return { ...sanitized, problemText: primary.data.problemText || sanitized.title };
  }

  const recovery = await generateStructuredJson<ProblemBreakdown & { problemText: string }>({
    prompt: `${prompt}

Return ONE complete JSON object only. Ensure all steps are concrete to the extracted problem.`,
    options,
    temperature: 0.1,
    maxOutputTokens: 8192,
    taskName: "instantBreakdownRecovery",
    maxAttempts: 2,
    imagePart,
    noJsonMime: true,
  });

  if (recovery.data && isUsableProblemBreakdown(recovery.data)) {
    const sanitized = sanitizeBreakdownNodes(recovery.data);
    const probText = recovery.data.problemText || primary.data?.problemText || sanitized.title;
    return { ...sanitized, problemText: probText };
  }

  return {
    ...buildFallbackBreakdown(
      "Could not analyze image",
      options.subject ?? "General",
      recovery.raw || primary.raw,
      options.language
    ),
    problemText: "Could not analyze image"
  };
}

function stripLatexTabularEnv(text: string): string {
  if (!text) return text;
  let result = text
    .replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, '')
    .replace(/\\begin\{array\}[\s\S]*?\\end\{array\}/g, '')
    .replace(/\\hline\b/g, '')
    .replace(/(?:^|\n)(?:\s*&\s*)+(?:\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Strip raw sign-table OCR data: lines that look like isolated sign-table cell sequences
  // Pattern: text containing sign table column headers (M ... Δ/Delta ... P ... S) followed
  // by lists of math sign values ($+$, $-$, $0$, $\frac{...}$, $\ominus$, $-\infty$, etc.)
  if (/\bM\b[\s\S]{0,60}(?:\\Delta|\$\\Delta\$|Δ)[\s\S]{0,60}\bP\b[\s\S]{0,60}\bS\b/i.test(result)) {
    // Remove the sign table header/data lines — keep only text before the "M Δ P S" pattern
    result = result.replace(/\bM\b[\s\S]*(?:\$[^$]+\$\s*){3,}[\s\S]*/g, '').trim();
    // Also strip isolated single-char math sign lines like "$+$", "$-$", "$0$"
    result = result
      .split('\n')
      .filter(line => !/^\s*\$[+\-0\\]\S*\$\s*$/.test(line))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return result;
}

const MATH_DELIMITER_REGEX = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/;
const LATEX_COMMAND_SIGNAL_REGEX = /\\[a-zA-Z]+|[A-Za-z0-9]\s*[\^_]\s*[A-Za-z0-9{(]/;
const PLAIN_MATH_SIGNAL_REGEX = /(?:=>|⇒|->|→|=|\/|\^|_|\bf\s*'\s*\(|\bg\s*'\s*\(|\blim\s*x|\blimx|\bcos\b|\bsin\b|\btan\b)/i;

function looksLikePlainMathContent(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  if (MATH_DELIMITER_REGEX.test(trimmed)) return false;
  if (!PLAIN_MATH_SIGNAL_REGEX.test(trimmed)) return false;

  const proseWords = trimmed.match(/\b[A-Za-z]{5,}\b/g) ?? [];
  if (proseWords.length > 2) return false;
  return /[=+\-*/^_()']|=>|⇒|->|→/.test(trimmed);
}

function normalizePlainMathContent(text: string): string {
  return (text ?? "")
    .replace(/[−–]/g, "-")
    .replace(/⇒|=>/g, "\\Rightarrow")
    .replace(/→|->/g, "\\to")
    .replace(/\blimx\s*(?:o(?:_\{?0\}?)?|0|to)?\s*[₀0]?\b/gi, "\\lim_{x \\to 0}")
    .replace(/\blim\s*x\s*(?:\\to|to)?\s*([₀0])\b/gi, "\\lim_{x \\to 0}")
    .replace(/\blim\s*x\s*\\to\s*([A-Za-z0-9]+)/gi, "\\lim_{x \\to $1}")
    .replace(/\bex\b/g, "e^x")
    .replace(/(?<!\\)\bcos\s*x\b/g, "\\cos x")
    .replace(/(?<!\\)\bsin\s*x\b/g, "\\sin x")
    .replace(/(?<!\\)\btan\s*x\b/g, "\\tan x")
    .replace(/(?<!\\)\bcos\s*\(/g, "\\cos(")
    .replace(/(?<!\\)\bsin\s*\(/g, "\\sin(")
    .replace(/(?<!\\)\btan\s*\(/g, "\\tan(")
    .replace(/(\\lim_\{x \\to 0\})\}+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function stripRepeatedTextSpacePadding(raw: string): string {
  // Gemini sometimes pads aligned blocks with hundreds of \text{ } tokens.
  // Collapse any run of 2+ consecutive \text{ } or \text{} into a single space.
  return raw
    .replace(/(?:\\text\{[ ]*\}\s*){2,}/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * When AI generates `\text{Khmer prose} math \text{Khmer prose}` inside mathContent,
 * KaTeX cannot render non-Latin inside \text{} — it leaks literal "text" and stray `}`.
 * This function detects that pattern (before any $...$ wrapping) and converts it to
 * a prose+math mixed string like `Khmer prose $math$ Khmer prose` that buildRenderBlocks
 * can correctly segment into text + math blocks.
 *
 * Only acts when \text{} contains non-ASCII (Khmer, Arabic, etc.).
 * Skips \begin{aligned} blocks — those are handled separately.
 */
function demoteNonLatinTextCommands(raw: string): string {
  // Only act if there's non-ASCII inside \text{}
  if (!/\\text\{[^}]*[^\x00-\x7F][^}]*\}/.test(raw)) return raw;
  // Don't restructure aligned environments — too complex
  if (/\\begin\{aligned\}/.test(raw)) return raw;

  // Strip outer math delimiters so we can work on the inner expression
  let inner = raw.trim();
  if (/^\$\$[\s\S]+\$\$$/.test(inner)) inner = inner.slice(2, -2).trim();
  else if (/^\$[^$]+\$$/.test(inner)) inner = inner.slice(1, -1).trim();

  const parts: string[] = [];
  const TEXT_CMD_RE = /\\text\{([^}]*)\}/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TEXT_CMD_RE.exec(inner)) !== null) {
    const mathPart = inner.slice(lastIndex, m.index).trim();
    const textPart = m[1].trim();
    if (mathPart) parts.push(`$${mathPart}$`);
    if (textPart) parts.push(textPart);
    lastIndex = m.index + m[0].length;
  }

  const tail = inner.slice(lastIndex).trim();
  if (tail) parts.push(`$${tail}$`);

  // Remove empty math delimiters that result from empty math segments
  return parts
    .join(" ")
    .replace(/\$\s*\$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeNodeMathContent(raw: string): string {
  let text = normalizeMathExpression(stripLatexTabularEnv(stripRepeatedTextSpacePadding(raw ?? "")));
  if (!text) return "";

  // Demote \text{non-Latin} commands BEFORE delimiter wrapping so KaTeX never
  // tries to render Khmer/Arabic/etc. inside a math context.
  text = demoteNonLatinTextCommands(text);

  text = text
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
    .replace(/\\\$/g, "$")
    .trim();

  // Salvage malformed delimiter sequences by dropping stray dollars before re-wrapping.
  const dollarCount = (text.match(/\$/g) ?? []).length;
  if (dollarCount % 2 !== 0) {
    text = text.replace(/\$/g, "").trim();
  }

  if (looksLikePlainMathContent(text)) {
    text = normalizePlainMathContent(text);
    return normalizeMathSegments(`$$${text}$$`);
  }

  if (!MATH_DELIMITER_REGEX.test(text) && LATEX_COMMAND_SIGNAL_REGEX.test(text)) {
    text = text.includes("\n") ? `$$${text}$$` : `$${text}$`;
  }

  return normalizeMathSegments(text);
}

function sanitizeBreakdownNodes(bd: ProblemBreakdown): ProblemBreakdown {
  const nodes = Array.isArray(bd?.nodes) ? bd.nodes : [];
  logger.info(`[DEBUG:AI:BEFORE_SANITIZE] Task: breakdown`, {
    nodes: nodes.map(n => ({ id: n.id, label: n.label, desc: n.description, math: n.mathContent }))
  });

  const sanitized = {
    ...bd,
    nodes: nodes.map((node) => {
      const normalizedLabel = deepNormalizeMathProse(stripLatexTabularEnv(node.label ?? ""));
      const normalizedDescription = normalizeDescriptionText(stripLatexTabularEnv(node.description ?? ""));
      const normalizedMathContent = node.mathContent ? normalizeNodeMathContent(node.mathContent) : node.mathContent;
      const normalizedKeyFormula = normalizeNodeKeyFormula(
        node.keyFormula ?? "",
        normalizedMathContent || normalizedLabel || ""
      );

      // Infer missing type: recovery responses often omit it.
      const inferredType: BreakdownNode["type"] =
        node.type ||
        (node.id === "root" || node.parentId == null ? "root" : "branch");

      return {
        ...node,
        type: inferredType,
        label: normalizedLabel,
        description: normalizedDescription,
        mathContent: normalizedMathContent,
        keyFormula: normalizedKeyFormula,
        labelBlocks: buildRenderBlocks(normalizedLabel),
        descriptionBlocks: buildRenderBlocks(normalizedDescription),
        // Use buildRenderBlocks (not buildMathBlocks) so that mixed prose+math mathContent
        // (e.g. "ដឺក្រេ $n = 3$ (ចំនួនSES)") keeps its text blocks instead of filtering them out.
        mathBlocks: buildRenderBlocks(normalizedMathContent || normalizedKeyFormula, { defaultDisplay: true }),
      };
    }),
  };

  logger.info(`[DEBUG:AI:AFTER_SANITIZE] Task: breakdown`, {
    nodes: sanitized.nodes.map(n => ({ id: n.id, label: n.label, desc: n.description, math: n.mathContent }))
  });

  return sanitized;
}

// ─── Expand a single node into sub-steps ──────────────────────────────────────

type ExpandNodeContext = {
  nodeDescription?: string;
  previousStep?: string;
  nextStep?: string;
  fullSolution?: string;
};

export async function expandNode(
  nodeLabel: string,
  nodeMathContent: string,
  parentProblem: string,
  options: AIRequestOptions = {},
  context: ExpandNodeContext = {}
): Promise<Omit<BreakdownNode, 'parentId'>[]> {
  const contextBlock = [
    context.nodeDescription ? `Parent step explanation: ${context.nodeDescription}` : "",
    context.previousStep ? `Previous visible step: ${context.previousStep}` : "",
    context.nextStep ? `Next visible step: ${context.nextStep}` : "",
    context.fullSolution ? `Full solution reference:\n${context.fullSolution}` : "",
  ].filter(Boolean).join("\n\n");

  const prompt = `A student is solving this problem: "${parentProblem}"

They are stuck on this exact calculation step:
- Step title: "${nodeLabel}"
- Step math/result: "${nodeMathContent}"
${contextBlock ? `\nHelpful context:\n${contextBlock}\n` : ""}

Break THIS STEP into the actual smaller calculation moves used to arrive at the parent step.

This is NOT a place to generate random hints, definitions, motivational text, or neighboring solution steps.
The sub-steps must reconstruct the parent step's math/result from the prior known expression or from the operation named by the parent step.
Do not merely rewrite the parent step as multiple sub-steps. The student needs the missing intermediate calculation path.

Return ONLY a valid JSON array (no markdown, no code blocks):
[
  {
    "id": "sub_1",
    "type": "branch",
    "label": "Sub-step name (3-5 words)",
    "description": "Simple one-line explanation of what this sub-step does",
    "mathContent": "the actual math expression or transformation for this sub-step"
  },
  {
    "id": "sub_2",
    "type": "branch",
    "label": "Sub-step name",
    "description": "Simple one-line explanation",
    "mathContent": "actual math expression"
  },
  {
    "id": "sub_3",
    "type": "branch",
    "label": "Sub-step name",
    "description": "Simple one-line explanation",
    "mathContent": "actual math expression"
  }
]

Rules:
- Return 3-6 sub-steps. Use 4-6 when the parent step hides multiple algebra/calculation moves
- Each sub-step must be one concrete algebra/calculation/transformation used inside the parent step
- Sub-step mathContent must form a chain: each line should naturally follow from the previous sub-step
- Start from the previous visible expression when provided; otherwise start from the smallest expression required by the parent step
- The final sub-step MUST reach, equal, or directly justify the parent step math/result: "${nodeMathContent}"
- Do NOT make every sub-step repeat "${nodeMathContent}". Only the final sub-step may match the parent result
- At least half of the sub-steps must show intermediate math that is different from the parent step math/result
- Do NOT introduce a new method, new formula, or unrelated concept unless it is explicitly required by this parent step
- Do NOT jump to the next main step or repeat the whole problem
- mathContent must contain the exact expression/equation/transformation for that small move, not prose
- Use standard LaTeX wrapped in $...$ or $$...$$ when math is present
- Labels must be short action phrases (3-5 words), such as "Substitute known values" or "Cancel common factor"
- Descriptions must explain why that one small calculation move is valid`;

  const { data } = await generateStructuredJson<Omit<BreakdownNode, "parentId">[]>({
    prompt,
    options,
    temperature: 0.2,
    maxOutputTokens: 4096,
    taskName: "expandNode",
    maxAttempts: 2,
  });

  return Array.isArray(data) ? data : [];
}

// ─── Regenerate a branch node ────────────────────────────────────────────────

export interface RegeneratedBranchNode {
  label: string;
  description: string;
  mathContent: string;
}

export async function regenerateBranchNode(
  nodeLabel: string,
  nodeDescription: string,
  nodeMathContent: string,
  nodeType: string,
  parentProblem: string,
  options: AIRequestOptions = {}
): Promise<RegeneratedBranchNode> {
  const fallback: RegeneratedBranchNode = {
    label: (nodeLabel ?? "").trim() || "Refined step",
    description: (nodeDescription ?? "").trim() || "Refined explanation of this solving step.",
    mathContent: (nodeMathContent ?? nodeLabel ?? "").trim(),
  };

  const prompt = `A student is solving this problem: "${parentProblem}"

Current step appears low quality and must be regenerated:
- nodeType: "${nodeType}"
- label: "${nodeLabel}"
- description: "${nodeDescription}"
- mathContent: "${nodeMathContent}"

Regenerate this SINGLE node so it is mathematically coherent, concise, and easier to understand.

Return ONLY valid JSON object:
{
  "label": "short step title (3-6 words)",
  "description": "one clear sentence explaining what this step does",
  "mathContent": "actual equation/transformation for this step"
}

Rules:
- Keep it as ONE node, not multiple steps
- Keep description concise and concrete
- mathContent must contain real math notation, not empty
- No markdown, no extra keys, no prose outside JSON`;

  const { data } = await generateStructuredJson<RegeneratedBranchNode>({
    prompt,
    options,
    temperature: 0.3,
    maxOutputTokens: 1024,
    taskName: "regenerateBranchNode",
    maxAttempts: 2,
  });

  const label = `${data?.label ?? ""}`.trim() || fallback.label;
  const description = `${data?.description ?? ""}`.trim() || fallback.description;
  const mathContent = `${data?.mathContent ?? ""}`.trim() || fallback.mathContent || fallback.label;

  return { label, description, mathContent };
}

// ─── Analyze image ────────────────────────────────────────────────────────────

export async function analyzeImage(
  imagePart: ImagePart,
  userQuestion: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const client = getGeminiClient();

  const parts: Part[] = [
    {
      inlineData: {
        data: imagePart.data,
        mimeType: imagePart.mimeType,
      },
    },
    { text: userQuestion || "Please analyze this image and explain what you see from an educational perspective." },
  ];

  try {
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        systemInstruction: buildSystemInstruction(options),
        temperature: 0.5,
      },
      contents: [{ role: "user", parts }],
    });

    return response.text ?? "";
  } catch (err) {
    logger.error("Gemini image analysis error:", err);
    throw err;
  }
}

interface MaskedMathResult {
  masked: string;
  placeholders: string[];
}

export interface OcrMathSegment {
  id: string;
  placeholder: string;
  token: string;
  latexRaw: string;
  latexNormalized: string;
  display: boolean;
  valid: boolean;
  issues: string[];
}

export interface ProblemOcrStructuredResult {
  text: string;
  plainText: string;
  mathSegments: OcrMathSegment[];
  warnings: string[];
}

function normalizeImageExtractionText(raw: string): string {
  return stripCodeFence(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+\s*/u, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isMostlyKhmer(text: string): boolean {
  const khmerCount = (text.match(/[\u1780-\u17FF]/g) ?? []).length;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  return khmerCount >= 24 && khmerCount >= latinCount * 2;
}

function fixKhmerSpacingArtifacts(text: string): string {
  let out = text.normalize("NFC");
  // Remove zero-width artifacts commonly produced by OCR.
  out = out.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  // Some OCR outputs underscores between Khmer glyphs.
  out = out.replace(/([\u1780-\u17FF])_+(?=[\u1780-\u17FF])/g, "$1");
  // Remove spaces before Khmer combining marks that should attach to previous glyph.
  out = out.replace(/\s+([\u17B6-\u17D3\u17DD])/g, "$1");
  // Normalize spacing around sentence punctuation without collapsing Khmer words.
  out = out.replace(/\s+([៖:។៕!?])/g, "$1");
  out = out.replace(/([៖:។៕!?])(?=[^\s\n])/g, "$1 ");
  out = out.replace(/[ \t]{2,}/g, " ");
  return out;
}

function countMathSegments(text: string): number {
  return (text.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g) ?? []).length;
}

const BARE_MATH_COMMANDS = 'begin|end|cases|matrix|aligned|align|frac|sqrt|text|mathrm|Delta|times|div|cdot|pm|neq|leq|geq|approx|Rightarrow|rightarrow|leftarrow|leftrightarrow|int|sum|lim|log|ln|sin|cos|tan';
const BARE_MATH_COMMAND_REGEX = new RegExp(`(?<!\\\\)\\b(${BARE_MATH_COMMANDS})\\b`, 'g');
const MATH_EXPRESSION_REGEX = /((?:\\[A-Za-z]+|Δ|∂|(?:\d+(?:\.\d+)?)?[A-Za-z])[\dA-Za-z\\Δ∂^_+\-*/=().,|[\]:;{} \t]*=[\dA-Za-z\\Δ∂^_+\-*/=().,|[\]:;{} \t]*)/g;

/**
 * Robustly detects and repairs "bare" math notation (math without backslashes or delimiters)
 * into standard LaTeX that the frontend can reliably render.
 */
function repairBareMath(input: string): string {
  const text = String(input || '').trim();
  if (!text) return text;

  return text
    .replace(/\\\$/g, '$') // Unescape dollar signs so they can be identified as segments
    .replace(BARE_MATH_COMMAND_REGEX, '\\$1')
    .replace(/±/g, '\\pm')
    .replace(/√\(([^)\n]+)\)/g, '\\sqrt{$1}')
    .replace(/√\{([^}\n]+)\}/g, '\\sqrt{$1}')
    .replace(/(\d+(?:\.\d+)?)°/g, '$1^\\circ');
}

/**
 * Finds mathematical expressions that are missing LaTeX delimiters and wraps them in $...$.
 */
function wrapBareMathInDelimiters(input: string): string {
  const text = String(input || '').trim();
  if (!text) return text;

  // Split by existing delimiters to avoid double-wrapping
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/);
  const processed = parts.map((part, idx) => {
    // If it's a delimited segment, leave it alone
    if (idx % 2 === 1) return part;

    // Otherwise, find math-like segments (e.g. expressions with '=') and wrap them
    return part.replace(MATH_EXPRESSION_REGEX, (match) => {
      const trimmed = match.trim();
      // Ensure it doesn't look like a prose sentence and has some math "heavier" than just 'a=b'
      const words = trimmed.match(/\b[A-Za-z]{4,}\b/g) || [];
      if (words.length > 2) return match; // Likely prose

      return ` $${trimmed}$ `;
    });
  });

  return processed.join('').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Entry point for "deep" normalization of math/prose mixed strings.
 */
function deepNormalizeMathProse(input: string): string {
  let text = repairBareMath(input);
  text = wrapBareMathInDelimiters(text);
  return normalizeMathSegments(text);
}

/**
 * Normalizes a description/label field that mixes prose with $...$-delimited math.
 *
 * The fundamental difference from deepNormalizeMathProse:
 *  - deepNormalizeMathProse calls repairBareMath() which injects \backslash into
 *    plain English words that happen to be LaTeX command names (e.g. "matrix" → "\matrix").
 *    That is correct for pure-math strings but corrupts prose descriptions.
 *  - This function NEVER adds backslashes to prose words. It only:
 *      1. Normalizes math that is already inside $...$ delimiters.
 *      2. Strips any stray \word that may have leaked in through other paths.
 *      3. Applies basic unicode/whitespace cleanup to prose segments.
 *
 * e.g. "The $2 \times 2$ matrix is..." stays "The $2 \times 2$ matrix is..."
 *      (not "The $2 \times 2$ \matrix is...")
 */
function normalizeDescriptionText(input: string): string {
  const text = String(input || "").trim();
  if (!text) return text;

  const DELIM_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/;
  const parts = text.split(DELIM_RE);

  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) {
        // Math segment — apply standard math normalization (safe; only touches content inside delimiters)
        return normalizeMathSegments(part);
      }
      // Prose segment — minimal, non-destructive cleanup only
      return part
        .replace(/\\([a-zA-Z]+)/g, "$1")   // strip any stray \word (e.g. \matrix → matrix)
        .replace(/[−–]/g, "-")              // normalize unicode minus/dash
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, "") // strip zero-width artifacts
        .replace(/\s{2,}/g, " ");           // collapse extra whitespace
    })
    .join("")
    .trim();
}

function isOuterBraceWrapped(str: string, open: string, close: string): boolean {
  if (!str.startsWith(open) || !str.endsWith(close)) return false;
  let depth = 0;
  for (let i = 0; i < str.length - 1; i++) {
    if (str[i] === open) depth++;
    if (str[i] === close) depth--;
    if (depth === 0) return false;
  }
  return depth === 1 && str[str.length - 1] === close;
}

function normalizeMathExpression(expr: string): string {
  let out = (expr ?? "").trim();
  if (!out) return out;

  out = out
    // Collapse over-escaped backslashes only if followed by a letter (command),
    // but PRESERVE double backslashes (\\) which mean newline in LaTeX.
    // We do this by collapsing 4 backslashes to 2, or 2 to 1 if not part of a pair.
    .replace(/\\\\\\\\/g, "\\\\")
    .replace(/\\\\([a-zA-Z]+)/g, "\\$1")
    // OCR/model sometimes escapes dollar delimiters inside already-delimited math.
    .replace(/\\\$/g, "$")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁴/g, "^4")
    .replace(/⁵/g, "^5")
    .replace(/\^(\s+)(\d+)/g, "^$2")
    // Clean up common AI artifacts: stray leading/trailing punctuation/parens
    .replace(/^[:.,\s]+/, "")
    .replace(/^[)]\s*/, "") // Remove stray leading closing paren
    .replace(/\s*[(]$/, "") // Remove stray trailing opening paren
    .trim();

  if (isOuterBraceWrapped(out, "(", ")") || isOuterBraceWrapped(out, "[", "]")) {
    out = out.slice(1, -1).trim();
  }

  return out;
}

function normalizeMathSegments(text: string): string {
  return (text ?? "").replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_match, displayExpr?: string, inlineExpr?: string) => {
    if (displayExpr !== undefined) return `$$${normalizeMathExpression(displayExpr)}$$`;
    if (inlineExpr !== undefined) return `$${normalizeMathExpression(inlineExpr)}$`;
    return _match;
  });
}

function finalizeExtractedProblemText(text: string): string {
  const cleaned = fixKhmerSpacingArtifacts(normalizeImageExtractionText(text))
    // Canonicalize escaped delimiters before math-segment normalization.
    .replace(/\\\$/g, "$")
    .replace(/\\{2,}(?=[A-Za-z])/g, "\\");
  return normalizeMathSegments(cleaned);
}

function hasBalancedBraces(input: string): boolean {
  let depth = 0;
  for (const ch of input) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function containsUnsupportedMathUnicode(input: string): boolean {
  return /[\u0600-\u06FF\u0900-\u097F\u1780-\u17FF\u4E00-\u9FFF\uAC00-\uD7AF\u3040-\u30FF]/.test(input);
}

function emptyProblemOcrResult(warning?: string): ProblemOcrStructuredResult {
  return {
    text: "",
    plainText: "",
    mathSegments: [],
    warnings: warning ? [warning] : [],
  };
}

function buildStructuredProblemOcr(text: string): ProblemOcrStructuredResult {
  const normalizedText = finalizeExtractedProblemText(text ?? "");
  if (!normalizedText) return emptyProblemOcrResult("empty_ocr_text");

  const mathSegments: OcrMathSegment[] = [];
  const warnings: string[] = [];

  const plainText = normalizedText.replace(
    /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g,
    (_match, displayExpr?: string, inlineExpr?: string, bracketExpr?: string, parenExpr?: string) => {
      const display = displayExpr !== undefined || bracketExpr !== undefined;
      const rawExpr = (displayExpr ?? inlineExpr ?? bracketExpr ?? parenExpr ?? "").trim();
      const latexNormalized = normalizeMathExpression(rawExpr);
      const id = `EQ_${mathSegments.length + 1}`;
      const placeholder = `[[${id}]]`;
      const token = display ? `$$${latexNormalized}$$` : `$${latexNormalized}$`;
      const issues: string[] = [];

      if (!latexNormalized) issues.push("empty_math_expression");
      if (!hasBalancedBraces(latexNormalized)) issues.push("unbalanced_braces");
      if (containsUnsupportedMathUnicode(latexNormalized)) issues.push("non_math_unicode_inside_math");

      mathSegments.push({
        id,
        placeholder,
        token,
        latexRaw: rawExpr,
        latexNormalized,
        display,
        valid: issues.length === 0,
        issues,
      });

      return placeholder;
    }
  );

  const placeholderCount = (plainText.match(/\[\[EQ_\d+\]\]/g) ?? []).length;
  if (placeholderCount !== mathSegments.length) {
    warnings.push("placeholder_count_mismatch");
  }
  if (mathSegments.some((segment) => !segment.valid)) {
    warnings.push("invalid_math_segment_detected");
  }

  return {
    text: normalizedText,
    plainText,
    mathSegments,
    warnings,
  };
}

function maskMathSegments(text: string): MaskedMathResult {
  const placeholders: string[] = [];
  const masked = text.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, (match) => {
    placeholders.push(match);
    return `[[EQ_${placeholders.length}]]`;
  });
  return { masked, placeholders };
}

function restoreMathSegments(text: string, placeholders: string[]): string {
  let out = text;
  placeholders.forEach((value, idx) => {
    const token = `[[EQ_${idx + 1}]]`;
    out = out.split(token).join(value);
  });
  return out;
}

export async function extractProblemFromImage(
  imagePart: ImagePart,
  options: AIRequestOptions = {}
): Promise<ProblemOcrStructuredResult> {
  const client = getGeminiClient();
  const targetLangCode = (options.language ?? "en").toLowerCase();
  const targetLangName = LANGUAGE_NAMES[targetLangCode] ?? targetLangCode ?? "English";
  logger.info("[image-ocr] start", {
    targetLanguageCode: targetLangCode,
    targetLanguageName: targetLangName,
    imageMimeType: imagePart.mimeType,
    imageBytesApprox: imagePart.data.length,
  });

  const transcriptionResponse = await client.models.generateContent({
    model: env.GEMINI_MODEL,
    config: {
      systemInstruction: `You are a strict OCR transcriber for educational problem statements.
Rules:
- Extract text from the image faithfully. Do not solve the problem.
- Keep original numbers, symbols, and units exactly.
- Preserve equations using KaTeX-friendly LaTeX in $...$ or $$...$$.
- Do not add emoji, icons, bullets, or decorative characters.
- Output plain text only. No markdown. No extra commentary.`,
      temperature: 0.1,
      maxOutputTokens: 4096,
    },
    contents: [{
      role: "user",
      parts: [
        {
          inlineData: {
            data: imagePart.data,
            mimeType: imagePart.mimeType,
          },
        },
        {
          text: "Transcribe this problem exactly as written. Keep equations and math symbols intact.",
        },
      ],
    }],
  });
  const transcribedRaw = transcriptionResponse.text ?? "";
  logger.info("[image-ocr] transcription:raw", {
    length: transcribedRaw.length,
    finishReason: extractFinishReason(transcriptionResponse),
    preview: debugPreview(transcribedRaw, 260),
  });

  const transcribedBase = normalizeImageExtractionText(transcribedRaw);
  const transcribed = fixKhmerSpacingArtifacts(transcribedBase);
  const transcribedFinal = finalizeExtractedProblemText(transcribed);
  logger.info("[image-ocr] transcription:normalized", {
    length: transcribedFinal.length,
    mathSegments: countMathSegments(transcribedFinal),
    mostlyKhmer: isMostlyKhmer(transcribedFinal),
    preview: debugPreview(transcribedFinal, 260),
  });
  if (!transcribedBase) {
    logger.warn("[image-ocr] transcription empty after normalization");
    return emptyProblemOcrResult("transcription_empty_after_normalization");
  }

  // If already Khmer, run a minimal OCR cleanup pass (no paraphrase) while protecting math.
  if (targetLangCode === "km" && isMostlyKhmer(transcribedFinal)) {
    const { masked: kmMasked, placeholders: kmPlaceholders } = maskMathSegments(transcribedFinal);
    if (!kmMasked.trim()) return buildStructuredProblemOcr(transcribedFinal);
    try {
      const cleanupResponse = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        config: {
          systemInstruction: `You are a Khmer OCR cleanup assistant for educational text.
Rules:
- Fix OCR spacing/diacritic/spelling noise only.
- Keep wording and meaning as close as possible; do not paraphrase.
- Never alter placeholders like [[EQ_1]], [[EQ_2]], etc.
- Keep numbering and punctuation structure.
- Output plain text only.`,
          temperature: 0.05,
          maxOutputTokens: 4096,
        },
        contents: [{
          role: "user",
          parts: [{
            text: `Clean this OCR text with minimal edits. Keep placeholder tokens unchanged:\n\n${kmMasked}`,
          }],
        }],
      });

      const cleanedKmMasked = normalizeImageExtractionText(cleanupResponse.text ?? "");
      logger.info("[image-ocr] khmer-cleanup:raw", {
        length: (cleanupResponse.text ?? "").length,
        finishReason: extractFinishReason(cleanupResponse),
        preview: debugPreview(cleanupResponse.text ?? "", 260),
      });
      if (!cleanedKmMasked) {
        logger.warn("[image-ocr] khmer-cleanup empty; fallback to raw transcription");
        return buildStructuredProblemOcr(transcribedFinal);
      }

      const hasAllPlaceholders = kmPlaceholders.every((_value, idx) =>
        cleanedKmMasked.includes(`[[EQ_${idx + 1}]]`)
      );
      if (!hasAllPlaceholders) {
        logger.warn("[image-ocr] khmer-cleanup placeholder mismatch; fallback to raw transcription");
        return buildStructuredProblemOcr(transcribedFinal);
      }

      const cleanedKm = finalizeExtractedProblemText(restoreMathSegments(cleanedKmMasked, kmPlaceholders));
      const structured = buildStructuredProblemOcr(cleanedKm);
      logger.info("[image-ocr] khmer-cleanup:done", {
        outputLength: structured.text.length,
        outputMathSegments: structured.mathSegments.length,
        outputPreview: debugPreview(structured.text, 260),
        outputWarnings: structured.warnings,
      });
      return structured;
    } catch (err) {
      logger.warn("[image-ocr] khmer-cleanup failed; fallback to raw transcription", err);
      return buildStructuredProblemOcr(transcribedFinal);
    }
  }

  const { masked, placeholders } = maskMathSegments(transcribedFinal);
  logger.info("[image-ocr] mask", {
    placeholders: placeholders.length,
    maskedLength: masked.length,
    maskedPreview: debugPreview(masked, 260),
  });
  if (!masked.trim()) {
    logger.warn("[image-ocr] masked text empty; falling back to transcription");
    return buildStructuredProblemOcr(transcribedFinal);
  }

  try {
    const translationResponse = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        systemInstruction: `You are a precise translator for educational content.
Rules:
- Translate only non-math text into ${targetLangName}.
- Never alter placeholders like [[EQ_1]], [[EQ_2]], etc.
- Keep order, numbering, and sentence structure as close as possible.
- Do not paraphrase, summarize, or add emoji/symbol decorations.
- Output plain text only.`,
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
      contents: [{
        role: "user",
        parts: [{
          text: `Translate this text into ${targetLangName}. Keep placeholder tokens unchanged:\n\n${masked}`,
        }],
      }],
    });
    const translatedRaw = translationResponse.text ?? "";
    logger.info("[image-ocr] translation:raw", {
      length: translatedRaw.length,
      finishReason: extractFinishReason(translationResponse),
      preview: debugPreview(translatedRaw, 260),
    });

    const translatedMasked = fixKhmerSpacingArtifacts(normalizeImageExtractionText(translatedRaw));
    if (!translatedMasked) {
      logger.warn("[image-ocr] translation empty after normalization; falling back to transcription");
      return buildStructuredProblemOcr(transcribedFinal);
    }

    const hasAllPlaceholders = placeholders.every((_value, idx) =>
      translatedMasked.includes(`[[EQ_${idx + 1}]]`)
    );
    logger.info("[image-ocr] translation:checked", {
      hasAllPlaceholders,
      placeholders: placeholders.length,
      translatedLength: translatedMasked.length,
      translatedPreview: debugPreview(translatedMasked, 260),
    });
    if (!hasAllPlaceholders) {
      logger.warn("[image-ocr] placeholder mismatch; falling back to transcription");
      return buildStructuredProblemOcr(transcribedFinal);
    }

    const restored = finalizeExtractedProblemText(restoreMathSegments(translatedMasked, placeholders));
    const structured = buildStructuredProblemOcr(restored);
    logger.info("[image-ocr] done", {
      outputLength: structured.text.length,
      outputMathSegments: structured.mathSegments.length,
      outputPreview: debugPreview(structured.text, 260),
      outputWarnings: structured.warnings,
    });
    return structured;
  } catch (err) {
    logger.warn("Gemini image translation fallback to transcription:", err);
    return buildStructuredProblemOcr(transcribedFinal);
  }
}

// ─── Node insight (per-selected-node breakdown) ───────────────────────────────

export interface SignTableRow {
  label: string;       // "-∞", "1/2", "+∞", etc.
  type: 'value' | 'interval';
  cells: string[];     // "+", "-", "0", "" — one per analysis column
  conclusion: string;  // "0 < x₁ < x₂"
}

export interface GenericTableRow {
  cells: string[];
}

export type VisualTable =
  | {
    type: 'sign_analysis';
    parameterName: string;   // "m"
    columns: string[];       // ["Δ'", "P", "S"]
    conclusionLabel: string;
    rows: SignTableRow[];
  }
  | {
    type: 'generic';
    headers: string[];
    rows: GenericTableRow[];
  };

export interface NodeInsight {
  simpleBreakdown: string;
  keyFormula: string;
}

export async function getNodeInsight(
  nodeLabel: string,
  nodeDescription: string,
  nodeMathContent: string,
  subject: string,
  options: AIRequestOptions = {},
  level: string = 'standard'
): Promise<NodeInsight> {
  const isKidLevel = level === '5-year-old';
  logger.info("[getNodeInsight] start", {
    level,
    subject,
    language: options.language ?? "en",
    nodeLabelLength: nodeLabel.length,
    nodeDescriptionLength: nodeDescription.length,
    nodeMathLength: (nodeMathContent || nodeLabel).length,
  });

  // Kid-mode is plain-text only for robustness (structured JSON frequently truncates).
  if (isKidLevel) {
    const kidText = await generateFallbackNodeInsightText(
      nodeLabel,
      nodeDescription,
      nodeMathContent,
      subject,
      options,
      true,
      6
    );
    const normalizedKid = normalizeSimpleBreakdown(kidText);
    const acceptedKid = isInsightTextSufficient(normalizedKid, true) ? normalizedKid : "";
    const deterministicKid = buildDeterministicKidExplanation(
      nodeLabel,
      nodeDescription,
      nodeMathContent,
      options.language
    );
    if (!acceptedKid) {
      logger.warn("[getNodeInsight] kid result rejected (too short)", {
        rawLength: kidText.length,
        normalizedLength: normalizedKid.length,
        deterministicLength: deterministicKid.length,
        preview: debugPreview(normalizedKid || kidText),
      });
    }
    const finalKidText = acceptedKid || deterministicKid;
    logger.info("[getNodeInsight] kid result", {
      source: acceptedKid ? "fallback-text" : "deterministic-fallback",
      rawLength: kidText.length,
      normalizedLength: normalizedKid.length,
      acceptedLength: acceptedKid.length,
      finalLength: finalKidText.length,
      preview: debugPreview(finalKidText || normalizedKid || kidText),
    });
    return {
      simpleBreakdown: finalKidText,
      keyFormula: "",
    };
  }

  const simpleBreakdownInstruction = isKidLevel
    ? `Write 2-3 short, fun sentences explaining this step as if talking to a 5-year-old child. Use a simple everyday analogy (toys, food, animals). NO math jargon. NO markdown. NO bullet points. Plain sentences only.`
    : `Write 2-3 clear sentences explaining what this step does and why it matters. Plain text only. NO markdown, NO bullet points, NO bold or italic formatting.`;

  const prompt = `Explain a single problem-solving step in a JSON response.

Step: "${nodeLabel}"
Description: "${nodeDescription}"
Math expression: "${nodeMathContent || nodeLabel}"
Subject: "${subject}"

Rules:
- simpleBreakdown must be plain text only — no markdown, no bullet points, no asterisks, no bold, no headers.
- simpleBreakdown must be ${isKidLevel ? "2-3 short sentences (max ~320 characters)." : "at most 2 short sentences (max ~220 characters)."}
- keyFormula must be a SHORT valid LaTeX expression only (no text, no explanation). Empty string if none.
- CRITICAL JSON ESCAPING: if keyFormula includes backslashes, they must be JSON-escaped (e.g. \\\\frac{a}{b}, not \\frac{a}{b}).

Return ONLY this JSON:
{
  "simpleBreakdown": "${simpleBreakdownInstruction}",
  "keyFormula": "LaTeX expression only, or empty string"
}`;

  const { data, source } = await generateStructuredJson<NodeInsight>({
    prompt,
    options,
    temperature: isKidLevel ? 0.5 : 0.2,
    maxOutputTokens: isKidLevel ? 1024 : 1024,
    taskName: "getNodeInsight",
    maxAttempts: 3,
    recoverFromRaw: (raw) => recoverNodeInsightFromPartialJson(raw),
  });

  if (data) {
    const cleaned = normalizeSimpleBreakdown(data.simpleBreakdown ?? "");
    if (isInsightTextSufficient(cleaned, false)) {
      logger.info("[getNodeInsight] standard result", {
        source,
        simpleBreakdownLength: cleaned.length,
        keyFormulaLength: (data.keyFormula ?? "").length,
        preview: debugPreview(cleaned),
      });
      return {
        simpleBreakdown: cleaned,
        keyFormula: normalizeKeyFormula(data.keyFormula ?? ""),
      };
    }
    logger.warn("[getNodeInsight] discarded short cleaned simpleBreakdown", {
      source,
      rawLength: (data.simpleBreakdown ?? "").length,
      cleanedLength: cleaned.length,
      preview: debugPreview(data.simpleBreakdown ?? ""),
    });
  }
  const rescuedText = await generateFallbackNodeInsightText(
    nodeLabel,
    nodeDescription,
    nodeMathContent,
    subject,
    options,
    false
  );
  const normalizedRescued = normalizeSimpleBreakdown(rescuedText);
  const acceptedRescued = isInsightTextSufficient(normalizedRescued, false) ? normalizedRescued : "";
  const deterministicStandard = buildDeterministicStandardExplanation(
    nodeLabel,
    nodeDescription,
    nodeMathContent,
    options.language
  );
  logger.info("[getNodeInsight] fallback result", {
    source: "fallback-text",
    rawLength: rescuedText.length,
    normalizedLength: normalizedRescued.length,
    acceptedLength: acceptedRescued.length,
    preview: debugPreview(acceptedRescued || normalizedRescued || rescuedText),
  });
  return {
    simpleBreakdown: acceptedRescued || deterministicStandard,
    keyFormula: "",
  };
}

// ─── Sign-table detection & generation ────────────────────────────────────────

export function requiresVisualTable(problem: string): boolean {
  if (!problem) return false;

  const hasExplicitTable = /sign[\s-]*(table|chart|analysis)|tableau.*sign|variation.*table|sign variation|ตาราง|bảng.*dấu|bảng.*biến|lập bảng|\\begin\{tabular\}|\\begin\{array\}|table\b/i.test(problem);
  // Sign table column header pattern: M ... Δ/Delta ... P ... S (common in OCR output)
  const hasColumnHeaders = /\bM\b.{0,30}(?:\u0394|\\Delta|\$\\Delta\$).{0,30}\bP\b.{0,30}\bS\b/i.test(problem);
  const hasDiscriminant = /[\u0394\u0394]['′\u2019]?|\bDelta['′\u2019]?|\bdelta['′\u2019]?|\\[Dd]elta|discriminant/i.test(problem);
  const hasVietaOrPS = /\bP\s*[=:]|\bS\s*[=:]|\bVieta\b|\bproduct.{0,10}root|sum.{0,10}root/i.test(problem);
  const hasParametricQuadratic = /[a-z]\s*x\s*[\^²2]|x\s*[\^²]\s*2?\s*[+\-*]/i.test(problem);
  const hasRootCondition = /x\s*[₁1]\s*[<>=≤≥]|x\s*[₂2]\s*[<>=≤≥]|both.{0,15}(positive|negative)|opposite.{0,10}sign|no.{0,10}real.{0,10}root/i.test(problem);

  const result =
    hasExplicitTable ||
    hasColumnHeaders ||
    (hasDiscriminant && hasVietaOrPS) ||
    (hasDiscriminant && hasParametricQuadratic && hasRootCondition);

  logger.debug("[requiresVisualTable]", {
    result,
    hasExplicitTable,
    hasColumnHeaders,
    hasDiscriminant,
    hasVietaOrPS,
    hasParametricQuadratic,
    hasRootCondition,
    problemPreview: problem.slice(0, 120),
  });

  return result;
}

export async function generateVisualTable(
  problem: string,
  subject: string,
  options: AIRequestOptions,
  imagePart?: ImagePart | null
): Promise<VisualTable | null> {
  const imageNote = imagePart
    ? `An image of the problem is also attached — read the table directly from it if visible.\n`
    : "";

  const prompt = `You are extracting or constructing a structured data table for a math problem or educational context.

${imageNote}Problem: "${problem}"
Subject: "${subject}"

Determine if the problem requires a Sign Analysis Table (tableau de signes) or a Generic Data Table.

If it's a Sign Analysis Table, return a JSON object with this EXACT structure:
{
  "type": "sign_analysis",
  "parameterName": "m",
  "columns": ["Δ'", "P", "S"],
  "conclusionLabel": "Conclusion (x₁, x₂)",
  "rows": [
    { "label": "+∞", "type": "value", "cells": ["", "", ""], "conclusion": "" },
    { "label": "", "type": "interval", "cells": ["+", "+", "+"], "conclusion": "0 < x₁ < x₂" },
    ...
  ]
}

Rules for Sign Analysis:
- "value" rows are critical points; "interval" rows are ranges between them.
- "cells": "+", "-", "0", or "" (empty for ±∞ boundaries).
- Rows MUST go from +∞ down to -∞.

If it's a Generic Data Table (for any other structured data, comparison, or list extracted from the problem/image), return:
{
  "type": "generic",
  "headers": ["Header 1", "Header 2", ...],
  "rows": [
    { "cells": ["Value 1", "Value 2", ...] },
    ...
  ]
}

Return ONLY the JSON object. No markdown, no explanation.`;

  // Row shape shared by both table types
  const rowSchema = {
    type: Type.OBJECT,
    properties: {
      label: { type: Type.STRING },
      type: { type: Type.STRING, enum: ["value", "interval"] },
      cells: { type: Type.ARRAY, items: { type: Type.STRING } },
      conclusion: { type: Type.STRING },
    },
    required: ["label", "type", "cells"],
  };

  const visualTableSchema = {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        enum: ["sign_analysis", "generic"],
        description: "Table type",
      },
      // sign_analysis fields
      parameterName: { type: Type.STRING },
      columns: { type: Type.ARRAY, items: { type: Type.STRING } },
      conclusionLabel: { type: Type.STRING },
      rows: { type: Type.ARRAY, items: rowSchema },
      // generic fields
      headers: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["type", "rows"],
  };

  const { data } = await generateStructuredJson<VisualTable>({
    prompt,
    options,
    temperature: 0.1,
    maxOutputTokens: 4096,
    taskName: "generateVisualTable",
    maxAttempts: 3,
    imagePart: imagePart ?? undefined,
    responseSchema: visualTableSchema,
  });

  if (!data || !['sign_analysis', 'generic'].includes(data.type) || !Array.isArray(data.rows) || data.rows.length === 0) {
    logger.warn("[generateVisualTable] invalid or empty result", {
      hasData: !!data,
      type: (data as VisualTable | null)?.type ?? null,
      rowCount: Array.isArray((data as VisualTable | null)?.rows) ? (data as VisualTable).rows.length : null,
    });
    return null;
  }

  logger.info("[generateVisualTable] success", {
    type: data.type,
    rowCount: data.rows.length,
    rows: data.rows,
  });

  return data;
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^'''(?:json)?\s*/i, "")
    .replace(/\s*'''$/i, "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
        stack.pop();
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Extract every top-level JSON object/array from a text by scanning forward
 * from each { or [ position. Returns candidates in document order.
 */
function extractAllJsonCandidates(text: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < text.length) {
    const rel = text.slice(i).search(/[{[]/);
    if (rel < 0) break;
    const abs = i + rel;
    const candidate = extractFirstJsonValue(text.slice(abs));
    if (candidate) {
      results.push(candidate);
      i = abs + candidate.length;
    } else {
      i = abs + 1;
    }
  }
  return results;
}

function unwrapNestedJsonValue(value: unknown, maxDepth = 3): unknown {
  let current: unknown = value;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return current;
    if (!/^[{\["]/.test(trimmed)) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
}

function parseJsonLoose<T>(raw: string): T | null {
  const stripped = stripCodeFence(raw).replace(/\u0000/g, "").trim();
  if (!stripped) return null;

  // Collect all complete JSON objects/arrays found in the text.
  // Reverse so the model's LAST (final/complete) output is tried before earlier partial drafts.
  const allExtracted = extractAllJsonCandidates(stripped).reverse();

  const candidates = [stripped, ...allExtracted]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/,\s*([}\]])/g, "$1").replace(/\u2028|\u2029/g, " "));

  for (const candidate of candidates) {
    try {
      const parsed = unwrapNestedJsonValue(JSON.parse(candidate));
      if (parsed !== null && parsed !== undefined) return parsed as T;
    } catch {
      // Try repairs for common model JSON issues (invalid backslash escapes in LaTeX, control chars).
      const repaired = repairCommonJsonIssues(candidate);
      try {
        const parsed = unwrapNestedJsonValue(JSON.parse(repaired));
        if (parsed !== null && parsed !== undefined) return parsed as T;
      } catch {
        // Try next candidate
      }
    }
  }
  return null;
}

function repairCommonJsonIssues(input: string): string {
  return escapeInvalidBackslashesInsideJsonStrings(
    input.replace(/[\u0000-\u001F]/g, (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
      return " ";
    })
  );
}

function escapeInvalidBackslashesInsideJsonStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    // Literal newlines/CR/tabs inside a JSON string are invalid — escape them.
    // Models frequently embed multi-line content directly inside string values.
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { out += "\\r"; continue; }
    if (ch === "\t") { out += "\\t"; continue; }

    if (ch === "\\") {
      const next = input[i + 1];
      // Exclude \b, \f, and \r from the valid-escape list:
      // the model frequently writes LaTeX commands that start with those letters
      // (\frac, \because, \right, \rho, \rightarrow, \beta …) and they must be
      // doubled to \\ so JSON.parse produces the literal backslash math renderers need.
      // \r is excluded for the same reason \b and \f already were — \right is far
      // more common in model output than an intentional carriage-return escape.
      const validEscape =
        next === "\"" ||
        next === "\\" ||
        next === "/" ||
        next === "n" ||
        next === "t" ||
        next === "u";

      if (validEscape) {
        out += ch;
        escaped = true;
      } else {
        // JSON requires escaping unknown backslashes, common with LaTeX: \circ, \times, \frac...
        out += "\\\\";
      }
      continue;
    }

    out += ch;
    if (ch === "\"") inString = false;
  }

  return out;
}

function recoverNodeInsightFromPartialJson(raw: string): NodeInsight | null {
  const simpleBreakdown = normalizeSimpleBreakdown(extractJsonStringFieldLoose(raw, "simpleBreakdown") ?? "");
  if (!simpleBreakdown) return null;

  const keyFormula = (extractJsonStringFieldLoose(raw, "keyFormula") ?? "").trim();
  return { simpleBreakdown, keyFormula };
}

async function generateFallbackNodeInsightText(
  nodeLabel: string,
  nodeDescription: string,
  nodeMathContent: string,
  subject: string,
  options: AIRequestOptions = {},
  isKidLevel: boolean = false,
  maxAttempts: number = 2
): Promise<string> {
  const client = getGeminiClient();
  let bestCandidate = "";
  let bestScore = -1;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    const prompt = `Explain this single step in plain text only.

Step: "${nodeLabel}"
Description: "${nodeDescription}"
Math expression: "${nodeMathContent || nodeLabel}"
Subject: "${subject}"

Rules:
- ${isKidLevel
        ? "Write a detailed explanation for a 5-year-old in 5-8 short sentences. Use one simple everyday analogy and keep the language very easy."
        : "Keep it concise (about 2 short sentences)."}
- Must be ${isKidLevel ? "at least 4 complete sentences and at least 160 characters." : "at least 1 complete sentence and at least 40 characters."}
- No JSON, no markdown, no bullet points.
- Keep it clear and student-friendly.
- ${isKidLevel ? "Use playful simple words suitable for a 5-year-old." : "Keep a clear tutoring tone."}
${attempt > 1 ? "- Previous output was too short; give a complete explanation now." : ""}`;

    try {
      const response = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        config: {
          systemInstruction: buildSystemInstruction(options),
          temperature: isKidLevel ? 0.4 : 0.2,
          maxOutputTokens: isKidLevel ? 8192 : 220,
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const cleaned = normalizeSimpleBreakdown(response.text ?? "");
      const finishReason = extractFinishReason(response);
      const complete = looksLikeCompleteEnding(cleaned);
      const sufficient = isInsightTextSufficient(cleaned, isKidLevel);
      const score = scoreInsightCandidate(cleaned, isKidLevel, complete, finishReason);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cleaned;
      }
      logger.info("[getNodeInsight] fallback text attempt", {
        attempt,
        maxAttempts,
        rawLength: (response.text ?? "").length,
        cleanedLength: cleaned.length,
        sentenceCount: countSentenceLikeChunks(cleaned),
        score,
        sufficient,
        complete,
        finishReason,
        preview: debugPreview(response.text ?? ""),
      });
      // For kid-mode, if generation hit max tokens and text appears unfinished, retry.
      if (isKidLevel && sufficient && finishReason === "MAX_TOKENS" && !complete) {
        continue;
      }
      if (sufficient) return cleaned;
    } catch {
      logger.warn("[getNodeInsight] fallback text attempt failed", { attempt, maxAttempts });
      // Try next attempt
    }
  }

  return bestCandidate;
}

function normalizeSimpleBreakdown(input: string): string {
  const cleaned = stripCodeFence(input)
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const deduped = dedupeRepeatedInsightChunks(cleaned);
  if (!deduped) return "";
  // Drop tiny/partial fragments (e.g. "ស្រម") produced by truncated JSON recovery.
  if (deduped.length < 24) return "";
  return deduped;
}

function isInsightTextSufficient(text: string, isKidLevel: boolean): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;

  const minLen = isKidLevel ? 100 : 40;
  if (t.length < minLen) return false;

  const sentenceCount = countSentenceLikeChunks(t);
  if (isKidLevel) {
    return sentenceCount >= 3 || t.length >= 180;
  }

  const wordCount = t.split(/\s+/).filter(Boolean).length;
  const minWords = 6;
  if (wordCount < minWords) return false;

  return true;
}

function scoreInsightCandidate(
  text: string,
  isKidLevel: boolean,
  complete: boolean = true,
  finishReason: string = ""
): number {
  const t = (text ?? "").trim();
  if (!t) return -1;
  const sentenceCount = countSentenceLikeChunks(t);
  let score = isKidLevel ? t.length + sentenceCount * 80 : t.length + sentenceCount * 20;
  if (!complete) score -= 120;
  if (isKidLevel && finishReason === "MAX_TOKENS") score -= 80;
  return score;
}

function countSentenceLikeChunks(text: string): number {
  return text
    .split(/[.!?។]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .length;
}

function looksLikeCompleteEnding(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return /[.!?។៕]\s*$/.test(t);
}

function canonicalInsightChunk(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function dedupeRepeatedInsightChunks(text: string): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const chunks = normalized
    .split(/(?<=[.!?។៕])\s+/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) return normalized;

  const deduped: string[] = [];
  for (const chunk of chunks) {
    const currentCanonical = canonicalInsightChunk(chunk);
    const previousCanonical = deduped.length > 0
      ? canonicalInsightChunk(deduped[deduped.length - 1])
      : "";
    if (currentCanonical && currentCanonical === previousCanonical) continue;
    deduped.push(chunk);
  }

  const joined = deduped.join(" ").trim();
  if (joined.length < 40) return joined;

  const half = Math.floor(joined.length / 2);
  if (joined.length % 2 === 0) {
    const left = joined.slice(0, half).trim();
    const right = joined.slice(half).trim();
    if (left.length >= 20 && canonicalInsightChunk(left) === canonicalInsightChunk(right)) {
      return left;
    }
  }

  return joined;
}

function extractFinishReason(response: unknown): string {
  const reason = (
    response as { candidates?: Array<{ finishReason?: string | null }> }
  ).candidates?.[0]?.finishReason;
  return typeof reason === "string" ? reason.toUpperCase() : "";
}

function buildDeterministicKidExplanation(
  nodeLabel: string,
  nodeDescription: string,
  nodeMathContent: string,
  language?: string
): string {
  const isKhmer = (language ?? "").toLowerCase() === "km";
  const label = normalizeSimpleBreakdown(nodeLabel) || (isKhmer ? "ជំហាននេះ" : "This step");
  const description = normalizeSimpleBreakdown(nodeDescription);
  const math = normalizeSimpleBreakdown(nodeMathContent);

  if (isKhmer) {
    const line4 = description
      ? `គំនិតសំខាន់នៅទីនេះគឺ៖ ${description}។`
      : "គន្លឹះគឺយើងធ្វើតាមលំដាប់តូចៗ មិនលោតជំហាន។";
    const line5 = math
      ? `បន្ទាត់គណនានេះ (${math}) គ្រាន់តែជាឧបករណ៍ជួយឲ្យយើងមើលឃើញចម្លើយបានច្បាស់។`
      : "បន្ទាប់ពីយើងយល់ទិន្នន័យហើយ យើងគណនាបន្តតាមជំហាន។";
    return `${label} គឺដូចជាការឡើងជណ្តើរមួយជំហានម្តង។ ដំបូង យើងមើលអ្វីដែលបានផ្តល់ឲ្យ ហើយសួរថាត្រូវរកអ្វី។ បន្ទាប់មក យើងយកព័ត៌មានត្រឹមត្រូវមកភ្ជាប់គ្នា ដូចជាភ្ជាប់ប្លុកលេង។ ${line4} ${line5} ចុងក្រោយ យើងពិនិត្យម្តងទៀតថាចម្លើយសមហេតុផល ហើយនោះជាវិធីសាមញ្ញដែលកុមារអាចយល់បាន។`;
  }

  const line4 = description
    ? `The key idea here is: ${description}.`
    : "The key idea is to do one small action at a time and not skip steps.";
  const line5 = math
    ? `This math line (${math}) is just a tool to help us see the answer clearly.`
    : "After we understand the given facts, we keep calculating step by step.";
  return `${label} is like climbing a ladder one step at a time. First, we look at what we already know and what we are trying to find. Next, we connect those pieces carefully, like building with toy blocks. ${line4} ${line5} At the end, we check the answer one more time to make sure it makes sense.`;
}

function buildDeterministicStandardExplanation(
  nodeLabel: string,
  nodeDescription: string,
  nodeMathContent: string,
  language?: string
): string {
  const isKhmer = (language ?? "").toLowerCase() === "km";
  const label = normalizeSimpleBreakdown(nodeLabel) || (isKhmer ? "ជំហាននេះ" : "This step");
  const description = normalizeSimpleBreakdown(nodeDescription);
  const math = normalizeSimpleBreakdown(nodeMathContent);

  if (isKhmer) {
    const desc = description
      ? `គោលបំណងគឺ ${description.replace(/[។៕.!?]+$/g, "")}។`
      : "គោលបំណងគឺធ្វើការបំលែងតាមលំដាប់ឲ្យច្បាស់។";
    const mathLine = math
      ? `អនុវត្តលើបន្ទាត់គណនា ${math} ហើយពិនិត្យលទ្ធផលឲ្យសមហេតុផល។`
      : "បន្ទាប់មក អនុវត្តការគណនាដោយប្រុងប្រយ័ត្ន ហើយពិនិត្យចម្លើយចុងក្រោយ។";
    return `${label} ជួយយើងបំបែកការដោះស្រាយឲ្យច្បាស់ជាជំហានតូចៗ។ ${desc} ${mathLine}`;
  }

  const desc = description
    ? `The goal here is to ${description.replace(/[.!?]+$/g, "")}.`
    : "The goal here is to apply one clear transformation before moving to the next step.";
  const mathLine = math
    ? `Use the expression ${math} as the working line, then verify the result is consistent.`
    : "Use the current expression carefully, then verify the result is consistent.";
  return `${label} keeps the solution focused on one clear transformation at a time. ${desc} ${mathLine}`;
}

function normalizeKeyFormula(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const unwrapped = value.startsWith("$") && value.endsWith("$") && value.length > 2
    ? value.slice(1, -1).trim()
    : value;
  return isLikelyCompactFormula(unwrapped) ? unwrapped : "";
}

function isLikelyCompactFormula(value: string): boolean {
  if (value.length < 2 || value.length > 140) return false;
  if (/[\u1780-\u17FF\u0600-\u06FF\u4E00-\u9FFF\u0900-\u097F]/.test(value)) return false;
  return /[=+\-*/^_\\(){}\[\]0-9]/.test(value);
}

function normalizeNodeKeyFormula(keyFormulaInput: string, mathContentInput: string): string {
  const keyFormula = normalizeKeyFormula(keyFormulaInput);
  if (keyFormula) return keyFormula;

  const fallback = normalizeKeyFormula(mathContentInput);
  if (!fallback) return "";
  if (fallback.length > 80) return "";
  return fallback;
}

function extractJsonStringFieldLoose(raw: string, key: string): string | null {
  const keyToken = `"${key}"`;
  const keyPos = raw.indexOf(keyToken);
  if (keyPos < 0) return null;

  let i = keyPos + keyToken.length;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== ":") return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== "\"") return null;
  i++;

  let chunk = "";
  let escaped = false;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      chunk += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      chunk += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      break;
    }
    chunk += ch;
  }

  return decodeJsonStringLoose(chunk);
}

function decodeJsonStringLoose(chunk: string): string {
  let normalized = chunk
    .replace(/\\(?!["\\/])/g, "\\\\")
    .replace(/\\$/g, "\\\\");
  try {
    return JSON.parse(`"${normalized}"`) as string;
  } catch {
    // Best-effort fallback
    normalized = normalized
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, "\"");
    return normalized;
  }
}

async function generateStructuredJson<T>(
  config: JsonGenerationConfig<T>
): Promise<{ data: T | null; raw: string; source: StructuredJsonSource }> {
  const client = getGeminiClient();
  const attempts = Math.max(1, config.maxAttempts ?? 2);
  let lastRaw = "";

  // Use Pro model for structured breakdowns to ensure complete results for complex math
  let modelName = config.taskName.toLowerCase().includes("breakdown") || config.taskName.toLowerCase().includes("solve")
    ? env.GEMINI_PRO_MODEL
    : env.GEMINI_MODEL;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const retrySuffix = attempt === 1
      ? ""
      : attempt === 2
        ? `\n\nIMPORTANT: Previous output was invalid or truncated. Return complete valid JSON only. Keep solutionText concise — use aligned equations, minimal prose.`
        : `\n\nCRITICAL: Return the shortest possible valid JSON. Keep solutionText under 600 characters. Focus on accuracy over completeness.`;

    let response;
    try {
      logger.info(`[DEBUG:AI:PROMPT] Task: ${config.taskName}`, {
        model: modelName,
        systemInstruction: buildSystemInstruction(config.options),
        prompt: `${config.prompt}${retrySuffix}`
      });
      response = await client.models.generateContent({
        model: modelName,
        config: {
          systemInstruction: buildSystemInstruction(config.options),
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
          responseMimeType: config.noJsonMime ? "text/plain" : "application/json",
          // Relax safety settings for educational content
          safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          ] as any,
          ...(config.responseSchema ? { responseSchema: config.responseSchema } : {}),
        },
        contents: [{
          role: "user",
          parts: [
            ...(config.imagePart ? [{ inlineData: { data: config.imagePart.data, mimeType: config.imagePart.mimeType } } as Part] : []),
            { text: `${config.prompt}${retrySuffix}` },
          ],
        }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (modelName !== env.GEMINI_MODEL && /(not found|permission|unsupported|invalid model)/i.test(message)) {
        logger.warn(`[${config.taskName}] model ${modelName} unavailable; falling back to ${env.GEMINI_MODEL}`, { message });
        modelName = env.GEMINI_MODEL;
        attempt -= 1;
        continue;
      }
      throw err;
    }

    const raw = response.text ?? "";
    lastRaw = raw;
    logger.info(`[DEBUG:AI:RAW_RESPONSE] Task: ${config.taskName}`, { raw });
    const parsed = parseJsonLoose<T>(raw);
    if (parsed !== null) {
      return { data: parsed, raw, source: "parsed" };
    }
    const recovered = config.recoverFromRaw?.(raw) ?? null;
    if (recovered !== null) {
      return { data: recovered, raw, source: "recovered" };
    }

    if (attempt < attempts) {
      logger.warn(
        `${config.taskName} JSON parse failed (attempt ${attempt}/${attempts}) — retrying. Length:`,
        raw.length,
        "Raw:",
        raw.slice(0, 500)
      );
    } else {
      logger.error(
        `${config.taskName} JSON parse failed (attempt ${attempt}/${attempts}). Length:`,
        raw.length,
        "Raw:",
        raw.slice(0, 500)
      );
    }
  }

  return { data: null, raw: lastRaw, source: "none" };
}

function debugPreview(input: string, max = 140): string {
  const s = (input ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function selectFallbackInsight(rawInsight: string, defaultInsight: string): string {
  const cleaned = stripCodeFence(rawInsight ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return defaultInsight;
  if (/^\[?\s*image(\s*#?\d+)?\s*\]?$/i.test(cleaned)) return defaultInsight;
  if (/^<image[^>]*>$/i.test(cleaned)) return defaultInsight;
  if (cleaned.length > 420) return defaultInsight;
  if (cleaned.includes("\\\\") || /"nodes"|"title"|"insights"/.test(cleaned)) return defaultInsight;
  return cleaned;
}

function buildFallbackBreakdown(problem: string, subject: string, rawInsight: string, language?: string): ProblemBreakdown {
  const isKhmer = (language ?? "").toLowerCase() === "km";
  const copy = isKhmer
    ? {
      title: "ការបំបែកបញ្ហា",
      rootDesc: "នេះជាចំណោទដើមដែលត្រូវដោះស្រាយ។",
      branch1Label: "ជំហាន ១",
      branch1Desc: "កំណត់តម្លៃដែលមាន និងតម្លៃដែលត្រូវរក។",
      branch1Math: "ទិន្នន័យដែលមាន -> អថេរត្រូវរក",
      branch2Label: "ជំហាន ២",
      branch2Desc: "អនុវត្តរូបមន្ត ឬ ទំនាក់ទំនងសំខាន់។",
      branch2Math: "ប្រើទំនាក់ទំនងដើម្បីគណនា",
      leafLabel: "គំនិតគន្លឹះ",
      leafDesc: "ជំនួសតម្លៃ រួចសម្រួលតាមលំដាប់។",
      leafMath: "ជំនួស -> សម្រួល -> លទ្ធផលចុងក្រោយ",
      insight: "បំបែកជាចំណុចតូចៗ កំណត់ទិន្នន័យសំខាន់ ហើយគណនាជំហានៗ។",
    }
    : {
      title: "Problem Breakdown",
      rootDesc: "The original problem statement to solve.",
      branch1Label: "Step 1",
      branch1Desc: "List known values and the target unknown.",
      branch1Math: "Known values -> target unknown",
      branch2Label: "Step 2",
      branch2Desc: "Apply the governing formula or relationship.",
      branch2Math: "Use problem relationship to connect knowns to unknown",
      leafLabel: "Key Concept",
      leafDesc: "Substitute values carefully and simplify in order.",
      leafMath: "Substitute -> simplify -> compute final value",
      insight: "Break the problem into known values, apply the key rule, then compute the final result.",
    };

  return {
    title: problem.slice(0, 50) || copy.title,
    subject,
    nodes: [
      {
        id: "root",
        type: "root",
        label: problem,
        description: copy.rootDesc,
        mathContent: problem,
        keyFormula: normalizeNodeKeyFormula("", problem),
        tags: [subject.toUpperCase(), "PROBLEM"],
      },
      {
        id: "branch1",
        type: "branch",
        label: copy.branch1Label,
        description: copy.branch1Desc,
        mathContent: copy.branch1Math,
        keyFormula: normalizeNodeKeyFormula("", copy.branch1Math),
        parentId: "root",
      },
      {
        id: "branch2",
        type: "branch",
        label: copy.branch2Label,
        description: copy.branch2Desc,
        mathContent: copy.branch2Math,
        keyFormula: normalizeNodeKeyFormula("", copy.branch2Math),
        parentId: "root",
      },
      {
        id: "leaf1",
        type: "leaf",
        label: copy.leafLabel,
        description: copy.leafDesc,
        mathContent: copy.leafMath,
        keyFormula: normalizeNodeKeyFormula("", copy.leafMath),
        parentId: "branch2",
      },
    ],
    insights: {
      simpleBreakdown: selectFallbackInsight(rawInsight, copy.insight),
      keyFormula: "",
    },
  };
}

async function generateText(
  prompt: string,
  options: AIRequestOptions = {}
): Promise<string> {
  const client = getGeminiClient();

  try {
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        systemInstruction: buildSystemInstruction(options),
        temperature: 0.6,
        maxOutputTokens: 2048,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    return response.text ?? "";
  } catch (err) {
    logger.error("Gemini generateText error:", err);
    throw err;
  }
}
