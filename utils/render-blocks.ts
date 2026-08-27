import { segmentMathContent } from "./math-segmenter.js";
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
  if (segments.length > 0 && segments.some((segment) => segment.type === "math")) {
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
    .map((block): RenderBlock | null => {
      if (block?.type === "text") {
        return buildTextBlock(`${block.content ?? ""}`, typeof block.lang === "string" ? block.lang : undefined);
      }

      if (block?.type === "math") {
        const display = block.mode === "display";
        const input = `${block.normalizedLatex || block.latex || block.content || ""}`.trim();
        if (!input) return null;
        return {
          ...buildMathBlock(input, display),
          latex: typeof block.latex === "string" && block.latex.trim() ? block.latex.trim() : stripMathDelimiters(input),
        };
      }

      if (block?.type === "diagram" || block?.diagramType) {
        return normalizeDiagramBlock(block);
      }

      return null;
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
    // Ensure numbered items (e.g. 1., 2., 3. or Khmer numbers ១., ២., ៣.) start on a new line for clean lists
    .replace(/(?<!\n|^)(?<!\*)\s*(\b\d+|[\u17E0-\u17E9])\.(?!\d)\s*/g, "\n$1. ")
    .replace(/\*\*[ \t]*\n[ \t]*(?=(?:\d+|[\u17E0-\u17E9])\.(?!\d))/g, "**")
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
    .replace(/\t([a-zA-Z]+)/g, "\\t$1")
    .replace(/\n([a-zA-Z]+)/g, "\\n$1")
    .replace(/\r([a-zA-Z]+)/g, "\\r$1")
    .replace(/\f([a-zA-Z]+)/g, "\\f$1")
    .replace(/[\b]([a-zA-Z]+)/g, "\\b$1")
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
