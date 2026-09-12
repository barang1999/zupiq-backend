import { segmentMathContent, hasMathDelimiters } from "./math-segmenter.js";
import { normalizeDiagramBlock, type DiagramRenderBlock } from "./diagram-blocks.js";
import { renderMathSvg, shouldRenderMathSvg } from "./mathjax-svg.js";
import { extractTableChunks, containsTableChunk, unescapeCellPipes, type TableAlignment } from "./table-blocks.js";

export type RenderBlock =
  | {
      type: "text";
      content: string;
      lang?: string;
    }
  | {
      type: "math";
      mode: "inline" | "display";
      latex: string;
      normalizedLatex: string;
      valid: boolean;
      warnings?: string[];
      renderEngine?: "mathjax-svg";
      svgHtml?: string;
    }
  | {
      type: "table";
      alignments: TableAlignment[];
      // headers[col] / rows[r][col] are themselves fully segmented render
      // blocks (text/math), so a cell's own math renders through the exact
      // same pipeline as top-level content — just scoped to that one cell,
      // and never passed through the paragraph-shaped prose regexes in
      // normalizeTextBlockContent (bullets/headings/section markers are
      // meaningless inside a single cell, and are exactly what caused
      // table/prose cross-contamination when cells were plain text substrings).
      headers: RenderBlock[][];
      rows: RenderBlock[][][];
    }
  | DiagramRenderBlock;

const LATEX_COMMAND_REGEX = /\\[a-zA-Z]+/;
const DELIMITED_MATH_REGEX = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/;

export function buildRenderBlocks(content: string, options: { defaultDisplay?: boolean; lang?: string } = {}): RenderBlock[] {
  const raw = `${content ?? ""}`;
  if (!raw.trim()) return [];

  // Extract any markdown table region(s) as their own structural chunks
  // BEFORE any math-token splitting or prose normalization runs, so a table's
  // rows/cells can never be merged into surrounding prose (or vice versa) by
  // a later regex pass. Gate on containsTableChunk so content with no table
  // at all falls straight through to the exact pre-existing behavior below —
  // zero behavior change for the overwhelmingly common non-table case.
  const chunks = extractTableChunks(raw);
  if (containsTableChunk(chunks)) {
    return compactTextBlocks(
      chunks.flatMap((chunk) => (chunk.kind === "table" ? [buildTableBlock(chunk)] : buildProseRenderBlocks(chunk.text, options)))
    );
  }

  return buildProseRenderBlocks(raw, options);
}

function buildProseRenderBlocks(content: string, options: { defaultDisplay?: boolean; lang?: string } = {}): RenderBlock[] {
  const raw = `${content ?? ""}`;
  if (!raw.trim()) return [];

  const segments = segmentMathContent(raw);
  // Gate on whether the raw string actually had delimiters — not on whether any
  // resulting segment is still typed "math" — because a delimited span can get
  // downgraded to plain text (e.g. Khmer prose wrapped in "$...$"). Falling through
  // to the naive paragraph split below would re-use the *original*, still-delimited
  // string and reintroduce the very "$...$" leak this segmentation exists to prevent.
  if (segments.length > 0 && (segments.some((segment) => segment.type === "math") || hasMathDelimiters(raw))) {
    return compactTextBlocks(segments.map((segment) => {
      if (segment.type === "math") {
        return buildMathBlock(segment.content, Boolean(segment.display));
      }
      return buildTextBlock(segment.content, options.lang);
    }));
  }

  if (looksLikeBareMath(raw)) {
    return [buildMathBlock(raw, options.defaultDisplay ?? true)];
  }

  const clauseBlocks = splitUndelimitedMathClauses(raw);
  if (clauseBlocks) return clauseBlocks;

  return raw
    .split(/\n{2,}/)
    .map((part) => buildTextBlock(part.trim(), options.lang))
    .filter((block) => block.content);
}

function buildTableBlock(chunk: { headerCells: string[]; alignments: TableAlignment[]; rowCells: string[][] }): Extract<RenderBlock, { type: "table" }> {
  const headers = chunk.headerCells.map((cell) => segmentTableCell(cell));
  const rows = chunk.rowCells.map((row) => chunk.headerCells.map((_, colIndex) => segmentTableCell(row[colIndex] ?? "")));
  return { type: "table", alignments: chunk.alignments, headers, rows };
}

// Segments one table cell's raw text into render blocks, reusing the exact
// same math tokenizer as top-level content — but deliberately skipping
// normalizeTextBlockContent's paragraph-shaped repairs (bullets, section
// headings, the "\ " separator rule). A cell is never a paragraph; running
// those regexes on cell content is exactly what let a table's own structure
// get reshaped by rules meant for sentences.
function segmentTableCell(cellRaw: string): RenderBlock[] {
  const unescaped = unescapeCellPipes(`${cellRaw ?? ""}`);
  if (!unescaped.trim()) return [];

  const segments = segmentMathContent(unescaped);
  if (segments.length === 0) {
    return unescaped.trim() ? [{ type: "text", content: unescaped.trim() }] : [];
  }

  return compactTextBlocks(
    segments
      .map((segment): RenderBlock | null => {
        if (segment.type === "math") return buildMathBlock(segment.content, false);
        const trimmed = segment.content.replace(/[ \t]+/g, " ").trim();
        return trimmed ? { type: "text", content: trimmed } : null;
      })
      .filter((block): block is RenderBlock => block !== null)
  );
}

export function buildMathBlocks(content: string, options: { defaultDisplay?: boolean } = {}): RenderBlock[] {
  const raw = `${content ?? ""}`.trim();
  if (!raw) return [];

  const blocks = buildRenderBlocks(raw, { defaultDisplay: options.defaultDisplay ?? true });
  if (blocks.length === 1 && blocks[0].type === "text" && looksLikeBareMath(blocks[0].content)) {
    return [buildMathBlock(blocks[0].content, options.defaultDisplay ?? true)];
  }

  return blocks.filter((block): block is Extract<RenderBlock, { type: "math" }> => block.type === "math");
}

export function enrichRenderBlocks(blocks: unknown): RenderBlock[] {
  if (!Array.isArray(blocks)) return [];

  return blocks
    .flatMap((block): RenderBlock[] => {
      if (block?.type === "text") {
        // The AI is asked to pre-split label/description/math blocks itself, but it
        // still sometimes writes a whole sentence as one "text" block with a raw
        // "$...$" wrapper baked into the content (e.g. a Khmer sentence mentioning
        // "xy" and "y^2"). Route it back through the same segmenter used for raw
        // strings instead of trusting the AI's type tag, so any embedded math still
        // gets split out and rendered rather than leaking the delimiters verbatim.
        const rawText = `${block.content ?? ""}`;
        if (!rawText.trim()) return [];
        const lang = typeof block.lang === "string" ? block.lang : undefined;

        // Only re-route through buildRenderBlocks when there's an actual "$...$"
        // still embedded — that's the one case this exists to catch. A block
        // that's already pure prose (the overwhelmingly common case on a SECOND
        // pass — this function re-processes blocks a prior buildRenderBlocks call
        // already built, e.g. a cached/re-served session) has nothing to split
        // out, and calling buildRenderBlocks on it in ISOLATION is actively
        // harmful: with no delimiter to trigger the segmented branch, it falls
        // through to the naive `raw.split(/\n{2,}/).map(part => ...part.trim())`
        // fallback, which trims away leading/trailing blank lines — exactly the
        // signal that marked this block as starting a new paragraph relative to
        // whatever (a math block, usually) preceded it in the original sequence.
        // A real observed case: a text block "\n\nដើម្បីឲ្យ ..." — right after a
        // display equation — loses its leading "\n\n" on this second pass, so the
        // paragraph after the equation gets glued onto it instead of starting its
        // own <p>. Passing it through untouched keeps that whitespace intact; it
        // was already normalized once, on the pass that originally built it.
        if (!hasMathDelimiters(rawText)) {
          return [{ type: "text", content: rawText, ...(lang ? { lang } : {}) }];
        }
        return buildRenderBlocks(rawText, { lang });
      }

      if (block?.type === "math") {
        const display = block.mode === "display";
        const input = `${block.normalizedLatex || block.latex || block.content || ""}`.trim();
        if (!input) return [];
        return [{
          ...buildMathBlock(input, display),
          latex: typeof block.latex === "string" && block.latex.trim() ? block.latex.trim() : stripMathDelimiters(input),
        }];
      }

      if (block?.type === "diagram" || block?.diagramType) {
        const diagram = normalizeDiagramBlock(block);
        return diagram ? [diagram] : [];
      }

      // A "table" block here was already built by our own buildRenderBlocks
      // on a previous pass (the AI never emits this shape directly) — e.g. a
      // cached/re-served session whose solutionBlocks were attached once
      // already. Without this case it fell through to the catch-all `return
      // []` below and silently vanished on every subsequent serve — the
      // table rendered on first generation, then disappeared entirely after
      // a reload. Pass it through structurally validated rather than
      // dropped; its cells are already fully-segmented RenderBlock[] from
      // that earlier pass, so there's nothing left to re-derive.
      if (block?.type === "table") {
        return [{
          type: "table",
          alignments: Array.isArray(block.alignments) ? block.alignments : [],
          headers: Array.isArray(block.headers) ? block.headers : [],
          rows: Array.isArray(block.rows) ? block.rows : [],
        }];
      }

      return [];
    })
    .filter((block): block is RenderBlock => Boolean(block));
}

export function buildMathBlock(input: string, display: boolean): Extract<RenderBlock, { type: "math" }> {
  const normalizedLatex = normalizeLatexForRender(input);
  const warnings = getLatexWarnings(normalizedLatex);

  // Attempt SVG rendering for both display and inline math blocks to guarantee
  // consistent cross-platform rendering quality and high performance.
  const attemptedSvg = shouldRenderMathSvg(normalizedLatex, display);
  const svgHtml = attemptedSvg ? renderMathSvg(normalizedLatex, display) : null;
  // Structurally valid LaTeX can still fail to pre-render (a transient MathJax
  // error, an unsupported edge case, etc.) — that's a real, if hopefully rare,
  // failure mode, not "nothing to render". Surface it explicitly instead of
  // silently shipping a `valid: true` block with no rendering artifact, so
  // consumers know this one specifically needs a client-side fallback.
  if (attemptedSvg && !svgHtml) warnings.push("svg-render-failed");

  return {
    type: "math",
    mode: display ? "display" : "inline",
    latex: stripMathDelimiters(`${input ?? ""}`).trim(),
    normalizedLatex,
    valid: warnings.length === 0,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(svgHtml ? { renderEngine: "mathjax-svg" as const, svgHtml } : {}),
  };
}

function buildTextBlock(content: string, lang?: string): Extract<RenderBlock, { type: "text" }> {
  return {
    type: "text",
    content: normalizeTextBlockContent(content),
    ...(lang ? { lang } : {}),
  };
}

function normalizeTextBlockContent(content: string): string {
  const raw = `${content ?? ""}`
    // Strip fenced code blocks (mermaid, etc.) that can't be rendered in solution text
    .replace(/```[^\n]*\n[\s\S]*?```/g, "")
    .replace(/[ \t]+\n/g, "\n")
    // Gemini sometimes emits lonely markdown list markers between inline math segments.
    // Once split into render blocks, they become lonely visible "*" lines.
    .replace(/(^|\n)\s*[*-]\s*$/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    // Ensure bullet points (e.g. "- item" or "* item") preceded by punctuation start on a new line
    .replace(/([។៕.!?៖:])\s*([*-]\s+)/g, "$1\n\n$2")
    // Ensure section titles with bold or plain numbered markers (e.g. **1. ...**, **១. ...**, 1., ១.) start on a clean new line with double newline
    .replace(/(?:\r?\n)*\s*(\*{1,2}\s*(?:\b\d+|[\u17E0-\u17E9]+)(?:\.(?!\d)|\))[ \t]*)/g, (match, p1, offset) => {
      return offset === 0 ? p1 : `\n\n${p1}`;
    })
    .replace(/(?:\r?\n)*\s*((?<!\*|\b(?:v|p|fig|eq|step|no|ch|ex|al)\b)(?:\b\d+|[\u17E0-\u17E9]+)(?:\.(?!\d)|\))[ \t]*)/gi, (match, p1, offset) => {
      return offset === 0 ? p1 : `\n\n${p1}`;
    })
    .replace(/([។៕.!?»”\)])\s*(\*\*[^\n*]+?\*\*)/g, "$1\n\n$2")
    .replace(/([៖:])\s*(\*{1,2}(?:\b\d+|[\u17E0-\u17E9]+)(?:\.(?!\d)|\)))/g, "$1\n\n$2")
    // Keep test/example cues on their own line after a bold condition label:
    // `**សម្រាប់ $x>2$:** ឧទាហរណ៍...` should not read as one continuous claim.
    .replace(/([៖:]\*\*)[ \t]+(?=(?:ឧទាហរណ៍|Example\b|For example\b))/gi, "$1\n")
    // Replace LaTeX thin-space separators (` \ ` or `\ `) used between math expression segments
    // with a newline — prevents adjacent segments from running together without any separator.
    // The backslash must NOT be followed by a letter: a bare separator backslash is always
    // followed by whitespace/end-of-string, never by a command name. Without this guard, a real
    // LaTeX macro that leaked into a text block as raw syntax (e.g. "\infty" from a prose span
    // isProseMisclassifiedAsMath demoted from math) gets its backslash eaten and replaced with a
    // newline, corrupting "[0, +\infty)" into "[0, +\ninfty)" — a real observed case.
    .replace(/[ \t]*\\(?![a-zA-Z])[ \t]*/g, "\n");

  if (!raw.trim()) return "";

  const leadingWhitespaces = raw.match(/^\s*/)?.[0] || "";
  const trailingWhitespaces = raw.match(/\s*$/)?.[0] || "";
  return leadingWhitespaces + raw.trim() + trailingWhitespaces;
}

function compactTextBlocks(blocks: RenderBlock[]): RenderBlock[] {
  const compacted: RenderBlock[] = [];

  for (const block of blocks) {
    if (block.type === "text" && !block.content.trim()) continue;
    const previous = compacted[compacted.length - 1];
    if (block.type === "text" && previous?.type === "text") {
      previous.content = `${previous.content}\n${block.content}`;
      continue;
    }
    compacted.push(block);
  }

  return compacted;
}

function normalizeLatexForRender(input: string): string {
  return normalizeTextCommandsForMath(stripMathDelimiters(`${input ?? ""}`))
    // Whitespace
    .replace(/\u00a0/g, " ")
    // Over-escaped backslashes from JSON serialization (\\frac → \frac)
    .replace(/\\{2,}([a-zA-Z])/g, "\\$1")
    // Tab and other control character artifacts from JSON deserialization:
    // a raw LaTeX command like "\tan" or "\nabla" that reaches a JSON parser
    // without its backslash doubled gets its "\t"/"\n" pair misread as an
    // actual control character (JSON's escape rules, not this codebase's
    // choice) — losing the command name's own first letter along with the
    // backslash, e.g. "\tan(u)" -> TAB+"an(u)", "\nabla" -> FF+"abla". These
    // five patterns undo exactly that, by re-inserting the missing
    // backslash+letter in front of the SPECIFIC known command suffixes this
    // codebase's own LaTeX vocabulary can produce this way.
    //
    // Deliberately NOT a blanket "control-char immediately followed by any
    // letters" repair (an earlier, broader version of this): a multi-line
    // \begin{aligned}...\end{aligned} block routinely has a genuine,
    // meaningless-in-LaTeX newline right before the next line's own content
    // (e.g. "...\\\\\nb &= \lim..." — ordinary formatting, not corruption).
    // "\n" + "b" matches "any letters" just as well as "\n" + "abla" does,
    // so the broad version invented a bogus "\nb" command out of a
    // completely ordinary line break — a real observed case, visibly
    // rendering "\nb" in red (KaTeX's undefined-command styling) right
    // before a legitimate "b = \lim_{x\to-\infty}(y-ax)" line. No real
    // LaTeX command in this codebase's vocabulary corrupts down to just a
    // single bare letter like "b", so restricting the match to actual
    // known suffixes closes that gap without losing the genuine repairs.
    .replace(/\t(an|ext|imes|o|heta)\b/g, "\\t$1")
    .replace(/\n(eq|abla)\b/g, "\\n$1")
    .replace(/\r(ightarrow|ho)\b/g, "\\r$1")
    .replace(/\f(rac|orall)\b/g, "\\f$1")
    .replace(/[\b](egin|inom|eta|matrix)\b/g, "\\b$1")
    // Keep standard replacement for specific malformed commands just in case
    .replace(/\\tfrac\b/gi, "\\frac")
    // Unicode operators → LaTeX
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/±/g, "\\pm ")
    .replace(/∓/g, "\\mp ")
    .replace(/≤|⩽/g, "\\leq ")
    .replace(/≥|⩾/g, "\\geq ")
    .replace(/≠/g, "\\neq ")
    .replace(/≈/g, "\\approx ")
    .replace(/∞/g, "\\infty ")
    .replace(/∑/g, "\\sum ")
    .replace(/∏/g, "\\prod ")
    .replace(/∫/g, "\\int ")
    .replace(/∂/g, "\\partial ")
    .replace(/∇/g, "\\nabla ")
    .replace(/∈/g, "\\in ")
    .replace(/∉/g, "\\notin ")
    .replace(/⊂/g, "\\subset ")
    .replace(/⊃/g, "\\supset ")
    .replace(/∪/g, "\\cup ")
    .replace(/∩/g, "\\cap ")
    // Arrows
    .replace(/⇒|=>/g, "\\Rightarrow ")
    .replace(/⇔/g, "\\Leftrightarrow ")
    .replace(/→|->/g, "\\to ")
    .replace(/←/g, "\\leftarrow ")
    // Unicode super/subscript digits
    .replace(/([A-Za-z0-9])[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => {
      const base = m[0];
      const sup = m.slice(1).split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join("");
      return `${base}^{${sup}}`;
    })
    .replace(/[A-Za-z][₀₁₂₃₄₅₆₇₈₉]+/g, (m) => {
      const base = m[0];
      const sub = m.slice(1).split("").map((c) => "₀₁₂₃₄₅₆₇₈₉".indexOf(c)).join("");
      return `${base}_{${sub}}`;
    })
    // Sqrt without braces
    .replace(/√\(([^()\n]+)\)/g, "\\sqrt{$1}")
    .replace(/√\{([^{}\n]+)\}/g, "\\sqrt{$1}")
    .replace(/√([0-9])/g, "\\sqrt{$1}")
    .replace(/\\displaystyle\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextCommandsForMath(input: string): string {
  return `${input ?? ""}`
    .replace(/(?<![a-zA-Z\\])([A-Za-z])\s*\\text\{([^}]*[\u1780-\u17FF][^}]*)\}/g, "$1_{\\text{$2}}")
    .replace(/\\([a-zA-Z]+)_{\\text\{([^}]*[\u1780-\u17FF][^}]*)\}}/g, "\\$1 \\text{$2}")
    .replace(/\\text\{([^}]*[\u1780-\u17FF][^}]*)\}/g, "\\text{$1}");
}

function stripMathDelimiters(input: string): string {
  const text = `${input ?? ""}`.trim();
  if (text.startsWith("$$") && text.endsWith("$$") && text.length >= 4) return text.slice(2, -2);
  if (text.startsWith("\\[") && text.endsWith("\\]") && text.length >= 4) return text.slice(2, -2);
  if (text.startsWith("\\(") && text.endsWith("\\)") && text.length >= 4) return text.slice(2, -2);
  if (text.startsWith("$") && text.endsWith("$") && text.length >= 2) return text.slice(1, -1);
  return text;
}

function looksLikeBareMath(input: string): boolean {
  const text = stripMathDelimiters(`${input ?? ""}`).trim();
  if (!text) return false;

  // 1. If it contains Khmer unicode text, it is prose, not bare math!
  if (/[\u1780-\u17FF]/.test(text)) return false;

  // 2. If it contains math delimiters ($ or $$), it is marked as math
  if (DELIMITED_MATH_REGEX.test(`${input ?? ""}`)) return true;

  // 3. Exclude common prose text keywords in mixed output
  if (/\b(volume|surface|area|find|solve|calculate|មាឌ|ផ្ទៃ|ក្រឡា)\b/i.test(text)) return false;

  // 4. Check for standard math symbols and operators
  if (LATEX_COMMAND_REGEX.test(text)) {
    // A single word command or short expression is fine, but not long sentences
    return text.split(/\s+/).length <= 15;
  }

  if (/^[A-Za-z0-9\\{}\[\]_^+\-*/=().,\s]+$/.test(text) && /[=^_\\]|\\frac|\\sqrt/.test(text)) {
    return true;
  }

  return false;
}

// Splits on a "," or ";" only when it sits OUTSIDE any {}/()/[] nesting —
// e.g. the comma inside "A(1, 1)" or "\frac{1, 2}{3}" never counts as a
// clause boundary, only a comma directly between two top-level clauses
// does. Each returned clause carries the separator that followed it (empty
// for the last one) so callers can splice it back in as plain text.
function splitTopLevelClauses(raw: string): Array<{ text: string; separator: string }> {
  const clauses: Array<{ text: string; separator: string }> = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (ch === "," || ch === ";")) {
      const text = raw.slice(start, i).trim();
      let separatorEnd = i + 1;
      while (separatorEnd < raw.length && /\s/.test(raw[separatorEnd])) separatorEnd += 1;
      if (text) clauses.push({ text, separator: raw.slice(i, separatorEnd) });
      start = separatorEnd;
    }
  }

  const lastText = raw.slice(start).trim();
  if (lastText) clauses.push({ text: lastText, separator: "" });
  return clauses;
}

// A permissive "is this clause pure math notation" check, deliberately
// looser than looksLikeBareMath's own word-count cap — used only once the
// caller has already confirmed the WHOLE string is Khmer-free and contains
// at least one real LaTeX command somewhere, so the only thing left to rule
// out per-clause is ordinary English prose sneaking in via a stray comma
// (e.g. "Since x approaches infinity, \infty is the limit" must NOT get
// every clause wrapped as math). A bare labeled point like "A(1, 1)" or an
// annotation like "(L): y = 2x - 1" has no operator symbol at all and would
// fail looksLikeBareMath's own final check, but is obviously meant as math
// in this context.
function looksLikeMathClause(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[ក-៿]/.test(trimmed)) return false;
  if (!/^[A-Za-z0-9\\{}[\]_^+\-*/=().,:'’\s]+$/.test(trimmed)) return false;
  // Any run of 3+ letters that ISN'T immediately preceded by a backslash is
  // an ordinary English word (a command name always starts with "\", and a
  // bare math variable/label is 1-2 letters at most in this notation).
  return !/(?<!\\)\b[A-Za-z]{3,}\b/.test(trimmed);
}

// A finalAnswer-shaped string can be ALL LaTeX with zero Khmer/English prose
// mixed in, but still miss looksLikeBareMath's single-block check purely
// because it's long — several comma-separated clauses each summarizing one
// part of a multi-part problem (a real observed case: a finalAnswer that
// never used "$" delimiters at all, reading
// "\lim_{x\to0^+}f(x)=-\infty, \lim_{x\to+\infty}f(x)=1, f'(x)=2(...),
// A(1,1), (L):y=2x-1" — one unbroken line of raw backslash-command text).
// Splitting on top-level commas/semicolons and wrapping each clause as its
// own math block (with the original separator kept as plain text between
// them) recovers this without ever touching genuinely mixed prose+math text
// (segmentMathContent/hasMathDelimiters already handle that earlier).
function splitUndelimitedMathClauses(raw: string): RenderBlock[] | null {
  if (/[ក-៿]/.test(raw) || !LATEX_COMMAND_REGEX.test(raw)) return null;

  const clauses = splitTopLevelClauses(raw);
  if (clauses.length <= 1 || !clauses.every(({ text }) => looksLikeMathClause(text))) return null;

  return clauses.flatMap(({ text, separator }) => [
    buildMathBlock(text, false),
    ...(separator ? [buildTextBlock(separator)] : []),
  ]);
}

function getLatexWarnings(latex: string): string[] {
  const warnings: string[] = [];
  if (!latex) warnings.push("empty-latex");
  if (hasUnbalanced(latex, "{", "}")) warnings.push("unbalanced-braces");
  if (hasUnbalancedParenthesesOutsideIntervals(latex)) warnings.push("unbalanced-parentheses");
  if (/\$\s*\$/.test(latex) || /\$/.test(latex)) warnings.push("contains-delimiter");
  if (/\\(?:frac|sqrt)\b(?!\s*\{)/.test(latex)) warnings.push("possibly-malformed-command");
  if (hasUnbalancedEnvironments(latex)) warnings.push("unbalanced-environment");
  return warnings;
}

// Catches truncated/malformed `\begin{env}...\end{env}` pairs (e.g. `aligned`, `cases`,
// `matrix`) — most commonly a mid-generation truncation that leaves an environment open
// with no closing tag. Brace-balance alone won't catch this: `\begin{aligned}` on its own
// has perfectly balanced braces.
function hasUnbalancedEnvironments(input: string): boolean {
  const stack: string[] = [];
  for (const match of input.matchAll(/\\(begin|end)\{([a-zA-Z*]+)\}/g)) {
    const [, kind, name] = match;
    if (kind === "begin") {
      stack.push(name);
    } else if (stack.pop() !== name) {
      return true;
    }
  }
  return stack.length !== 0;
}

function hasUnbalancedParenthesesOutsideIntervals(input: string): boolean {
  const withoutIntervalNotation = input.replace(/[\[(]\s*[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?\s*[\])]/g, "");
  return hasUnbalanced(withoutIntervalNotation, "(", ")");
}

function hasUnbalanced(input: string, open: string, close: string): boolean {
  let depth = 0;
  for (const char of input) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}
