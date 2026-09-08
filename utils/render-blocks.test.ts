// Permanent regression suite for zupiq-backend/utils/render-blocks.ts's
// control-character repair in normalizeLatexForRender (exercised here via
// the exported buildMathBlock, its only entry point).
import { describe, expect, it } from "vitest";
import { buildMathBlock } from "./render-blocks.js";

describe("control-character repair (JSON-deserialization artifacts)", () => {
  it("does not invent a bogus command out of an ordinary newline before a new aligned-block line", () => {
    // Real observed case: a "\begin{aligned} a &= ... \\\\ b &= ... \end{aligned}"
    // block, with an entirely ordinary newline right before "b &= ..." (just
    // formatting — LaTeX treats a bare newline as a space). The old, broader
    // repair ("any control char + any letters -> \control+letters") matched
    // this exactly the same way it matches genuine corruption, inventing a
    // nonsensical "\nb" command that rendered visibly in red (KaTeX's
    // undefined-command styling) right before the "b = ..." line.
    const latex = "\\begin{aligned} a &= \\lim_{x \\to -\\infty} \\frac{y}{x} \\\\\nb &= \\lim_{x \\to -\\infty} (y - ax) \\end{aligned}";
    const result = buildMathBlock(latex, true);
    expect(result.normalizedLatex).not.toContain("\\nb");
    // The function's own final whitespace-collapse turns the (correctly
    // preserved, un-mangled) newline into a plain space — expected and
    // fine, since LaTeX treats a bare newline as a space anyway.
    expect(result.normalizedLatex).toContain("\\\\ b &=");
  });

  it("still repairs a genuine \\tan corrupted by the control-character misread", () => {
    // The control char sits mid-string, not at the very start/end — a
    // leading/trailing one gets trimmed away by stripMathDelimiters before
    // the repair even runs (a separate, pre-existing edge case, not this
    // fix's concern).
    const TAB = String.fromCharCode(9);
    const result = buildMathBlock(`f(x) = ${TAB}an(x)`, false);
    expect(result.normalizedLatex).toBe("f(x) = \\tan(x)");
  });

  it("still repairs a genuine \\text corrupted by the control-character misread", () => {
    const TAB = String.fromCharCode(9);
    const result = buildMathBlock(`y = ${TAB}ext{ដាមួយ}`, false);
    expect(result.normalizedLatex).toContain("\\text{");
  });

  it("still repairs a genuine \\forall and \\tan corrupted together (the earlier real observed case)", () => {
    const TAB = String.fromCharCode(9);
    const FF = String.fromCharCode(12);
    const latex = `y = ${FF}orall x, ${TAB}an, ${TAB}ext{etc.}`;
    const result = buildMathBlock(latex, true);
    expect(result.normalizedLatex).toContain("\\forall");
    expect(result.normalizedLatex).toContain("\\tan");
    expect(result.normalizedLatex).toContain("\\text{");
  });

  it("still repairs a genuine \\neq corrupted by the control-character misread", () => {
    const NL = String.fromCharCode(10);
    const result = buildMathBlock(`x ${NL}eq y`, false);
    expect(result.normalizedLatex).toBe("x \\neq y");
  });

  it("still repairs a genuine \\begin corrupted by the control-character misread", () => {
    const BS = String.fromCharCode(8);
    const result = buildMathBlock(`y = 1 ${BS}egin{aligned} a &= 1 \\end{aligned}`, true);
    expect(result.normalizedLatex).toContain("\\begin{aligned}");
  });

  it("does not mangle an ordinary newline before a short, unrelated single-letter variable", () => {
    // "y" is not the start of any recognized command suffix (nor is "x",
    // "a", "c", ...) — this pins down that the fix isn't narrowly special-
    // cased to "b" alone. The function's own final whitespace-collapse step
    // turns the surviving newline into a plain space (correct — LaTeX
    // treats a bare newline as a space anyway); what matters is that no
    // bogus "\ny" command gets invented from it.
    const NL = String.fromCharCode(10);
    const result = buildMathBlock(`x = 1${NL}y = 2`, true);
    expect(result.normalizedLatex).not.toContain("\\ny");
    expect(result.normalizedLatex).toBe("x = 1 y = 2");
  });
});
