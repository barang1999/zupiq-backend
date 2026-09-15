// Permanent regression suite for zupiq-backend/utils/mathjax-svg.ts.
import { describe, expect, it } from "vitest";
import { renderMathSvg } from "./mathjax-svg.js";

describe("\\AA / \\aa (Angstrom-ring letters) unsupported by MathJax's TeX input", () => {
  // Real observed case: a DNA-length physics problem states its answer as
  // "L = 7845.5 \text{ \AA}" (the Angstrom unit, common in molecular
  // biology/physics for base-pair spacing). "\AA" is a standard LaTeX
  // kernel command in real LaTeX (produces "Å"), but MathJax's TeX input
  // package doesn't implement it — and unlike most unsupported commands,
  // this doesn't throw (nothing for renderMathSvg's own retry path to
  // catch): it silently renders as literal text in MathJax's own
  // "unrecognized command" red error styling — three separate glyphs for
  // "\", "A", "A" — which reads to a student as a raw LaTeX leak, not a
  // thrown/caught failure.
  it("renders '\\text{ \\AA}' as the Angstrom character, not literal red error glyphs for '\\', 'A', 'A'", () => {
    const svg = renderMathSvg("7845.5 \\text{ \\AA}", true);
    expect(svg).not.toBeNull();
    expect(svg).not.toContain('fill="red"');
    // data-c="5C" is the glyph path for a literal backslash character —
    // its presence means "\AA" leaked through as raw text instead of
    // being converted to the Angstrom letter.
    expect(svg).not.toContain('data-c="5C"');
  });

  it("produces the exact same SVG as writing the literal Angstrom character directly", () => {
    const withCommand = renderMathSvg("7845.5 \\text{ \\AA}", true);
    const withLiteral = renderMathSvg("7845.5 \\text{ Å}", true);
    expect(withCommand).toBe(withLiteral);
  });

  it("also handles the lowercase form (\\aa -> å)", () => {
    const withCommand = renderMathSvg("\\aa", false);
    const withLiteral = renderMathSvg("å", false);
    expect(withCommand).toBe(withLiteral);
  });

  it("does not corrupt an unrelated word that merely starts with 'aa' (word-boundary guarded)", () => {
    // \AA must only match the bare command, not a longer command name that
    // happens to start with the same letters (there are none in standard
    // LaTeX, but the \b word-boundary guard is what would prevent a false
    // match if one existed) — sanity-check it doesn't mangle a normal
    // variable named literally "AA" without a leading backslash.
    const svg = renderMathSvg("AA", false);
    expect(svg).not.toBeNull();
    expect(svg).not.toContain('fill="red"');
  });
});
