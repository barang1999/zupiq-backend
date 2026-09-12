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

// When isProseMisclassifiedAsMath demotes a "$...$" span to plain text, the model
// still sometimes mixed one genuine LaTeX macro into that prose sentence (e.g.
// "$ចន្លោះ [0, +\infty)$" — Khmer prose with a bare \infty inside). The demoted
// segment keeps its content as-is (that's the whole point — it's prose, not math,
// so it must not go through KaTeX), but a raw "\infty" left sitting in a text
// block reads as literal backslash-command text to the user, and can still trip
// normalizeTextBlockContent's separate "\ " backslash-separator repair. Convert
// the handful of macros that commonly leak this way to their plain Unicode form
// before handing the text off, so nothing LaTeX-shaped survives into a text-only
// block.
const READABLE_LATEX_MACROS: Array<[RegExp, string]> = [
  [/\\infty\b/g, "∞"],
  [/\\times\b/g, "×"],
  [/\\div\b/g, "÷"],
  [/\\pm\b/g, "±"],
  [/\\mp\b/g, "∓"],
  // \geq/\leq/\neq must come before their \ge/\le/\ne shorthand siblings even
  // though \b already prevents "\ge" from cross-matching inside "\geq" (the
  // "q" right after keeps it a single word) — listing the longer form first
  // just avoids relying on that subtlety.
  [/\\leq\b/g, "≤"],
  [/\\geq\b/g, "≥"],
  [/\\neq\b/g, "≠"],
  [/\\ge\b/g, "≥"],
  [/\\le\b/g, "≤"],
  [/\\ne\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\equiv\b/g, "≡"],
  [/\\cdot\b/g, "·"],
  [/\\to\b/g, "→"],
  [/\\rightarrow\b/g, "→"],
  [/\\leftarrow\b/g, "←"],
  [/\\Rightarrow\b/g, "⇒"],
  [/\\Leftarrow\b/g, "⇐"],
  [/\\Leftrightarrow\b/g, "⇔"],
  [/\\iff\b/g, "⇔"],
  [/\\implies\b/g, "⇒"],
  [/\\forall\b/g, "∀"],
  [/\\exists\b/g, "∃"],
  [/\\in\b/g, "∈"],
  [/\\notin\b/g, "∉"],
  [/\\subset\b/g, "⊂"],
  [/\\cup\b/g, "∪"],
  [/\\cap\b/g, "∩"],
];

// A handful of comparison-operator macros (\ge, \le, \ne) are common enough
// that the model sometimes drops the leading backslash entirely — writing the
// bare word "ge"/"le"/"ne" instead of "\ge"/"\le"/"\ne" (a real observed
// case: "y' ge 0" instead of "y' \ge 0"). There's no backslash left for
// READABLE_LATEX_MACROS to match, so this only ever runs on content already
// confirmed to be a demoted "$...$" math span (isProseMisclassifiedAsMath's
// branch) — that scoping is what keeps it safe: genuine Khmer prose over
// mathematics essentially never contains the standalone English word "ge",
// "le", or "ne" flanked by spaces on both sides.
const BARE_COMPARISON_SHORTHAND_RE = /(?<=\s)(ge|le|ne)(?=\s)/g;
const BARE_COMPARISON_SHORTHAND_MAP: Record<string, string> = { ge: "≥", le: "≤", ne: "≠" };

function toReadableTextFallback(latex: string): string {
  let text = latex;
  for (const [pattern, replacement] of READABLE_LATEX_MACROS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(BARE_COMPARISON_SHORTHAND_RE, (word) => BARE_COMPARISON_SHORTHAND_MAP[word]);
  return text.replace(/[ \t]+/g, " ").trim();
}

// A model that means "\(...\)" or "\[...\]" LaTeX delimiters sometimes drops
// just the CLOSING backslash — a real, observed generation mistake:
// "\(g(x) = A e^{-2x})" (escaped open, bare close). Left alone, this makes
// the WHOLE span invisible to MATH_TOKEN_REGEX (which requires a properly
// escaped close on both ends), so the raw "\(...)" text leaks verbatim into
// the rendered output with nothing extracted at all — not a rendering
// glitch, a total miss.
//
// Naively loosening MATH_TOKEN_REGEX's closing side to accept a bare ")"/"]"
// was tried and reverted: real math overwhelmingly contains its OWN literal
// parens too (function notation like "g(x)", "f(x)", interval notation like
// "[0, 5]"), so a lenient unescaped close matches the content's own closing
// paren/bracket and truncates the span way too early — breaking the much
// more common case to fix a rarer one.
//
// The safe fix instead: track paren/bracket depth starting right after an
// unclosed "\(" (or "\[") — the content's own internal parens/brackets are
// always balanced (each open has a close within the span), so the
// delimiter's TRUE end is the first close that's unmatched relative to the
// opens seen since the escaped opener (depth would go negative). Insert the
// missing backslash there, before segmentation ever runs, rather than
// guessing at the regex layer.
const DANGLING_DELIMITER_SCAN_LIMIT = 400;

function repairDanglingEscapedDelimiter(content: string, openToken: string, closeToken: string, openChar: string, closeChar: string): string {
  let result = content;
  let searchFrom = 0;

  while (true) {
    const openIndex = result.indexOf(openToken, searchFrom);
    if (openIndex === -1) break;

    const nextOpenIndex = result.indexOf(openToken, openIndex + openToken.length);
    const properCloseIndex = result.indexOf(closeToken, openIndex + openToken.length);
    // Already well-formed (a proper escaped close exists before the next
    // opener, or there's no other opener to worry about) — nothing to fix.
    if (properCloseIndex !== -1 && (nextOpenIndex === -1 || properCloseIndex < nextOpenIndex)) {
      searchFrom = properCloseIndex + closeToken.length;
      continue;
    }

    const scanEnd = Math.min(result.length, openIndex + openToken.length + DANGLING_DELIMITER_SCAN_LIMIT);
    let depth = 0;
    let repaired = false;
    for (let i = openIndex + openToken.length; i < scanEnd; i++) {
      const ch = result[i];
      if (ch === openChar) {
        depth += 1;
      } else if (ch === closeChar) {
        if (depth === 0) {
          result = `${result.slice(0, i)}\\${result.slice(i)}`;
          searchFrom = i + 2; // past the inserted backslash and the close char
          repaired = true;
          break;
        }
        depth -= 1;
      }
    }

    if (!repaired) {
      // No unambiguous close found within the scan window — leave this
      // occurrence untouched rather than guessing wrong, and advance past
      // it so the loop doesn't spin on the same unresolved opener forever.
      searchFrom = openIndex + openToken.length;
    }
  }

  return result;
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
  repairedContent = repairDanglingEscapedDelimiter(repairedContent, '\\(', '\\)', '(', ')');
  repairedContent = repairDanglingEscapedDelimiter(repairedContent, '\\[', '\\]', '[', ']');
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
        segments.push({ type: 'text', content: toReadableTextFallback(trimmedLatex) });
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
