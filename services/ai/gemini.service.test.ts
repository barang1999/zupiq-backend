// Permanent regression suite for the diagram-vs-solution verification pass
// in gemini.service.ts. This is the one check that catches a diagram
// plotting the *wrong function entirely* (correctly parsed, correctly
// rendered, just not what the problem is about) — something
// diagram-blocks.ts's own normalization can never catch, since it only
// checks a function's params/points against its own latex, never against
// the solution. See DIAGRAM_STRUCTURE_JSON_GUIDE.md's "Wrong Function
// Selected" section for the full story.
import { describe, expect, it } from "vitest";
import { checkConstantSolvingFinalAnswer, checkSolutionCompleteness, extractAnchorClaims, verifyDiagramBlocksAgainstSolution } from "./gemini.service.js";
import { normalizeDiagramBlocks } from "../../utils/diagram-blocks.js";

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
