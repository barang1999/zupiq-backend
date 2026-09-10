// Permanent regression suite for zupiq-backend/utils/render-blocks.ts's
// control-character repair in normalizeLatexForRender (exercised here via
// the exported buildMathBlock, its only entry point).
import { describe, expect, it } from "vitest";
import { buildMathBlock, buildRenderBlocks } from "./render-blocks.js";

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

describe("normalizeTextBlockContent's '\\ ' separator repair does not eat LaTeX macros", () => {
  it("does not turn a leaked \\infty inside a text block into a newline + \"infty\"", () => {
    // Real observed case: a "$...$" span that's mostly Khmer prose gets
    // demoted to plain text by segmentMathContent (isProseMisclassifiedAsMath),
    // and that demotion converts the one genuine macro it was mixed with
    // (\infty) to its Unicode glyph (∞) before this text ever reaches
    // normalizeTextBlockContent. This pins down the second, independent half
    // of that fix: even if a raw "\infty" reached this function some other
    // way, the "\ " thin-space-separator repair below must not mistake the
    // macro's own backslash for a bare separator and eat it — that bug
    // corrupted "[0, +\infty)" into "[0, +\ninfty)" (a literal newline
    // spliced into the middle of the word "infty").
    const blocks = buildRenderBlocks("ចន្លោះ [0, +\\infty) ជាចន្លោះកើន");
    const text = blocks.map((b) => (b.type === "text" ? b.content : "")).join("");
    expect(text).not.toContain("\ninfty");
    expect(text).toContain("\\infty");
  });

  it("still converts a genuine bare '\\ ' separator between two flattened segments into a line break", () => {
    const blocks = buildRenderBlocks("ដំណាក់កាលទី១ \\ ដំណាក់កាលទី២");
    const text = blocks.map((b) => (b.type === "text" ? b.content : "")).join("");
    expect(text).toBe("ដំណាក់កាលទី១\nដំណាក់កាលទី២");
  });
});
