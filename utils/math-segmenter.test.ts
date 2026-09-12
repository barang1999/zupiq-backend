// Permanent regression suite for zupiq-backend/utils/math-segmenter.ts's
// isProseMisclassifiedAsMath downgrade path — a "$...$" span that turns out
// to be Khmer prose (not real math) is demoted to a plain text segment, but
// must not leak any LaTeX macro it happened to be mixed with as raw
// backslash-command syntax.
import { describe, expect, it } from "vitest";
import { segmentMathContent } from "./math-segmenter.js";

describe("isProseMisclassifiedAsMath downgrade — readable text fallback", () => {
  it("converts a bare \\infty inside a demoted prose span to the ∞ glyph instead of leaking raw LaTeX", () => {
    // Real observed case: the model wrapped an entire Khmer sentence (with one
    // genuine LaTeX macro mixed in) in a single "$...$" pair. Khmer prose
    // outside \text{} demotes the whole span to plain text — correct, since
    // KaTeX can't typeset Khmer glyphs — but the embedded "\infty" must not
    // survive as literal backslash-command text in that text segment.
    const content = "$រកតម្លៃ m ដើម្បីឱ្យអនុគមន៍កើនលើចន្លោះ [0, +\\infty)$";
    const segments = segmentMathContent(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("text");
    expect(segments[0].content).toContain("∞");
    expect(segments[0].content).not.toContain("\\infty");
    expect(segments[0].content).not.toContain("$");
  });

  it("converts other common macros (\\times, \\leq, \\to) the same way", () => {
    const segments = segmentMathContent("$កំណត់ x \\times y \\leq 10 \\to ចម្លើយ$");
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toBe("កំណត់ x × y ≤ 10 → ចម្លើយ");
  });

  it("leaves a genuine math span (no Khmer outside \\text{}) alone", () => {
    const segments = segmentMathContent("$x + \\infty = \\infty$");
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("math");
    expect(segments[0].content).toBe("x + \\infty = \\infty");
  });

  it("still allows Khmer confined to \\text{...} to count as genuine math", () => {
    const segments = segmentMathContent("$v = 12\\ \\text{ម/s}$");
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("math");
  });

  it("converts \\ge/\\le/\\ne shorthand (not just the \\geq/\\leq/\\neq long form) inside a demoted span", () => {
    const segments = segmentMathContent("$កំណត់ x \\ge 0 និង y \\le 10 និង z \\ne 5 ចម្លើយ$");
    expect(segments[0].content).toBe("កំណត់ x ≥ 0 និង y ≤ 10 និង z ≠ 5 ចម្លើយ");
  });

  it("repairs a bare 'ge'/'le'/'ne' word (missing backslash entirely) inside a demoted span", () => {
    // Real observed case: "$... y' ge 0 លើចន្លោះ [0, +\\infty)$" — the model
    // wrote the shorthand comparison operator without its leading backslash
    // at all, so there's no "\ge" for READABLE_LATEX_MACROS to match; only
    // reachable from inside the already-confirmed-prose branch, so it's safe
    // to treat a bare, space-flanked "ge"/"le"/"ne" as the corrupted operator.
    const content = "$គណនាដេរីវេ y' រួចកំណត់លក្ខខណ្ឌឱ្យ y' ge 0 លើចន្លោះ [0, +\\infty)$";
    const segments = segmentMathContent(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].content).toContain("y' ≥ 0");
    expect(segments[0].content).toContain("∞");
    expect(segments[0].content).not.toMatch(/\bge\b/);
  });
});

describe("repairDanglingEscapedDelimiter — mismatched \\(...\\)/\\[...\\] pairs", () => {
  // Real observed case: a model meaning "\(...\)" LaTeX delimiters drops
  // just the CLOSING backslash — "\(g(x) = A e^{-2x})" (escaped open, bare
  // close). Left alone, MATH_TOKEN_REGEX requires both ends escaped, so the
  // whole span was invisible to it and leaked verbatim as plain text with
  // nothing extracted — a tree-leaf "description" field showing the raw
  // "\(...)" characters to the user instead of rendered math.
  it("recovers math from an escaped-open/bare-close mismatch, even with function-notation parens inside", () => {
    const segments = segmentMathContent("ជំនួស \\(g(x) = A e^{-2x}) ដែលទើបរកឃើញ");
    expect(segments).toEqual([
      { type: "text", content: "ជំនួស " },
      { type: "math", content: "g(x) = A e^{-2x}", display: false },
      { type: "text", content: " ដែលទើបរកឃើញ" },
    ]);
  });

  it("does the same for a \\[...] display-math mismatch", () => {
    const segments = segmentMathContent("សមីការ \\[x^2 + 1 = 0] ត្រូវដោះស្រាយ");
    expect(segments).toEqual([
      { type: "text", content: "សមីការ " },
      { type: "math", content: "x^2 + 1 = 0", display: true },
      { type: "text", content: " ត្រូវដោះស្រាយ" },
    ]);
  });

  it("resolves against the delimiter's own true close even with nested parens inside (paren-depth tracking)", () => {
    const segments = segmentMathContent("តម្លៃ \\(h(g(x)) = A e^{-2x}) ដែលទើបរកឃើញ");
    expect(segments[1]).toEqual({ type: "math", content: "h(g(x)) = A e^{-2x}", display: false });
  });

  it("leaves a fully well-formed pair untouched (no double-repair)", () => {
    const segments = segmentMathContent("ជំនួស \\(g(x) = A e^{-2x}\\) ដែលទើបរកឃើញ");
    expect(segments[1]).toEqual({ type: "math", content: "g(x) = A e^{-2x}", display: false });
  });

  it("does not touch two independent, genuinely well-formed spans in the same string", () => {
    const segments = segmentMathContent("លីមីត \\(f(x)\\) និង \\(g(x)\\) ត្រូវគណនា");
    expect(segments.filter((s) => s.type === "math").map((s) => s.content)).toEqual(["f(x)", "g(x)"]);
  });

  it("never mistakes an ordinary, fully-unescaped parenthetical remark for math", () => {
    const segments = segmentMathContent("តម្លៃនេះត្រូវបានប្រហែល (សម្រាប់ភាពងាយស្រួល) មិនមែនជាតម្លៃពិតប្រាកដ");
    expect(segments.every((s) => s.type === "text")).toBe(true);
  });
});
