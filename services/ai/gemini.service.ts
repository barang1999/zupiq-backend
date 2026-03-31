import { Content, Part, Type } from "@google/genai";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
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
  parentId?: string;
  tags?: string[];
}

export interface ProblemBreakdown {
  title: string;
  subject: string;
  nodes: BreakdownNode[];
  insights: {
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

export async function breakdownProblem(
  problem: string,
  options: AIRequestOptions = {},
  imagePart?: ImagePart
): Promise<ProblemBreakdown> {
  const imageContext = imagePart
    ? `The problem text below was extracted from an attached image. Use both the image and the extracted text together to fully understand the problem — the image may contain diagrams, figures, or additional visual context.\n\n`
    : "";
  const prompt = `${imageContext}Analyze and break down the following problem into a detailed step-by-step neural concept tree: "${problem}"

Return ONLY valid JSON with no markdown, no code blocks, no explanation outside the JSON. Use this exact structure:
{
  "title": "short descriptive title (4-6 words)",
  "subject": "subject area (e.g. Calculus, Physics, Literature, Algebra)",
  "nodes": [
    {
      "id": "root",
      "type": "root",
      "label": "the exact equation or problem statement as given",
      "description": "one sentence describing the overall problem",
      "mathContent": "the original problem or equation, formatted clearly",
      "tags": ["SUBJECT TAG", "TYPE TAG"]
    },
    {
      "id": "branch1",
      "type": "branch",
      "label": "Step name (3-5 words)",
      "description": "Step 01: one-line description of what this step does",
      "mathContent": "the actual equation or expression after applying this step (e.g. '3x - 2x = 17 - 5')",
      "parentId": "root"
    },
    {
      "id": "branch2",
      "type": "branch",
      "label": "Step name (3-5 words)",
      "description": "Step 02: one-line description",
      "mathContent": "the equation after this step (e.g. 'x = 12')",
      "parentId": "root"
    },
    {
      "id": "leaf1",
      "type": "leaf",
      "label": "Underlying rule or concept name",
      "description": "brief note on why this rule applies",
      "mathContent": "the formula or rule (e.g. 'aⁿ · aᵐ = aⁿ⁺ᵐ')",
      "parentId": "branch1"
    }
  ],
  "insights": {
    "simpleBreakdown": "2-3 sentence plain English explanation of the overall approach",
    "keyFormula": "the single most important formula or rule used"
  }
}

Important rules:
- 1 root node (the original problem)
- 2-4 branch nodes (one per meaningful solving step — include ALL necessary steps)
- 1-3 leaf nodes (underlying concepts/rules that make the steps work)
- mathContent MUST contain actual math notation for every node, not empty strings
- Keep labels concise; put the math in mathContent
- CRITICAL JSON ESCAPING: any backslash in LaTeX must be escaped for JSON (write \\\\circ, \\\\times, \\\\frac, not \\circ, \\times, \\frac)
- NEVER use LaTeX table environments (\\begin{tabular}, \\begin{array}, \\hline, &) in any field — sign/variation tables are rendered separately by the UI`;

  const { data, raw } = await generateStructuredJson<ProblemBreakdown>({
    prompt,
    options,
    temperature: 0.2,
    maxOutputTokens: 8192,
    taskName: "breakdownProblem",
    maxAttempts: 3,
    imagePart,
  });

  if (data) return sanitizeBreakdownNodes(data);
  return buildFallbackBreakdown(problem, options.subject ?? "General", raw, options.language);
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

function sanitizeBreakdownNodes(bd: ProblemBreakdown): ProblemBreakdown {
  return {
    ...bd,
    nodes: bd.nodes.map((node) => ({
      ...node,
      label: stripLatexTabularEnv(node.label ?? ''),
      description: stripLatexTabularEnv(node.description ?? ''),
      mathContent: node.mathContent ? stripLatexTabularEnv(node.mathContent) : node.mathContent,
    })),
  };
}

// ─── Expand a single node into sub-steps ──────────────────────────────────────

export async function expandNode(
  nodeLabel: string,
  nodeMathContent: string,
  parentProblem: string,
  options: AIRequestOptions = {}
): Promise<Omit<BreakdownNode, 'parentId'>[]> {
  const prompt = `A student is solving this problem: "${parentProblem}"

They are stuck on this specific step: "${nodeLabel}" (${nodeMathContent})

Break THIS STEP into 2-3 smaller, simpler sub-steps that are easier to understand. Each sub-step should be more granular than the parent.

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
  }
]

Rules:
- 2-3 sub-steps only
- Each must be simpler and more specific than the parent step
- mathContent must have real math notation, not empty
- Labels must be short (3-5 words)`;

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

function normalizeMathExpression(expr: string): string {
  let out = (expr ?? "").trim();
  if (!out) return out;

  out = out
    // Collapse over-escaped LaTeX commands (e.g. \\\\mathrm -> \mathrm).
    .replace(/\\{2,}(?=[A-Za-z])/g, "\\")
    // OCR/model sometimes escapes dollar delimiters inside already-delimited math.
    .replace(/\\\$/g, "$")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/⁴/g, "^4")
    .replace(/⁵/g, "^5")
    .replace(/\^(\s+)(\d+)/g, "^$2")
    .replace(/([A-Za-z])\s*\/\s*([A-Za-z])/g, "$1/$2")
    .replace(/\b([A-Za-z])\/([A-Za-z])\s*(\d)\b/g, "$1/$2^$3")
    .replace(/\\text\s*\{\s*([^{}]*?)\s*\}/g, (_m, inner: string) => `\\mathrm{${inner.replace(/\s+/g, "")}}`)
    .replace(/\\mathrm\s*\{\s*([^{}]*?)\s*\}/g, (_m, inner: string) => `\\mathrm{${inner.replace(/\s+/g, "")}}`)
    .replace(/\s+/g, " ")
    .trim();

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
    keyFormula: normalizeKeyFormula(nodeMathContent || ""),
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
      label:      { type: Type.STRING },
      type:       { type: Type.STRING, enum: ["value", "interval"] },
      cells:      { type: Type.ARRAY, items: { type: Type.STRING } },
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
      parameterName:   { type: Type.STRING },
      columns:         { type: Type.ARRAY, items: { type: Type.STRING } },
      conclusionLabel: { type: Type.STRING },
      rows:            { type: Type.ARRAY, items: rowSchema },
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
      return JSON.parse(candidate) as T;
    } catch {
      // Try repairs for common model JSON issues (invalid backslash escapes in LaTeX, control chars).
      const repaired = repairCommonJsonIssues(candidate);
      try {
        return JSON.parse(repaired) as T;
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
      // Exclude \b (backspace) and \f (form-feed) from the valid-escape list:
      // the model frequently writes LaTeX commands like \frac, \because that start
      // with those letters, and they must be doubled to \\ so JSON.parse produces
      // the literal backslash that math renderers need.
      const validEscape =
        next === "\"" ||
        next === "\\" ||
        next === "/" ||
        next === "n" ||
        next === "r" ||
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

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const retrySuffix = attempt === 1
      ? ""
      : `\n\nIMPORTANT: Your previous response was invalid or incomplete JSON. Regenerate from scratch and return compact, complete valid JSON only.`;

    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        systemInstruction: buildSystemInstruction(config.options),
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        ...(config.noJsonMime ? {} : { responseMimeType: "application/json" }),
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

    const raw = response.text ?? "";
    lastRaw = raw;
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
        tags: [subject.toUpperCase(), "PROBLEM"],
      },
      {
        id: "branch1",
        type: "branch",
        label: copy.branch1Label,
        description: copy.branch1Desc,
        mathContent: copy.branch1Math,
        parentId: "root",
      },
      {
        id: "branch2",
        type: "branch",
        label: copy.branch2Label,
        description: copy.branch2Desc,
        mathContent: copy.branch2Math,
        parentId: "root",
      },
      {
        id: "leaf1",
        type: "leaf",
        label: copy.leafLabel,
        description: copy.leafDesc,
        mathContent: copy.leafMath,
        parentId: "branch2",
      },
    ],
    insights: {
      simpleBreakdown: rawInsight?.trim() || copy.insight,
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
