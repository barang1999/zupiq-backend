// Permanent regression suite for the diagram-vs-solution verification pass
// in gemini.service.ts. This is the one check that catches a diagram
// plotting the *wrong function entirely* (correctly parsed, correctly
// rendered, just not what the problem is about) — something
// diagram-blocks.ts's own normalization can never catch, since it only
// checks a function's params/points against its own latex, never against
// the solution. See DIAGRAM_STRUCTURE_JSON_GUIDE.md's "Wrong Function
// Selected" section for the full story.
import { describe, expect, it, vi } from "vitest";
import { checkConstantSolvingFinalAnswer, checkExtremaValueClaims, checkSolutionCompleteness, extractAnchorClaims, extractLineEquationClaims, inferConstructedFunctionGraphForExplicitGraphRequest, inferInequalityFeasibleRegionBlocks, repairNestedDollarsInsideAligned, verifyDiagramBlocksAgainstSolution } from "./gemini.service.js";
import { normalizeDiagramBlocks } from "../../utils/diagram-blocks.js";
import { logger } from "../../utils/logger.js";

describe("extractAnchorClaims", () => {
  it("extracts f(x)=y and f(x)~=y anchors from solution prose", () => {
    expect(extractAnchorClaims("f(0) = -2 and later f(1) \\approx 0.19, done.")).toEqual([
      { x: 0, y: -2 },
      { x: 1, y: 0.19 },
    ]);
  });

  it("returns nothing when there are no anchors", () => {
    expect(extractAnchorClaims("The answer is 42.")).toEqual([]);
  });

  it("restricts to the given function name, ignoring a claim about a different one", () => {
    const text = "f(0) = 0\n---\ng(0) = 4";
    expect(extractAnchorClaims(text, "g")).toEqual([{ x: 0, y: 4 }]);
    expect(extractAnchorClaims(text, "f")).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("verifyDiagramBlocksAgainstSolution", () => {
  function functionGraphBlock(kind: string, latex: string, params: Record<string, number>) {
    return normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-10, 10], domain: [-2, 2],
        functions: [{ kind, latex, params, points: [] }],
        featurePoints: [],
      },
    }]);
  }

  it("drops a diagram whose plotted function disagrees with a majority of the solution's own anchors", () => {
    // Real observed shape: a fabricated y=x^3 while the true function
    // (from an L'Hôpital limit problem) gives completely different values.
    const blocks = functionGraphBlock("cubic", "y=x^3", { a: 1, b: 0, c: 0, d: 0 });
    expect(blocks.length).toBe(1);
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "f(0) = 0, f(1) = -3, f(-1) = 3.");
    expect(verified.length).toBe(0);
  });

  it("keeps a diagram whose plotted function agrees with the solution's anchors", () => {
    const blocks = functionGraphBlock("quadratic", "y=x^2", { a: 1, b: 0, c: 0 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "f(0) = 0, f(2) = 4.");
    expect(verified.length).toBe(1);
  });

  it("keeps a diagram when there is nothing to check (no anchors in the solution text)", () => {
    const blocks = functionGraphBlock("cubic", "y=x^3", { a: 1, b: 0, c: 0, d: 0 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "The answer is 42.");
    expect(verified.length).toBe(1);
  });

  it("is conservative: a single mismatch out of two anchors is not enough to drop", () => {
    const blocks = functionGraphBlock("quadratic", "y=x^2", { a: 1, b: 0, c: 0 });
    // f(0)=0 matches (0^2=0); f(2)=100 does not (2^2=4) — 1 of 2, not a majority.
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "f(0) = 0, f(2) = 100.");
    expect(verified.length).toBe(1);
  });

  it("drops when a strict majority of anchors mismatch", () => {
    const blocks = functionGraphBlock("quadratic", "y=x^2", { a: 1, b: 0, c: 0 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "f(0) = 99, f(2) = 100.");
    expect(verified.length).toBe(0);
  });

  it("leaves non-function-graph diagrams untouched", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "sign-table",
      spec: { type: "sign-table", rows: [{ label: "x", cells: ["-∞", "", "0", "", "+∞"] }, { label: "f'(x)", cells: ["", "-", "0", "+", ""] }] },
    }]);
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, "f(0) = 0, f(1) = -3, f(-1) = 3.");
    expect(verified.length).toBe(blocks.length);
  });

  // Real observed case: an oblique-asymptote problem for y=sqrt(4x^2+x+5)
  // derives y=2x+1/4 (x->+inf) and y=-2x-1/4 (x->-inf), stated plainly in
  // both solutionText and finalAnswer — but the diagram plotted y=2x and
  // y=-2x, missing the +-1/4 intercept entirely. Nothing else in the
  // pipeline catches this: diagram-blocks.ts's own spot-check only verifies
  // a function's params against *its own* claimed latex ("y=2x" matches
  // params {m:2,b:0} perfectly), so the mismatch is only visible against
  // the solution's own derived line equation.
  const asymptoteSolutionText = "រកអាស៊ីមតូតទ្រេតនៃអនុគមន៍ $y = \\sqrt{4x^2 + x + 5}$។ "
    + "នាំឱ្យសមីការអាស៊ីមតូតទ្រេតខាង $+\\infty$ គឺ $y = 2x + \\frac{1}{4}$។ "
    + "នាំឱ្យសមីការអាស៊ីមតូតទ្រេតខាង $-\\infty$ គឺ $y = -2x - \\frac{1}{4}$។";
  const asymptoteFinalAnswer = "$y = 2x + \\frac{1}{4}$ ខាង $+\\infty$ និង $y = -2x - \\frac{1}{4}$ ខាង $-\\infty$";

  function asymptoteDiagramBlock(params1: Record<string, number>, params2: Record<string, number>) {
    return normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-9, 9], domain: [-4, 4],
        functions: [
          { kind: "linear", color: "primary", latex: `y=${params1.m}x`, params: params1, points: [] },
          { kind: "linear", color: "red", latex: `y=${params2.m}x`, params: params2, points: [] },
        ],
        featurePoints: [],
      },
    }]);
  }

  it("drops a diagram whose plotted asymptote lines are missing the intercept the solution derived", () => {
    const blocks = asymptoteDiagramBlock({ m: 2, b: 0 }, { m: -2, b: 0 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, asymptoteSolutionText, asymptoteFinalAnswer);
    expect(verified.length).toBe(0);
  });

  it("keeps a diagram whose plotted asymptote lines match the solution's derived equations", () => {
    const blocks = asymptoteDiagramBlock({ m: 2, b: 0.25 }, { m: -2, b: -0.25 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, asymptoteSolutionText, asymptoteFinalAnswer);
    expect(verified.length).toBe(1);
  });

  it("does not misfire when finalAnswer is omitted but solutionText alone has the line claims", () => {
    const blocks = asymptoteDiagramBlock({ m: 2, b: 0 }, { m: -2, b: 0 });
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, asymptoteSolutionText);
    expect(verified.length).toBe(0);
  });

  // Real observed case: a two-part problem defines "f(x)=(1-x)e^x-1" and
  // "g(x)=(2-x)e^x+2-x" in the same solution. A diagram *correctly* plots
  // g (named "g(x)=..." in its own latex, per findConcreteFunctionLatex
  // preserving the matched name) — but the solution also states "f(0)=0"
  // (true for f, not g), and the old anchor extraction pooled every
  // "f(...)=..." claim in the text regardless of which function it was
  // about, comparing "f(0)=0" against g(0)=4 and wrongly dropping an
  // otherwise-correct diagram.
  it("does not drop a correctly-plotted named function because of an anchor that's actually about a different function in the same solution", () => {
    const blocks = functionGraphBlock("points", "g(x)=(2 - x)e^x + 2 - x", {});
    const solutionText = "f(0) = (1 - 0)e^0 - 1 = 0\n---\ng(0) = (2 - 0)e^0 + 2 - 0 = 4";
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, solutionText);
    expect(verified.length).toBe(1);
  });

  it("still drops a named function's diagram when it disagrees with that SAME function's own anchor", () => {
    const blocks = functionGraphBlock("points", "g(x)=(2 - x)e^x + 2 - x", {});
    // g(0) is actually 4, not 999 — a genuine mismatch on g itself.
    const solutionText = "f(0) = (1 - 0)e^0 - 1 = 0\n---\ng(0) = 999";
    const verified = verifyDiagramBlocksAgainstSolution(blocks as any, solutionText);
    expect(verified.length).toBe(0);
  });
});

describe("extractLineEquationClaims", () => {
  it("extracts y=mx+b claims, evaluating \\frac constants via the general expression engine", () => {
    expect(extractLineEquationClaims("$y = 2x + \\frac{1}{4}$ and $y = -2x - \\frac{1}{4}$")).toEqual([
      { m: 2, b: 0.25 },
      { m: -2, b: -0.25 },
    ]);
  });

  it("does not mistake the function's own (non-linear) equation for a line claim", () => {
    // y=sqrt(4x^2+x+5) is asymptotically almost indistinguishable from a
    // straight line for large x — the syntactic pre-filter (rejecting any
    // "y=..." containing \sqrt, an exponent, or a trig/log command) is what
    // actually excludes it, not the numeric linearity check alone.
    expect(extractLineEquationClaims("$y = \\sqrt{4x^2 + x + 5}$")).toEqual([]);
  });

  it("does not mistake a quadratic for a line claim", () => {
    expect(extractLineEquationClaims("$y = x^2 + 3x + 1$")).toEqual([]);
  });

  it("returns nothing when there is no y=... pattern at all", () => {
    expect(extractLineEquationClaims("The answer is 42.")).toEqual([]);
  });
});

describe("checkConstantSolvingFinalAnswer", () => {
  // Real observed failure: every algebraic step in the solution looked
  // right except one flipped cross-multiplication, landing on a=5/2 when
  // substituting a=5/8 back into the original limit is what actually makes
  // it equal the stated target of 1/8.
  const problem = "$$\\lim_{x \\to 0} \\frac{1+ax-\\sqrt{1+x}}{x} = \\frac{1}{8}$$";

  it("flags a final answer that does not satisfy the problem's own equation", () => {
    const result = checkConstantSolvingFinalAnswer(problem, "$a = \\frac{5}{2}$");
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.estimate).toBeCloseTo(2, 1);
      expect(result.target).toBeCloseTo(0.125, 5);
    }
  });

  it("passes a final answer that does satisfy the problem's own equation", () => {
    const result = checkConstantSolvingFinalAnswer(problem, "$a = \\frac{5}{8}$");
    expect(result.ok).toBe(true);
  });

  it("works with a different constant name and a plain (non-fraction) target", () => {
    const sinProblem = "$$\\lim_{x \\to 0} \\frac{\\sin(kx)}{x} = 3$$";
    expect(checkConstantSolvingFinalAnswer(sinProblem, "$k = 3$").ok).toBe(true);
    expect(checkConstantSolvingFinalAnswer(sinProblem, "$k = 5$").ok).toBe(false);
  });

  it("handles a one-sided limit point (0^+)", () => {
    const onesided = "$$\\lim_{x \\to 0^+} \\frac{1+ax-\\sqrt{1+x}}{x} = \\frac{1}{8}$$";
    expect(checkConstantSolvingFinalAnswer(onesided, "$a = \\frac{5}{2}$").ok).toBe(false);
    expect(checkConstantSolvingFinalAnswer(onesided, "$a = \\frac{5}{8}$").ok).toBe(true);
  });

  it("does not fire when the claimed variable isn't even in the equation", () => {
    // "n" doesn't appear anywhere in the limit expression — nothing to check.
    expect(checkConstantSolvingFinalAnswer(problem, "$n = 7$").ok).toBe(true);
  });

  it("does not fire on a problem with no limit-equation shape", () => {
    expect(checkConstantSolvingFinalAnswer("solve x^2=4", "$x = 2$").ok).toBe(true);
  });

  it("never throws on empty or garbage input", () => {
    expect(() => checkConstantSolvingFinalAnswer("", "")).not.toThrow();
    expect(() => checkConstantSolvingFinalAnswer("random text no math", "no equation here either")).not.toThrow();
    expect(checkConstantSolvingFinalAnswer("", "").ok).toBe(true);
  });
});

describe("checkSolutionCompleteness", () => {
  // Real observed case #1: solutionText ends mid-Khmer-word right after
  // computing F(0), never reaches F(2/3); finalAnswer self-reports failure.
  it("flags a self-reported incomplete final answer", () => {
    const result = checkSolutionCompleteness(
      "យើងគណនាតម្លៃ $F(x)$ នៅចំណ",
      "N/A (ដំណោះស្រាយមិនពេញលេញ)",
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("final-answer-self-reported-na");
  });

  // Real observed case #2: same problem, regenerated — this time
  // solutionText cuts off literally mid-command ("...\left(") and
  // finalAnswer is empty outright.
  it("flags an empty final answer with solution text truncated mid-LaTeX-command", () => {
    const result = checkSolutionCompleteness(
      "F\\left(\\frac{2}{3}\\right) = \\frac{a}{3}\\left(",
      "",
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("empty-final-answer");
  });

  it("flags unbalanced \\left/\\right even when finalAnswer is present", () => {
    // Same truncated solutionText as case #2, but suppose finalAnswer had
    // stale/leftover content from an earlier attempt — the truncation
    // itself should still be caught via the solutionText check.
    const result = checkSolutionCompleteness(
      "F\\left(\\frac{2}{3}\\right) = \\frac{a}{3}\\left(",
      "$a = 5$",
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("unbalanced-left-right");
  });

  it("flags unbalanced braces", () => {
    const result = checkSolutionCompleteness("$$F(x) = \\frac{ax^3}{3", "$x = 1$");
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("unbalanced-braces");
  });

  it("flags an odd number of $$ display-math markers", () => {
    const result = checkSolutionCompleteness("$$a = 5", "$a = 5$");
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("unbalanced-display-math");
  });

  it("passes a genuinely complete solution ending in a display-math block with no trailing punctuation", () => {
    // This exact shape (ending on "$$ a = 5/8 $$" with nothing after) is
    // the normal, correct ending for most solutions in this dataset — must
    // not be flagged just for lacking a closing sentence.
    const result = checkSolutionCompleteness(
      "\\lim_{x \\to 0} \\frac{2a-1}{2} = \\frac{1}{8}\n$$ a = \\frac{5}{8} $$",
      "$a = \\frac{5}{8}$",
    );
    expect(result.ok).toBe(true);
  });

  it("never throws on empty or garbage input", () => {
    expect(() => checkSolutionCompleteness("", "")).not.toThrow();
    expect(checkSolutionCompleteness("", "").ok).toBe(false);
  });
});

describe("inferInequalityFeasibleRegionBlocks", () => {
  it("does not fabricate a feasible-region polygon for a single-function variation problem", () => {
    // Real observed bug: a rational-function variation problem's last sub-question asks
    // "find a such that x + 1/x > a for all x > 0". The bare Khmer word for "inequality"
    // (វិសមភាព), used here only to describe that single-variable inequality, tripped the
    // feasible-region keyword gate, and the extrema/points scraped out of the solution's own
    // text ((-1,-2), (1,2), plus stray table values) got connected into a bogus quadrilateral
    // with nothing to do with the actual curve y = x + 1/x — see
    // DIAGRAM_STRUCTURE_JSON_GUIDE.md and the studied case for the full story.
    const problem = "គេឱ្យអនុគមន៍ y = x + 1/x។ កំណត់តម្លៃ a ដើម្បីឱ្យ x + 1/x > a ចំពោះគ្រប់ x > 0។";
    const solutionText = [
      "អតិបរមាធៀបត្រង់ (-1,-2), អប្បបរមាធៀបត្រង់ (1,2)។",
      "យើងមានវិសមភាព x + 1/x > a ចំពោះគ្រប់ x > 0។",
      "តម្លៃអប្បបរមានៃ f(x) គឺ f(1) = 2 ត្រង់ x = 1។",
    ].join("\n");
    const finalAnswer = "a < 2";

    const blocks = inferInequalityFeasibleRegionBlocks(problem, solutionText, [], finalAnswer, "variation");
    expect(blocks).toEqual([]);
  });

  it("still builds a polygon for a genuine system-of-inequalities feasible-region problem", () => {
    const problem = "Solve the system of inequalities and shade the feasible region.";
    const solutionText = "The feasible region is a triangle with vertices A(0,0), B(4,0), C(0,3).";

    const blocks = inferInequalityFeasibleRegionBlocks(problem, solutionText, [], "", undefined);
    expect(blocks.length).toBeGreaterThan(0);
    const block = blocks[0];
    expect(block.type).toBe("diagram");
    if (block.type === "diagram") expect(block.diagramType).toBe("geometry");
  });
});

describe("inferConstructedFunctionGraphForExplicitGraphRequest", () => {
  // Real observed case: "គេឱ្យអនុគមន៍ y = (x²+2(m+1)x+2)/(x+1). ក. ចំពោះ m=0
  // សិក្សាអថេរភាពនិងសង់ក្រាប C..." — "for m=0, study the variation AND
  // CONSTRUCT THE GRAPH C" — an explicit request for a graph. The AI
  // returned only a sign-table, which is a real, non-empty diagram and so
  // passes the generic "useful" filter untouched, silently never answering
  // the "construct the graph" half of the question.
  const problem = "គេឱ្យអនុគមន៍ y = \\frac{x^2 + 2(m+1)x + 2}{x+1} ៖\nក. ចំពោះ m = 0 សិក្សាអថេរភាពនិងសង់ក្រាប C របស់អនុគមន៍ខាងលើ។";
  const solutionText = "ក. ចំពោះ m = 0\nយើងបានអនុគមន៍ y = \\frac{x^2+2x+2}{x+1}\nដែនកំណត់៖ D = R \\ {-1}";
  const signTableBlocks = normalizeDiagramBlocks([{
    diagramType: "sign-table",
    rows: [
      { label: "x", cells: ["-∞", "-2", "-1", "0", "+∞"] },
      { label: "y'", cells: ["+", "0", "-", "||", "-", "0", "+"] },
    ],
  }]);

  it("builds a function-graph from the solution's own concrete latex when only a sign-table was returned for an explicit 'construct the graph' request", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(problem, solutionText, signTableBlocks);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.diagramType).toBe("function-graph");
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(fn.latex).toBe("y=\\frac{x^2+2x+2}{x+1}");
    // Domain should straddle the vertical asymptote at x=-1, not the
    // problem's own general (unresolved-m) form's meaningless "asymptote"
    // wherever evaluation happens to first fail.
    expect(spec.domain).toEqual([-6, 4]);
  });

  it("does not fire when the problem never asks to construct/sketch/draw the graph", () => {
    const noGraphRequestProblem = "គេឱ្យអនុគមន៍ y = \\frac{x^2+2x+2}{x+1}។ រកតម្លៃអប្បបរមា។";
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(noGraphRequestProblem, solutionText, signTableBlocks);
    expect(blocks).toEqual([]);
  });

  it("never overrides a diagram that isn't a sign-table (e.g. the AI already produced a real function-graph)", () => {
    const functionGraphBlocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "linear", params: { m: 1, b: 0 }, latex: "y=x" }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(problem, solutionText, functionGraphBlocks);
    expect(blocks).toEqual([]);
  });

  // Real observed case: "f(x) = (x + 1)(e^{-2x} + 1)" — a non-rational
  // (product-with-exponential) function, with the graph request phrased as
  // "ច. សង់បន្ទាត់ (D), (Δ) និងក្រាប (C)" ("construct the lines (D), (Δ) and
  // the graph (C)") — "សង់" and "ក្រាប" separated by the rest of that object
  // list, not adjacent. Both used to defeat this function entirely: the old
  // "\frac{...}{...}"-only candidate regex never even found this function's
  // latex, and the old adjacent-only "សង់ក្រាប" pattern never recognized the
  // request as asking for a graph in the first place.
  const exponentialProblem = "$f(x) = (x + 1)(e^{-2x} + 1)$ ចំពោះគ្រប់ចំនួនពិត $x$។\nច. សង់បន្ទាត់ $(D)$, $(\\Delta)$ និងក្រាប $(C)$។";
  const exponentialSignTable = normalizeDiagramBlocks([{
    diagramType: "sign-table",
    rows: [
      { label: "x", cells: ["-∞", "0", "+∞"] },
      { label: "f'(x)", cells: ["+", "0", "+"] },
    ],
  }]);

  it("recognizes a graph request even when 'construct' and 'graph' are separated by other object names in the same sentence", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", exponentialSignTable);
    expect(blocks.length).toBe(1);
  });

  it("finds a non-rational function's own latex (a product with an exponential factor, not just \\frac{...}{...}), keeping its own name 'f' rather than rewriting to a bare 'y='", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", exponentialSignTable);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(fn.latex).toBe("f(x)=(x + 1)(e^{-2x} + 1)");
  });

  it("does not mistake an exponential's steep-but-finite growth for a vertical asymptote, and narrows the domain to where the curve stays readable", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", exponentialSignTable);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const [domainMin, domainMax] = spec.domain as [number, number];
    // The old magnitude-based heuristic mistook the steep left tail for a
    // pole, centering the domain on [-15,-5] — nowhere near this function's
    // actual features (the tangent point at x=-1/2, the y-intercept at
    // x=0). The fixed domain must stay within the sane default window and
    // must not be centered off in the far-negative tail.
    expect(domainMin).toBeGreaterThanOrEqual(-6);
    expect(domainMax).toBeLessThanOrEqual(6);
    expect(domainMin).toBeLessThan(0);
    expect(domainMax).toBeGreaterThan(0);
  });

  it("keeps the auto-computed y-range tight around the curve's actual interesting behavior, not dragged out by one steep tail", () => {
    // Real observed case: a fixed "|y| < 200" cutoff let a few samples near
    // this function's steep left tail (magnitude in the hundreds, but
    // still under 200) survive, producing range [-208, 43] — legible
    // numbers-wise, but the function's real behavior (the tangent point at
    // x=-1/2, y≈1.86; the intercept at (0,2)) sits entirely within roughly
    // -2 to +8, squeezed into a small sliver of a 251-unit-tall chart.
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", exponentialSignTable);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const [rangeMin, rangeMax] = spec.range as [number, number];
    expect(rangeMax - rangeMin).toBeLessThan(100);
    // And the interesting values must actually fall inside that tighter range.
    expect(rangeMin).toBeLessThanOrEqual(-2);
    expect(rangeMax).toBeGreaterThanOrEqual(8);
  });

  // Real observed case: same function, but diagramBlocks came back
  // completely empty (not even a sign-table) despite the same explicit
  // graph request — a more severe failure mode than downgrading to a
  // sign-table, which the guard above used to treat identically to "the AI
  // already produced a real diagram, leave it alone".
  it("builds a function-graph even when diagramBlocks is completely empty, not just when it's a sign-table", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", []);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.diagramType).toBe("function-graph");
  });

  // Real observed case: a two-part problem defines "f(x) = (1-x)e^x - 1" in
  // part 1, then "g(x) = (2-x)e^x + 2 - x" in part 2 — and the graph request
  // ("ង) សង់ខ្សែតាង (C)") is about g's curve, using "ខ្សែតាង" ("the curve")
  // instead of "ក្រាប" ("graph") for the same concept, plus never once
  // writing "y=" or "f(x)=" for g. The solution goes on to *derive* the
  // oblique asymptote "(D): y = 2 - x" — a trivial line that, being both
  // later in the text and perfectly evaluable, used to win over the actual
  // (non-linear) function g when scanning backward for the last usable
  // candidate.
  const curveWordProblem = "១) $f(x) = (1-x)e^x - 1$។\n២) សិក្សាអនុគមន៍ $g(x) = (2-x)e^x + 2 - x$\nខ) បង្ហាញថា $(D): y = 2 - x$ ជាអាស៊ីមតូតទ្រេតនៃ $(C)$\nង) សង់ខ្សែតាង $(C)$";

  it("recognizes 'ខ្សែតាង' (\"the curve\") as a graph request, not just 'ក្រាប'", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, "", []);
    expect(blocks.length).toBe(1);
  });

  // Real observed case: a THIRD distinct "ខ្សែ..." synonym for "the curve"
  // ("ខ្សែជាង", used as "ខ្សែជាង (C) តាងអនុគមន៍ g" and "សង់ខ្សែជាង (C)") —
  // after ខ្សែតាង and ខ្សែកោង were each individually observed and fixed,
  // this one surfaced with yet another suffix. Pins down that the fix
  // generalizes to "ខ្សែ" + any Khmer continuation, not one more hardcoded
  // literal that the next synonym will just as easily slip past again.
  const khseJangProblem = "1. $f(x) = (1 - x)e^x - 1$ ។\n2. $g(x) = (2 - x)e^x + 2 - x$ ។\n   ខ) បង្ហាញថាខ្សែជាង $(C)$ តាងអនុគមន៍ $g$ មានបន្ទាត់ $(D) : y = 2 - x$ ជាអាស៊ីមតូតទ្រេត។\n   ង) សង់ខ្សែជាង $(C)$ ក្នុងតម្រុយអ័រតូណរម៉ាល់។";
  const khseJangSignTable = normalizeDiagramBlocks([{
    diagramType: "sign-table",
    rows: [{ label: "x", cells: ["-∞", "0", "+∞"] }, { label: "f'(x)", cells: ["+", "0", "-"] }],
  }]);

  it("recognizes 'ខ្សែជាង' as a graph request too — the fix generalizes across 'ខ្សែ...' synonyms, not one literal at a time", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(khseJangProblem, "", khseJangSignTable);
    expect(blocks.length).toBe(1);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(fn.latex).toBe("g(x)=(2 - x)e^x + 2 - x");
  });

  it("finds a function defined as 'g(x)=...', not just 'f(x)=...' or 'y=...', keeping its own name 'g' rather than rewriting to a bare 'y='", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, "", []);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(fn.latex).toBe("g(x)=(2-x)e^x + 2 - x");
  });

  it("prefers the actual (non-linear) function over a trivial asymptote/tangent line derived later in the same text", () => {
    // Pins down the exact bug: without the non-linear preference, scanning
    // backward for the last evaluable "...=...x..." candidate lands on
    // "(D): y = 2 - x" (perfectly evaluable, appears after g's own
    // definition) instead of g(x) itself.
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, "", []);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(fn.latex).not.toBe("y=2 - x");
    expect(fn.latex).not.toBe("y= 2 - x");
  });

  it("keeps g(x)'s auto-computed y-range tight, not dragged out to [-181, 40] by the steep right tail past x≈4", () => {
    // Real observed case (the exact session this pins down): the old fixed
    // "|y| < 200" cutoff let samples out past x=4 (y down to roughly -150)
    // through, producing range [-181, 40] — the rendered chart's visible
    // y-axis window ended up sitting entirely between -60 and -85, showing
    // nothing but a near-vertical plunge with none of g's actual behavior
    // (the inflection point (0,4), the asymptote crossing (2,0)) visible.
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, "", []);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const [rangeMin, rangeMax] = spec.range as [number, number];
    expect(rangeMax - rangeMin).toBeLessThan(100);
    expect(rangeMin).toBeLessThanOrEqual(0);
    expect(rangeMax).toBeGreaterThanOrEqual(4);
  });

  // Real observed case: the curve itself plotted correctly, but the
  // diagram shipped with featurePoints empty and no companion asymptote or
  // tangent line — even though the solution's own "ង. សង់ខ្សែជាង (C)"
  // section explicitly lists them: "(D): y=2-x", the tangent point
  // "(1, e+1)", and the inflection point "I(0, 4)".
  const constructionNotesSolutionText = `
    សមីការបន្ទាត់ប៉ះ $(\\Delta)$ គឺ៖ $y = -x + e + 2$
    ដោយ $g''(x)$ ប្ដូរសញ្ញាត្រង់ $x = 0$ និង $g(0) = 4$ នោះចំណុចរបត់គឺ $I(0, 4)$។
    ង. សង់ខ្សែជាង $(C)$៖
    - បន្ទាត់ $(D) : y = 2-x$ កាត់តាម $(0, 2)$ និង $(2, 0)$។
    - បន្ទាត់ $(\\Delta) : y = -x + e + 2$ ប៉ះ $(C)$ ត្រង់ $(1, e+1)$។
    - ចំណុចរបត់ $I(0, 4)$ មានបន្ទាត់ប៉ះផ្ដេក $y = 4$។
  `;

  it("adds the derived asymptote/tangent lines as their own plotted functions, not just the bare curve", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, constructionNotesSolutionText, []);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const linearFns = (spec.functions as Array<Record<string, unknown>>).filter((f) => f.kind === "linear");
    expect(linearFns.length).toBe(2);
    const paramSets = linearFns.map((f) => f.params as { m: number; b: number });
    expect(paramSets.some((p) => p.m === -1 && p.b === 2)).toBe(true); // (D): y = 2 - x
    expect(paramSets.some((p) => p.m === -1 && Math.abs(p.b - (Math.E + 2)) < 1e-3)).toBe(true); // (Δ): y = -x + e + 2
  });

  it("adds feature points that are independently verified to lie on the curve or a derived line, not just echoed from the prose", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(curveWordProblem, constructionNotesSolutionText, []);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const points = (spec.featurePoints as Array<{ point: [number, number] }>).map((p) => p.point);
    expect(points).toEqual(expect.arrayContaining([
      [0, 4], // inflection point I(0, 4) — on the curve
      [2, 0], // asymptote crossing — on the curve and on (D)
    ]));
    // The tangent point (1, e+1): on the curve, y ≈ 3.718.
    expect(points.some(([x, y]) => x === 1 && Math.abs(y - (Math.E + 1)) < 0.01)).toBe(true);
  });

  it("does not fabricate a feature point from interval/domain notation (e.g. '(0, +\\infty)') since \\infty doesn't evaluate", () => {
    const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(
      curveWordProblem,
      `${constructionNotesSolutionText}\nសម្រាប់ $x \\in (0, +\\infty)$`,
      [],
    );
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const points = (spec.featurePoints as Array<{ point: [number, number] }>).map((p) => p.point);
    expect(points.some(([x]) => x === 0 && points.some(([, y]) => !Number.isFinite(y)))).toBe(false);
    expect(points.every(([, y]) => Number.isFinite(y))).toBe(true);
  });

  describe("backstop failures/successes are logged, not silently returned as []", () => {
    it("logs a warning when the problem asks for a graph but no concrete function latex can be found at all", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const noFunctionProblem = "ច. សង់បន្ទាត់ $(D)$ និងក្រាប $(C)$។"; // asks for a graph, defines no function anywhere
      const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(noFunctionProblem, "", []);
      expect(blocks).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[diagram:backstop-failed] no-concrete-function-latex-found"),
        expect.anything(),
      );
      warnSpy.mockRestore();
    });

    it("logs an info line when the backstop successfully synthesizes a diagram", () => {
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
      const blocks = inferConstructedFunctionGraphForExplicitGraphRequest(exponentialProblem, "", []);
      expect(blocks.length).toBe(1);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("[diagram:backstop-succeeded]"),
        expect.objectContaining({ functionLatex: expect.any(String) }),
      );
      infoSpy.mockRestore();
    });

    it("does not log anything at all for the overwhelming majority of problems that never ask for a graph", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
      const blocks = inferConstructedFunctionGraphForExplicitGraphRequest("រកតម្លៃ x ។", "", []);
      expect(blocks).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });
});

describe("checkExtremaValueClaims", () => {
  // Real observed case: for y=(x²+2x+2)/(x+1), the solution correctly
  // finds critical points at x=-2 and x=0 (y'=0 there), then states
  // "y(-2) = -3" — but f(-2) = ((-2)²+2(-2)+2)/(-2+1) = 2/-1 = -2, not -3.
  // The wrong value then propagates into the variation table and the
  // graph description's claimed vertex.
  const problem = "គេឱ្យអនុគមន៍ y = \\frac{x^2 + 2(m+1)x + 2}{x+1}";

  it("catches a claimed function value that doesn't match the function's own latex", () => {
    const solutionText = "យើងបានអនុគមន៍ y = \\frac{x^2+2x+2}{x+1}\nត្រង់ x=-2 ⟹ y(-2)=-3 (អតិបរមាធៀប)\nត្រង់ x=0 ⟹ y(0)=2 (អប្បបរមាធៀប)";
    const result = checkExtremaValueClaims(problem, solutionText);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.x).toBe(-2);
      expect(result.claimedY).toBe(-3);
      expect(result.actualY).toBeCloseTo(-2, 5);
    }
  });

  it("passes when every claimed value actually matches (both y(-2)=-2 and y(0)=2 correct)", () => {
    const solutionText = "យើងបានអនុគមន៍ y = \\frac{x^2+2x+2}{x+1}\nត្រង់ x=-2 ⟹ y(-2)=-2 (អតិបរមាធៀប)\nត្រង់ x=0 ⟹ y(0)=2 (អប្បបរមាធៀប)";
    expect(checkExtremaValueClaims(problem, solutionText).ok).toBe(true);
  });

  it("passes (nothing to check) when no concrete function latex can be found in the text at all", () => {
    const solutionText = "ត្រង់ x=-2 ⟹ y(-2)=-3 (អតិបរមាធៀប)";
    expect(checkExtremaValueClaims(problem, solutionText).ok).toBe(true);
  });

  it("never throws on empty or garbage input", () => {
    expect(() => checkExtremaValueClaims("", "")).not.toThrow();
    expect(checkExtremaValueClaims("", "").ok).toBe(true);
    expect(() => checkExtremaValueClaims("random text", "no function or claims here")).not.toThrow();
  });

  // Real observed case: a two-part problem defines "f(x)=(1-x)e^x-1" (part
  // 1) and "g(x)=(2-x)e^x+2-x" (part 2) in the same solution. The solution
  // correctly states "f(0) = 0" (true for f) and, separately, "g(0) = 4"
  // (true for g) — but findConcreteFunctionLatex (scanning for the last
  // non-linear candidate) returned g's latex, and the old hardcoded
  // "[fy](...)=..." pattern pooled *both* claims together regardless of
  // which function each was actually about, checking "f(0)=0" against g's
  // formula (g(0)=4) and flagging a false mismatch.
  it("does not flag a claim about one function ('f(0)=0') against a different function's own latex ('g', found because it's the non-linear one)", () => {
    const problem = "១) $f(x) = (1 - x)e^x - 1$។ ២) $g(x) = (2 - x)e^x + 2 - x$។";
    const solutionText = "f(0) = (1 - 0)e^0 - 1 = 0\n---\ng(0) = (2 - 0)e^0 + 2 - 0 = 4";
    expect(checkExtremaValueClaims(problem, solutionText).ok).toBe(true);
  });

  it("still catches a genuine mismatch for the specifically-named function that findConcreteFunctionLatex returns", () => {
    const problem = "១) $f(x) = (1 - x)e^x - 1$។ ២) $g(x) = (2 - x)e^x + 2 - x$។";
    // g(1) is actually (2-1)e^1+2-1 = e+1 ≈ 3.72, not 100 — a real mismatch,
    // still on the function findConcreteFunctionLatex actually returns (g).
    const solutionText = "f(0) = (1 - 0)e^0 - 1 = 0\n---\ng(1) = 100";
    const result = checkExtremaValueClaims(problem, solutionText);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.x).toBe(1);
      expect(result.claimedY).toBe(100);
    }
  });
});

describe("repairNestedDollarsInsideAligned", () => {
  // Real observed case: a \begin{aligned}...\end{aligned} block (with a
  // nested \begin{vmatrix}...\end{vmatrix} cross-product computation) came
  // back with *extra* "$$" pairs interleaved mid-block — right after the
  // vmatrix row, and again between two later rows — splitting what should
  // be one coherent display-math span into several fragments. The
  // segmenter (which just alternates text/math on successive "$$" pairs,
  // with no idea what's semantically inside a block) then rendered the
  // interior fragments as literal, unformatted "&= (5(-5) - 0(0))..." text
  // instead of typeset math.
  const malformed = `$$\\begin{aligned}
\\vec{BC} \\times \\vec{BD} &= \\begin{vmatrix} \\vec{i} & \\vec{j} & \\vec{k} \\\\ -5 & 5 & 0 \\\\ -5 & 0 & -5 \\end{vmatrix} \\\\
$$&= (5(-5) - 0(0))\\vec{i} - ((-5)(-5) - 0(-5))\\vec{j} + ((-5)(0) - 5(-5))\\vec{k} \\\\$$
$$&= -25\\vec{i} - 25\\vec{j} + 25\\vec{k}$$
\\end{aligned}$$`;

  it("collapses a \\begin{aligned} block with interleaved stray '$$' pairs back into one coherent span", () => {
    const fixed = repairNestedDollarsInsideAligned(malformed);
    // Exactly one opening and one closing "$$" should remain — both outside
    // the \begin{aligned}...\end{aligned} span, none interleaved inside it.
    expect((fixed.match(/\$\$/g) ?? []).length).toBe(2);
    expect(fixed).toContain("\\begin{aligned}\n\\vec{BC}");
    expect(fixed).toContain("&= -25\\vec{i} - 25\\vec{j} + 25\\vec{k}\n\\end{aligned}$$");
    // The interior of the block (between \begin{aligned} and \end{aligned})
    // must contain zero "$$" — the whole thing reads as one continuous span.
    const interior = fixed.match(/\\begin\{aligned\}([\s\S]*)\\end\{aligned\}/)?.[1] ?? "";
    expect(interior).not.toContain("$$");
  });

  it("leaves ordinary content (no \\begin{aligned} block) untouched", () => {
    const plain = "$$x + y = 5$$ and some prose with $z = 2$.";
    expect(repairNestedDollarsInsideAligned(plain)).toBe(plain);
  });

  it("leaves a well-formed \\begin{aligned} block (no interior '$$') untouched", () => {
    const wellFormed = "$$\\begin{aligned}\na &= 1 \\\\\nb &= 2\n\\end{aligned}$$";
    expect(repairNestedDollarsInsideAligned(wellFormed)).toBe(wellFormed);
  });
});
