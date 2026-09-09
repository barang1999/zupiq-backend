import { segmentMathContent, hasMathDelimiters } from "./math-segmenter.js";
import { normalizeDiagramBlock, type DiagramRenderBlock } from "./diagram-blocks.js";
import { renderMathSvg, shouldRenderMathSvg } from "./mathjax-svg.js";

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
  | DiagramRenderBlock;

const LATEX_COMMAND_REGEX = /\\[a-zA-Z]+/;
const DELIMITED_MATH_REGEX = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/;

export function buildRenderBlocks(content: string, options: { defaultDisplay?: boolean; lang?: string } = {}): RenderBlock[] {
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

  return raw
    .split(/\n{2,}/)
    .map((part) => buildTextBlock(part.trim(), options.lang))
    .filter((block) => block.content);
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
    .replace(/(?:\r?\n)*\s*(\*{1,2}\s*(?:\b\d+|[\u17E0-\u17E9]+)\.(?!\d)[ \t]*)/g, (match, p1, offset) => {
      return offset === 0 ? p1 : `\n\n${p1}`;
    })
    .replace(/(?:\r?\n)*\s*((?<!\*|\b(?:v|p|fig|eq|step|no|ch|ex|al)\b)(?:\b\d+|[\u17E0-\u17E9]+)\.(?!\d)[ \t]*)/gi, (match, p1, offset) => {
      return offset === 0 ? p1 : `\n\n${p1}`;
    })
    .replace(/([។៕.!?»”\)])\s*(\*\*[^\n*]+?\*\*)/g, "$1\n\n$2")
    .replace(/([៖:])\s*(\*{1,2}(?:\b\d+|[\u17E0-\u17E9]+)\.(?!\d))/g, "$1\n\n$2")
    // Keep test/example cues on their own line after a bold condition label:
    // `**សម្រាប់ $x>2$:** ឧទាហរណ៍...` should not read as one continuous claim.
    .replace(/([៖:]\*\*)[ \t]+(?=(?:ឧទាហរណ៍|Example\b|For example\b))/gi, "$1\n")
    // Replace LaTeX thin-space separators (` \ ` or `\ `) used between math expression segments
    // with a comma+space — prevents adjacent segments from running together without any separator.
    .replace(/[ \t]*\\[ \t]*/g, "\n");

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
