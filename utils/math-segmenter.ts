/**
 * Utility to segment tutoring content into prose and math blocks on the server.
 * This allows the mobile client to skip expensive regex parsing during scroll.
 */

const MATH_TOKEN_REGEX = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;
// Non-global mirror of MATH_TOKEN_REGEX for stateless .test() checks — the /g
// flag above carries lastIndex state across calls, which corrupts repeat use.
const MATH_DELIMITER_PRESENT_REGEX = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/;
const KHMER_RANGE = /[ក-៿]/;

// Whether `content` contains an explicit math delimiter pair at all — independent
// of how segmentMathContent ultimately classifies what's inside those delimiters
// (a span can still get downgraded to plain text, e.g. by isProseMisclassifiedAsMath).
// Callers use this to decide whether to trust the segmented breakdown (which already
// stripped any delimiters) over a naive re-split of the original raw string.
export function hasMathDelimiters(content: string): boolean {
  return MATH_DELIMITER_PRESENT_REGEX.test(`${content ?? ""}`);
}

// A "$...$"-delimited span is only genuine math if any Khmer script inside it is
// confined to a \text{...} unit/word label (e.g. "$v = 12\ \text{ម/s}$"). If Khmer
// appears outside of \text{...}, the model has wrapped a whole prose sentence in
// math delimiters (e.g. "$ប្រើវិធានផលគុណសម្រាប់ xy...$") — MathJax/KaTeX can't
// typeset Khmer glyphs in math mode, so treat that as plain text instead.
function isProseMisclassifiedAsMath(latex: string): boolean {
  const withoutTextCommands = latex.replace(/\\text\{[^{}]*\}/g, "");
  return KHMER_RANGE.test(withoutTextCommands);
}

function repairBrokenMathDelimiters(content: string): string {
  return `${content ?? ""}`.replace(
    /(?<!\$)\$([^$\n]+?)\$\$\s+\$\$([^$\n]+?)\$(?!\$)/g,
    (_match, first, second) => `$$${first.trim()}$$\n\n$$${second.trim()}$$`
  );
}

export interface MathSegment {
  type: 'text' | 'math';
  content: string;
  display?: boolean;
}

function repairInlineMathNewlines(content: string): string {
  return content.replace(/\$(?!\$)([\s\S]*?)\$(?!\$)/g, (match, inside) => {
    if (inside.includes("\n\n") || !inside.trim() || inside.length > 500) return match;
    if (!inside.includes("\n")) return match;
    return `$${inside.replace(/\r?\n/g, " ")}$`;
  });
}

export function segmentMathContent(content: string): MathSegment[] {
  if (!content || typeof content !== 'string') return [];

  let repairedContent = repairBrokenMathDelimiters(content);
  repairedContent = repairInlineMathNewlines(repairedContent);

  // Split by the math tokens
  const parts = repairedContent.split(MATH_TOKEN_REGEX);
  const segments: MathSegment[] = [];

  parts.forEach((part, index) => {
    if (!part) return;

    if (index % 2 === 0) {
      // Prose segment
      segments.push({
        type: 'text',
        content: part
      });
    } else {
      // Math segment - unwrap delimiters
      let display = false;
      let latex = part;

      if (part.startsWith('$$') && part.endsWith('$$')) {
        display = true;
        latex = part.slice(2, -2);
      } else if (part.startsWith('$') && part.endsWith('$')) {
        display = false;
        latex = part.slice(1, -1);
      } else if (part.startsWith('\\[') && part.endsWith('\\]')) {
        display = true;
        latex = part.slice(2, -2);
      } else if (part.startsWith('\\(') && part.endsWith('\\)')) {
        display = false;
        latex = part.slice(2, -2);
      }

      const trimmedLatex = latex.trim();
      if (isProseMisclassifiedAsMath(trimmedLatex)) {
        segments.push({ type: 'text', content: trimmedLatex });
        return;
      }

      segments.push({
        type: 'math',
        content: trimmedLatex,
        display
      });
    }
  });

  return segments;
}
