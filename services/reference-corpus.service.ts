import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

export interface ReferenceFormula {
  latex: string;
  meaning?: string;
  confidence?: number;
}

export interface ReferenceChunk {
  chunkId: string;
  sourceId: string;
  language: string;
  subject: string;
  gradeRange: string[];
  pageStart?: number;
  pageEnd?: number;
  topic: string;
  topicKh?: string;
  chunkType: "concept_explanation" | "formula_rule" | "worked_example" | string;
  responsePatternIds?: string[];
  text: string;
  normalizedText?: string;
  formulas?: ReferenceFormula[];
  problem?: {
    textKh?: string;
    text?: string;
    latex?: string;
    [key: string]: unknown;
  };
  solutionSteps?: Array<{
    textKh?: string;
    text?: string;
    latex?: string;
    explanationKh?: string;
    explanation?: string;
    [key: string]: unknown;
  }>;
  finalAnswer?: {
    textKh?: string;
    text?: string;
    latex?: string;
    [key: string]: unknown;
  };
  keywords?: string[];
  difficulty?: string;
  quality?: {
    textClean?: boolean;
    formulaReviewed?: boolean;
    solutionReviewed?: boolean;
    humanReviewed?: boolean;
    trusted?: boolean;
    needsCuration?: boolean;
    excluded?: boolean;
    [key: string]: unknown;
  };
}

export interface ReferenceResponsePattern {
  patternId: string;
  name: string;
  language: string;
  subject: string;
  appliesTo: string[];
  structure: string[];
  khmerPhrases?: string[];
  avoid?: string[];
  mathFormatting?: {
    formulaFirstWhenUseful?: boolean;
    useLatex?: boolean;
    keepKhmerLabelsOutsideMath?: boolean;
    conclusionPrefix?: string;
    [key: string]: unknown;
  };
}

export interface ReferenceSource {
  id: string;
  title: string;
  titleKh?: string;
  author?: string;
  language: string;
  subject: string;
  gradeRange: string[];
  sourceType: string;
  topics: string[];
  metadata?: Record<string, unknown>;
  quality?: Record<string, unknown>;
}

interface ReferenceCorpusFile {
  schemaVersion: number;
  source: ReferenceSource;
  responsePatterns?: ReferenceResponsePattern[];
  chunks: ReferenceChunk[];
}

export interface BuildReferenceContextOptions {
  subject?: string | null;
  grade?: string | null;
  language?: string | null;
  query?: string | null;
  limit?: number;
}

const DEFAULT_REFERENCE_LIMIT = 5;
const MAX_REFERENCE_CONTEXT_CHARS = 5200;

let cachedCorpus: ReferenceCorpusFile[] | null = null;

const KHMER_ALIASES: Array<[RegExp, string[]]> = [
  [/ស្វ[៊ីីុ៉]+ត|sequence|sequences?/i, ["sequences", "ស្វ៊ីត"]],
  [/នព្វន្ត|arithmetic|common difference/i, ["arithmetic_sequence", "ស្វ៊ីតនព្វន្ត", "ផលសងរួម"]],
  [/ធរណីមាត្រ|geometric|common ratio/i, ["geometric_sequence", "ស្វ៊ីតធរណីមាត្រ", "ផលធៀបរួម"]],
  [/ផលបូក|sum|series|sigma|សិចម៉ា/i, ["sequence_sum", "summation_formulas", "ផលបូក"]],
  [/កើន|ចុះ|ថេរ|monotonic|increasing|decreasing/i, ["sequence_monotonicity", "អថេរភាព"]],
  [/ទាល់|bounded|upper bound|lower bound/i, ["bounded_sequence", "ស្វ៊ីតទាល់"]],
  [/អនុមាន|induction|prove/i, ["mathematical_induction", "វិចារអនុមាន"]],
];

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_+\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  const normalized = normalize(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter((token) => token.length > 1));
}

function expandQueryTerms(query: string): string[] {
  const terms = new Set<string>(Array.from(tokenize(query)));
  for (const [pattern, aliases] of KHMER_ALIASES) {
    if (pattern.test(query)) {
      aliases.forEach((alias) => terms.add(normalize(alias)));
    }
  }
  return Array.from(terms).filter(Boolean);
}

function getReferenceDirectory(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const sourceRoot = path.resolve(path.dirname(currentFile), "..");
  const cwdRoot = process.cwd();
  return path.join(
    sourceRoot.endsWith(`${path.sep}dist`) ? cwdRoot : sourceRoot,
    "data",
    "reference"
  );
}

async function loadStaticCorpus(): Promise<ReferenceCorpusFile[]> {
  if (cachedCorpus) return cachedCorpus;

  const referenceDirectory = getReferenceDirectory();
  const filenames = await readdir(referenceDirectory);
  const referenceFiles = filenames
    .filter((filename) => filename.endsWith(".reference.json"))
    .sort();

  const parsedFiles = await Promise.all(
    referenceFiles.map(async (filename) => {
      const raw = await readFile(path.join(referenceDirectory, filename), "utf8");
      return JSON.parse(raw) as ReferenceCorpusFile;
    })
  );

  cachedCorpus = parsedFiles;
  return cachedCorpus;
}

function subjectMatches(chunk: ReferenceChunk, subject?: string | null): boolean {
  if (!subject) return true;
  const requested = normalize(subject);
  if (!requested) return true;
  const chunkSubject = normalize(chunk.subject);
  return requested === chunkSubject || requested.includes(chunkSubject) || chunkSubject.includes(requested);
}

function gradeMatches(chunk: ReferenceChunk, grade?: string | null): boolean {
  if (!grade || chunk.gradeRange.length === 0) return true;
  const normalizedGrade = `${grade}`.match(/\d+/)?.[0];
  if (!normalizedGrade) return true;
  return chunk.gradeRange.includes(normalizedGrade);
}

function chunkTextBlob(chunk: ReferenceChunk): string {
  return [
    chunk.text,
    chunk.normalizedText,
    chunk.problem?.textKh,
    chunk.problem?.text,
    chunk.problem?.latex,
    chunk.finalAnswer?.textKh,
    chunk.finalAnswer?.text,
    chunk.finalAnswer?.latex,
    ...(chunk.solutionSteps ?? []).map((step) =>
      `${step.textKh ?? ""} ${step.text ?? ""} ${step.latex ?? ""} ${step.explanationKh ?? ""} ${step.explanation ?? ""}`
    ),
    ...(chunk.formulas ?? []).map((formula) => `${formula.latex} ${formula.meaning ?? ""}`),
  ].filter(Boolean).join(" ");
}

function isRetrievableChunk(chunk: ReferenceChunk): boolean {
  if (chunk.quality?.excluded) return false;
  // U+FFFD means the PDF extractor could not decode source text. Do not let
  // those chunks reach the model unless they are manually replaced/cleaned.
  return !chunkTextBlob(chunk).includes("\uFFFD");
}

function scoreChunk(chunk: ReferenceChunk, query: string, queryTerms: string[]): number {
  if (!query.trim()) return 1;

  const haystack = normalize([
    chunk.topic,
    chunk.topicKh,
    chunkTextBlob(chunk),
    ...(chunk.keywords ?? []),
  ].filter(Boolean).join(" "));

  let score = 0;
  for (const term of queryTerms) {
    if (!term) continue;
    if (haystack.includes(term)) score += 2;
    if (normalize(chunk.topic).includes(term) || normalize(chunk.topicKh).includes(term)) score += 3;
    if ((chunk.keywords ?? []).some((keyword) => normalize(keyword).includes(term))) score += 2;
  }

  for (const [pattern, aliases] of KHMER_ALIASES) {
    if (!pattern.test(query)) continue;
    const aliasHit = aliases.some((alias) => haystack.includes(normalize(alias)));
    if (aliasHit) score += 4;
  }

  if (chunk.quality?.trusted) score += 6;
  if (chunk.quality?.humanReviewed) score += 2;
  if (chunk.quality?.formulaReviewed) score += 1;
  if (chunk.quality?.needsCuration) score -= 2;
  if (chunk.chunkType === "formula_rule") score += 1;
  if (chunk.chunkType === "worked_example" && queryTerms.length > 0) score += 1;
  return score;
}

function formatReferenceChunk(chunk: ReferenceChunk, source: ReferenceSource, index: number): string {
  const pageLabel = chunk.pageStart
    ? `p.${chunk.pageEnd && chunk.pageEnd !== chunk.pageStart ? `${chunk.pageStart}-${chunk.pageEnd}` : chunk.pageStart}`
    : "page unknown";
  const formulas = (chunk.formulas ?? [])
    .slice(0, 4)
    .map((formula) => `  - $${formula.latex}$${formula.meaning ? `: ${formula.meaning}` : ""}`)
    .join("\n");
  const qualityLabel = chunk.quality?.trusted
    ? "trusted reviewed reference"
    : chunk.quality?.needsCuration
      ? "starter extraction; verify formulas before relying on symbols"
      : "review status unspecified";
  const problem = chunk.problem
    ? `Problem: ${[chunk.problem.textKh ?? chunk.problem.text, chunk.problem.latex ? `$${chunk.problem.latex}$` : ""].filter(Boolean).join(" ")}`
    : "";
  const solutionSteps = (chunk.solutionSteps ?? [])
    .slice(0, 4)
    .map((step, stepIndex) => {
      const body = [
        step.textKh ?? step.text,
        step.latex ? `$${step.latex}$` : "",
        step.explanationKh ?? step.explanation,
      ].filter(Boolean).join(" ");
      return `  ${stepIndex + 1}. ${body}`;
    })
    .join("\n");
  const finalAnswer = chunk.finalAnswer
    ? `Final answer: ${[chunk.finalAnswer.textKh ?? chunk.finalAnswer.text, chunk.finalAnswer.latex ? `$${chunk.finalAnswer.latex}$` : ""].filter(Boolean).join(" ")}`
    : "";

  return [
    `${index}. ${chunk.topicKh ?? chunk.topic} (${source.title}, ${pageLabel})`,
    `Quality: ${qualityLabel}`,
    problem,
    `Khmer reference: ${chunk.text}`,
    chunk.normalizedText ? `Clean explanation: ${chunk.normalizedText}` : "",
    formulas ? `Formulas:\n${formulas}` : "",
    solutionSteps ? `${chunk.quality?.trusted ? "Reviewed" : "Recovered"} solution steps:\n${solutionSteps}` : "",
    finalAnswer,
  ].filter(Boolean).join("\n");
}

function selectResponsePatterns(
  selected: Array<{ source: ReferenceSource; chunk: ReferenceChunk; score: number }>,
  corpus: ReferenceCorpusFile[]
): ReferenceResponsePattern[] {
  const patternIds = new Set<string>();
  for (const item of selected) {
    (item.chunk.responsePatternIds ?? []).forEach((id) => patternIds.add(id));
  }
  if (patternIds.size === 0) return [];

  const patternsById = new Map<string, ReferenceResponsePattern>();
  for (const entry of corpus) {
    for (const pattern of entry.responsePatterns ?? []) {
      patternsById.set(pattern.patternId, pattern);
    }
  }

  return Array.from(patternIds)
    .map((id) => patternsById.get(id))
    .filter((pattern): pattern is ReferenceResponsePattern => Boolean(pattern))
    .slice(0, 2);
}

function formatResponsePattern(pattern: ReferenceResponsePattern, index: number): string {
  const structure = pattern.structure.slice(0, 5).map((step) => `  - ${step}`).join("\n");
  const phrases = (pattern.khmerPhrases ?? []).slice(0, 8).join(", ");
  const avoid = (pattern.avoid ?? []).slice(0, 3).map((item) => `  - ${item}`).join("\n");
  const conclusionPrefix = pattern.mathFormatting?.conclusionPrefix
    ? `Conclusion phrase: ${pattern.mathFormatting.conclusionPrefix}`
    : "";

  return [
    `${index}. ${pattern.name}`,
    `Use this as style guidance, not as text to copy.`,
    `Structure:\n${structure}`,
    phrases ? `Useful local phrases: ${phrases}` : "",
    conclusionPrefix,
    avoid ? `Avoid:\n${avoid}` : "",
  ].filter(Boolean).join("\n");
}

export async function buildReferenceContext(
  options: BuildReferenceContextOptions
): Promise<string | null> {
  const query = `${options.query ?? ""}`.trim();
  const corpus = await loadStaticCorpus().catch((err) => {
    logger.error("Failed to load reference corpus", err);
    return [] as ReferenceCorpusFile[];
  });
  if (corpus.length === 0) return null;

  const queryTerms = expandQueryTerms(query);
  const candidates = corpus.flatMap((entry) =>
    entry.chunks
      .filter(isRetrievableChunk)
      .filter((chunk) => subjectMatches(chunk, options.subject))
      .filter((chunk) => gradeMatches(chunk, options.grade))
      .map((chunk) => ({
        source: entry.source,
        chunk,
        score: scoreChunk(chunk, query, queryTerms),
      }))
  );

  const ranked = candidates
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || (a.chunk.pageStart ?? 0) - (b.chunk.pageStart ?? 0));

  const trustedRanked = ranked.filter((candidate) => candidate.chunk.quality?.trusted);
  const selectedPool = trustedRanked.length > 0 ? trustedRanked : ranked;
  const selected = selectedPool
    .slice(0, Math.max(1, Math.min(options.limit ?? DEFAULT_REFERENCE_LIMIT, 8)));

  if (selected.length === 0) return null;

  const responsePatterns = selectResponsePatterns(selected, corpus);
  const responsePatternSection = responsePatterns.length > 0
    ? [
        `[REFERENCE RESPONSE PATTERNS]`,
        `Follow these local explanation patterns when they fit the task. Keep the answer natural and concise.`,
        ...responsePatterns.map((pattern, index) => formatResponsePattern(pattern, index + 1)),
        `[END REFERENCE RESPONSE PATTERNS]`,
      ].join("\n\n")
    : "";

  const lines = [
    `[REFERENCE CONTEXT]`,
    `Use these textbook/reference snippets only when relevant to the student's question.`,
    `They are curated from Khmer high-school math source material. Prefer the clean formulas below over raw PDF extraction.`,
    `Explain in the student's language and level. Do not quote long passages; teach in your own words.`,
    responsePatternSection,
    ``,
    ...selected.map((item, index) => formatReferenceChunk(item.chunk, item.source, index + 1)),
    ``,
    `[END REFERENCE CONTEXT]`,
  ];

  const context = lines.join("\n\n");
  return context.length <= MAX_REFERENCE_CONTEXT_CHARS
    ? context
    : `${context.slice(0, MAX_REFERENCE_CONTEXT_CHARS)}\n\n[REFERENCE CONTEXT TRUNCATED]`;
}
