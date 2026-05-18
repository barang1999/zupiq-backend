import { segmentMathContent } from "./math-segmenter.js";
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
    };

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

      return null;
    })
    .filter((block): block is RenderBlock => Boolean(block));
}

export function buildMathBlock(input: string, display: boolean): Extract<RenderBlock, { type: "math" }> {
  const normalizedLatex = normalizeLatexForRender(input);
  const warnings = getLatexWarnings(normalizedLatex);
  const svgHtml = warnings.length === 0 && shouldRenderMathSvg(normalizedLatex, display)
    ? renderMathSvg(normalizedLatex, display)
    : null;

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
    content: `${content ?? ""}`.replace(/[ \t]+\n/g, "\n").trim(),
    ...(lang ? { lang } : {}),
  };
}

function compactTextBlocks(blocks: RenderBlock[]): RenderBlock[] {
  const compacted: RenderBlock[] = [];

  for (const block of blocks) {
    if (block.type === "text" && !block.content.trim()) continue;
    const previous = compacted[compacted.length - 1];
    if (block.type === "text" && previous?.type === "text") {
      previous.content = `${previous.content}\n${block.content}`.trim();
      continue;
    }
    compacted.push(block);
  }

  return compacted;
}

function normalizeLatexForRender(input: string): string {
  return stripMathDelimiters(`${input ?? ""}`)
    .replace(/\u00a0/g, " ")
    .replace(/[−–]/g, "-")
    .replace(/⇒|=>/g, "\\Rightarrow")
    .replace(/→|->/g, "\\to")
    .replace(/\s+/g, " ")
    .replace(/\\displaystyle\s*/g, "")
    .trim();
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
  if (DELIMITED_MATH_REGEX.test(`${input ?? ""}`)) return true;
  if (LATEX_COMMAND_REGEX.test(text)) return true;
  if (/^[A-Za-z0-9\\{}\[\]_^+\-*/=().,\s]+$/.test(text) && /[=^_\\]|\\frac|\\sqrt/.test(text)) return true;
  return false;
}

function getLatexWarnings(latex: string): string[] {
  const warnings: string[] = [];
  if (!latex) warnings.push("empty-latex");
  if (hasUnbalanced(latex, "{", "}")) warnings.push("unbalanced-braces");
  if (hasUnbalanced(latex, "(", ")")) warnings.push("unbalanced-parentheses");
  if (/\$\s*\$/.test(latex) || /\$/.test(latex)) warnings.push("contains-delimiter");
  if (/\\(?:frac|sqrt)\b(?!\s*\{)/.test(latex)) warnings.push("possibly-malformed-command");
  return warnings;
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
