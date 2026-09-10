// Permanent regression suite for zupiq-backend/utils/diagram-blocks.ts.
//
// Every case here was a real bug found in production, diagnosed from an
// actual session record, fixed, and (until this file existed) verified only
// with a throwaway script — meaning every one of them could have silently
// regressed on the next change with nothing to catch it. This file is that
// catch. See DIAGRAM_STRUCTURE_JSON_GUIDE.md for the full narrative behind
// each fix.
import { describe, expect, it, vi } from "vitest";
import { evaluateLatexAt, evaluateLatexWithBindings, latexReferencesVariable, normalizeDiagramBlocks } from "./diagram-blocks.js";
import { logger } from "./logger.js";

function firstFunction(blocks: ReturnType<typeof normalizeDiagramBlocks>) {
  const spec = blocks[0]?.spec as Record<string, unknown> | undefined;
  const functions = spec?.functions as Array<Record<string, unknown>> | undefined;
  return functions?.[0];
}

function nearestPoint(points: [number, number][], x: number): [number, number] {
  return points.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
}

describe("generic expression engine — sampling fallback", () => {
  it("samples a quadratic-over-quadratic rational with no closed-form family", () => {
    // f(x) = (x²-16)/(x²-3x+4), the case that motivated building the
    // general engine in the first place.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-8.8, 2], domain: [-6, 6],
        functions: [{ kind: "quadratic", latex: "y = \\frac{x^2 - 16}{x^2 - 3x + 4}", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => (x * x - 16) / (x * x - 3 * x + 4);
    for (const x of [-4, 0, 4, 6]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 2);
    }
  });

  it("samples sqrt of a non-linear polynomial (a semicircle mislabeled as a parabola)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1, 6], domain: [-5, 5],
        functions: [{ kind: "quadratic", latex: "y = \\sqrt{25 - x^2}", params: { a: -1, b: 1, c: 25 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    for (const [x, expected] of [[-4.5, 2.1794494717703367], [0, 5], [3, 4], [-4, 3]] as const) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(expected, 1);
    }
  });

  it("leaves a genuine simple square-root closed form alone", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1, 5], domain: [2, 8],
        functions: [{ kind: "square-root", latex: "y = \\sqrt{x-2}+1", params: { a: 1, h: 2, k: 1 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("square-root");
    expect(fn.params).toEqual({ a: 1, h: 2, k: 1 });
  });

  it("samples a compound trig expression that isn't a bare sin/cos term", () => {
    // x*tan(x) - cos(x); the AI misread this as a=-1 for a bare -cos(x).
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1.2, 0.2], domain: [-0.785, 7.07],
        functions: [{ kind: "cosine", latex: "y = x \\tan x - \\cos x", params: { a: -1, b: 1, c: 0, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => x * Math.tan(x) - Math.cos(x);
    for (const x of [0, Math.PI, 2 * Math.PI]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 1);
    }
    // near the pi/2 asymptote, samples should stay bounded (not NaN/Infinity)
    for (const [, y] of points) expect(Number.isFinite(y)).toBe(true);
  });

  it("parses sqrt as an operand inside a compound trig expression", () => {
    // (x^2-1)cos(x) + sqrt(2)sin(x) - 1 — the trig sampler didn't recognize
    // \sqrt at all until this was added, so the fallback silently no-opped.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 2.14], domain: [-0.2, 1.2],
        functions: [{ kind: "quadratic", latex: "(x^2-1)\\cos x + \\sqrt{2}\\sin x - 1", params: { a: 1, b: 1, c: -1 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => (x * x - 1) * Math.cos(x) + Math.sqrt(2) * Math.sin(x) - 1;
    for (const x of [0, 1]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 2);
    }
  });

  it("does not let the sin±cos combo heuristic match across a \\frac/\\sqrt boundary", () => {
    // (2x - sin x) / sqrt(1 - cos x) — the "-" inside "1-cos x" (inside the
    // sqrt, inside the denominator) was matching as if it combined the
    // numerator's sin x and that cos x into one fabricated sinusoid.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-3, 3], domain: [-2, 2],
        functions: [{
          kind: "sine",
          latex: "y = \\frac{2x - \\sin x}{\\sqrt{1 - \\cos x}}",
          params: { a: Math.SQRT2, b: 1, c: -Math.PI / 4, d: 0 },
          points: [],
        }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => (2 * x - Math.sin(x)) / Math.sqrt(1 - Math.cos(x));
    for (const x of [-2, -1, 1, 2]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 2);
    }
    // The jump discontinuity at x=0 (the whole point of the original limit
    // problem this came from) must survive: negative just left of 0,
    // positive just right of 0.
    const leftOfZero = points.filter(([x]) => x < 0 && x > -0.05);
    const rightOfZero = points.filter(([x]) => x > 0 && x < 0.05);
    expect(leftOfZero.every(([, y]) => y < 0)).toBe(true);
    expect(rightOfZero.every(([, y]) => y > 0)).toBe(true);
  });

  it("still detects the legitimate sin(x)+cos(x) combo (no frac/sqrt present)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2, 2], domain: [-6, 6],
        functions: [{ kind: "sine", latex: "y = \\sin(x)+\\cos(x)", params: { a: 1, b: 1, c: 0, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("sine");
    const params = fn.params as { a: number; c: number };
    expect(params.a).toBeCloseTo(Math.SQRT2, 5);
    expect(params.c).toBeCloseTo(Math.PI / 4, 5);
  });

  it("catches a valid-shape closed-form kind with simply wrong coefficients (new: previously unverified)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-3, 3],
        functions: [{ kind: "quadratic", latex: "y=x^2", params: { a: 5, b: 0, c: 100 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const [, y] = nearestPoint(points, 2);
    expect(y).toBeCloseTo(4, 1); // true x^2 at x=2, not the fabricated 5*4+100
  });

  it("leaves a closed-form kind with correct, matching coefficients untouched", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-3, 3],
        functions: [{ kind: "quadratic", latex: "y=x^2", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("quadratic");
    expect(fn.params).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("preserves a multi-function diagram (curve + secant line) with correct params", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1, 4], domain: [0.5, 3], graphStyle: "reciprocal-interval",
        functions: [
          { kind: "rational-reciprocal", latex: "y=\\frac{3}{x}", params: { a: 3, h: 0, k: 0 }, points: [] },
          { kind: "linear", latex: "y=-1.5x+4.5", params: { m: -1.5, b: 4.5 }, points: [] },
        ],
        featurePoints: [{ point: [1, 3], label: "(1,3)" }, { point: [2, 1.5], label: "(2,1.5)" }],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const functions = spec.functions as Array<Record<string, unknown>>;
    expect(functions[0].kind).toBe("rational-reciprocal");
    expect(functions[1].kind).toBe("linear");
    expect(functions[1].params).toEqual({ m: -1.5, b: 4.5 });
  });
});

describe("dropped-placeholder guard (any kind, not just quadratic)", () => {
  it("drops a quadratic with empty latex regardless of its specific params", () => {
    // Two real observed signatures: the canonical {a:1,b:0,c:0} default,
    // and a fabricated {a:1,b:-1,c:0} for an L'Hôpital limit problem with
    // no quadratic in it at all.
    for (const params of [{ a: 1, b: 0, c: 0 }, { a: 1, b: -1, c: 0 }]) {
      const blocks = normalizeDiagramBlocks([{
        diagramType: "function-graph",
        spec: {
          type: "function-graph", range: [-3, 3], domain: [-1, 2],
          functions: [{ kind: "quadratic", latex: "", params, points: [] }],
          featurePoints: [{ color: "primary", label: "(0.5, -0.25)", point: [0.5, -0.25], closed: true }],
        },
      }]);
      expect(blocks.length).toBe(0);
    }
  });

  it("does not drop a real quadratic just because it lacks a latex string", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-5, 5],
        functions: [{ kind: "quadratic", latex: "", params: { a: 2, b: 1, c: -3 }, points: [] }],
        featurePoints: [],
      },
    }]);
    // NOTE: this is deliberately dropped too under the current (broadened)
    // rule — see DIAGRAM_STRUCTURE_JSON_GUIDE.md: every real observed
    // empty-latex quadratic was a fabrication, so the guard now drops all
    // of them, not just the one canonical default signature. This test
    // documents that intentional behavior rather than a hypothetical
    // "should survive" case.
    expect(blocks.length).toBe(0);
  });

  it("drops a non-quadratic (e.g. cubic) placeholder with empty latex and no params, just raw points", () => {
    // Real observed case: y=x^4-3x^2+x^-2 (second-derivative problem) got a
    // diagram with kind:"cubic", latex:"", no params at all — just a raw
    // `points` array tracing an entirely fabricated y=4x^3-3, invented from
    // numbers that loosely echo the problem's own coefficients (the "4"
    // from 4x^3 in y', the "3" from -3x^2 in y) with no real derivation,
    // and with none of the real function's x=0 vertical asymptote (from its
    // x^-2 term) anywhere in sight. The old guard only ever fired for
    // kind:"quadratic" with a `params` object — this shape has neither.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-42, 36], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "", points: [[-2, -35], [0, -3], [2, 29]] }],
        featurePoints: [{ color: "primary", label: "(0, -3)", point: [0, -3] }],
      },
    }]);
    expect(blocks.length).toBe(0);
  });

  it("does not drop a function that has real latex, even with unusual kind/params combinations", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-10, 10], domain: [-3, 3],
        functions: [{ kind: "cubic", latex: "y = x^3", params: { a: 1, b: 0, c: 0, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    expect(blocks.length).toBe(1);
  });
});

describe("dropped-unparseable guard (implicit relations in both x and y)", () => {
  it("drops a closed-form kind claimed for an implicit relation the engine can't parse as y=f(x)", () => {
    // Real observed case: an implicit-differentiation problem for
    // "4xy = x^2 + y^2" — actually a degenerate conic (a pair of straight
    // lines through the origin, y=(2±√3)x, since y^2-4xy+x^2=0 factors) —
    // got diagrammed as kind:"quadratic" with params for a completely
    // unrelated y=x^2+x. The engine only evaluates a single-variable
    // y=f(x); this latex has a genuine "=" left over after stripping the
    // ordinary "y="/"f(x)=" prefix, so it's a real equation in two
    // variables, not a bare expression — unparseable and unverifiable.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-3, 3], domain: [-2, 1],
        functions: [{ kind: "quadratic", latex: "4xy = x^2 + y^2", params: { a: 1, b: 1, c: 0 }, points: [] }],
        featurePoints: [{ color: "primary", label: "(-0.5, -0.25)", point: [-0.5, -0.25], closed: true }],
      },
    }]);
    expect(blocks.length).toBe(0);
  });

  it("does not misfire on a piecewise domain annotation that also fails to parse but has no leftover '='", () => {
    // "y=2x+1 \quad (x \ge 0)" also fails to parse (per the piecewise
    // domain-restriction test below), but after stripping the "y=" prefix
    // there's no bare "=" left in "2x+1\quad(x\ge0)" — \ge is a single
    // LaTeX command token, not an equals sign. This must stay a supported,
    // deliberately-tolerated shape, not get swept up by the new guard.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-8.4, 8.4], domain: [-3, 3],
        functions: [{ kind: "linear", latex: "y = 2x + 1 \\quad (x \\ge 0)", params: { b: 1, m: 2 }, points: [] }],
        featurePoints: [],
      },
    }]);
    expect(blocks.length).toBe(1);
    expect((blocks[0]?.spec as Record<string, unknown>).functions).toEqual([
      expect.objectContaining({ kind: "linear", domain: [0, 3] }),
    ]);
  });

  it("drops a closed-form kind claimed for a genuinely symbolic/parametric latex", () => {
    // Real observed case: a problem discussing y=(ax^2+bx+c)/(px^2+qx+r)
    // in the abstract — no concrete a,b,c,p,q,r given anywhere, the whole
    // problem is a case analysis over them — got diagrammed as
    // kind:"quadratic", params:{a:1,b:0,c:0}: plain y=x^2, treating the
    // numerator's own symbolic "a" as the literal number 1 and dropping
    // the denominator (and the asymptotes it produces, which is what the
    // problem is actually about) entirely. No leftover "=" survives after
    // stripping the "y=" prefix, so this needed its own guard rather than
    // the implicit-relation one above.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2, 3], domain: [-1, 1],
        functions: [{ kind: "quadratic", latex: "y = \\frac{ax^2+bx+c}{px^2+qx+r}", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [{ color: "primary", label: "(0, 0)", point: [0, 0], closed: true }],
      },
    }]);
    expect(blocks.length).toBe(0);
  });

  it("does not misfire on a genuine e^x-style expression with a single non-x letter", () => {
    // `e` is excluded from the symbolic-letter count so a real exponential
    // isn't mistaken for a stray parametric coefficient. This still fails
    // to parse today (the grammar has no bare-`e` constant), but that's a
    // separate, pre-existing "left untouched" outcome — it must not be
    // newly swept up by this guard.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-2, 2],
        functions: [{ kind: "exponential", latex: "y = e^x", params: { a: 1, b: 2.718281828 }, points: [] }],
        featurePoints: [],
      },
    }]);
    expect(blocks.length).toBe(1);
  });
});

describe("dropped-lim-expression-as-latex guard", () => {
  it("drops a function whose latex is the whole \\lim statement, not a function definition", () => {
    // y=x^3 sampled points, but the "latex" is actually the entire limit
    // expression — the AI plotted just the numerator's leading term.
    const points: [number, number][] = [[-2, -8], [-1, -1], [0, 0], [1, 1], [2, 8]];
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-10, 10], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "\\lim_{x \\to 0} \\frac{x^3 - x \\sin x}{x - \\sin^2 x}", points }],
        featurePoints: [{ color: "primary", label: "(0, 0)", point: [0, 0] }],
      },
    }]);
    expect(blocks.length).toBe(0);
  });
});

describe("stale feature points after a curve correction", () => {
  it("drops feature points computed against the original (wrong) formula", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-3, 3], domain: [-2, 2],
        functions: [{
          kind: "sine",
          latex: "y = \\frac{2x - \\sin x}{\\sqrt{1 - \\cos x}}",
          params: { a: Math.SQRT2, b: 1, c: -Math.PI / 4, d: 0 },
          points: [],
        }],
        featurePoints: [
          { color: "primary", label: "(-2, -0.493)", point: [-2, -0.49315059027853936] }, // from the fake sinusoid
          { color: "primary", label: "(-0.785, -sqrt2)", point: [-0.7853981633974483, -Math.SQRT2] },
        ],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect(spec.featurePoints).toEqual([]);
  });

  it("keeps feature points that genuinely lie on the corrected curve", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 2.14], domain: [-0.2, 1.2],
        functions: [{ kind: "quadratic", latex: "(x^2-1)\\cos x + \\sqrt{2}\\sin x - 1", params: { a: 1, b: 1, c: -1 }, points: [] }],
        featurePoints: [
          { color: "primary", label: "f(0)=-2", point: [0, -2] },
          { color: "primary", label: "f(1)~0.19", point: [1, 0.1894] },
        ],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect((spec.featurePoints as unknown[]).length).toBe(2);
  });

  it("drops a feature point whose x falls entirely outside the sampled curve's own domain", () => {
    // Real observed case: y = sqrt(5x-2)/x^3 is only defined for x >= 2/5
    // (the sqrt's domain floor) — the AI claimed feature point (0,0), but
    // x=0 is below that floor, so the resampled curve's own points never
    // reach x=0 at all. The old check only rejected a point whose x fell
    // *inside* a sampled function's x-range but had the wrong y there — an
    // x outside every sampled function's range was treated as "nothing to
    // check against" and silently kept, even though "the curve doesn't
    // exist there at all" is at least as strong a staleness signal as "the
    // curve exists there but disagrees."
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-0.57, 6.29], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "y = \\frac{\\sqrt{5x-2}}{x^3}", params: { a: 0, b: 0, c: 5, d: -2 }, points: [] }],
        featurePoints: [{ color: "primary", label: "(0, 0)", point: [0, 0] }],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect(spec.featurePoints).toEqual([]);
  });

  it("does not drop an out-of-range feature point when the diagram mixes a sampled curve with another kind", () => {
    // Guard against the obvious false-positive this fix could introduce: in
    // a diagram with more than one function where only *some* are sampled
    // points-curves, a feature point outside the points-curve's narrow
    // domain might genuinely belong to the *other* function instead — it
    // was never meant to be checked against the points-curve in the first
    // place, so it must not be dropped just because that curve doesn't
    // reach that far. Here (0,0) is the genuine vertex of y=x^2; the second
    // function, y=sqrt(x-1), is only defined for x>=1, so its resampled
    // points never reach x=0 — the fix must not let that curve's narrow
    // domain veto a point that was never meant to be checked against it.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-2, 2],
        functions: [
          { kind: "quadratic", latex: "y = x^2", params: { a: 1, b: 0, c: 0 }, points: [] },
          { kind: "points", color: "secondary", latex: "y = \\sqrt{x-1}", params: {}, points: [] },
        ],
        featurePoints: [{ color: "primary", label: "(0, 0)", point: [0, 0] }],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect((spec.featurePoints as unknown[]).length).toBe(1);
  });
});

describe("multi-variable bindings (a second named variable besides x)", () => {
  it("evaluates an expression with an unknown constant bound alongside x", () => {
    // The engine tokenizes "ax" as two separate single-letter variables
    // ("a" then "x"), not one two-letter identifier — implicit
    // multiplication, same as "2x".
    expect(evaluateLatexWithBindings("ax", { a: 3, x: 2 })).toBeCloseTo(6, 10);
    expect(evaluateLatexWithBindings("1+ax-\\sqrt{1+x}", { a: 5 / 8, x: 0.001 })).not.toBeNull();
  });

  it("returns null (not 0) for a variable left unbound, rather than guessing", () => {
    expect(evaluateLatexWithBindings("ax", { x: 2 })).toBeNull();
  });

  it("latexReferencesVariable correctly finds 'a' immediately adjacent to 'x' (the 'ax' case)", () => {
    // A word-boundary-style regex here would wrongly reject "a" in "ax"
    // (treating it as if "ax" were one two-letter identifier) — this must
    // stay AST-based, not regex-based.
    expect(latexReferencesVariable("1+ax-\\sqrt{1+x}", "a")).toBe(true);
    expect(latexReferencesVariable("1+ax-\\sqrt{1+x}", "n")).toBe(false);
  });

  it("latexReferencesVariable returns null for unparseable latex", () => {
    expect(latexReferencesVariable("|x|", "x")).toBeNull();
  });
});

describe("stale xTicks/yTicks outside the graph's own domain/range", () => {
  it("drops tick labels copied from a full-period trig template onto a much narrower domain", () => {
    // Real observed case: a piecewise function restricted to [-pi/2, pi/2]
    // (checking continuity at x=0) shipped with the AI's canned
    // full-period-wave xTicks (0, pi/2, pi, 3pi/2, 2pi) verbatim — pi,
    // 3pi/2 and 2pi are nowhere near this problem's actual domain.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 2.5], domain: [-Math.PI / 2, Math.PI / 2],
        xTicks: [
          { value: 0, label: "0" },
          { value: Math.PI / 2, label: "\\pi/2", major: true },
          { value: Math.PI, label: "\\pi" },
          { value: (3 * Math.PI) / 2, label: "3\\pi/2", major: true },
          { value: 2 * Math.PI, label: "2\\pi" },
        ],
        functions: [
          { kind: "points", latex: "y = \\sin x + \\sqrt{2}", domain: [0, Math.PI / 2], points: [[0, Math.SQRT2], [Math.PI / 2, 1 + Math.SQRT2]] },
          { kind: "points", latex: "y = \\sin x - \\sqrt{2}", domain: [-Math.PI / 2, 0], points: [[-Math.PI / 2, -1 - Math.SQRT2], [0, -Math.SQRT2]] },
        ],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const xTicks = spec.xTicks as Array<{ value: number }>;
    expect(xTicks.map((t) => t.value)).toEqual([0, Math.PI / 2]);
  });

  it("keeps a genuine full-period trig wave's own 0..2pi ticks (no over-filtering)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1.25, 1.25], domain: [0, 2 * Math.PI],
        graphStyle: "trig-wave",
        xTicks: [
          { value: 0, label: "0" },
          { value: Math.PI / 2, label: "\\pi/2", major: true },
          { value: Math.PI, label: "\\pi" },
          { value: (3 * Math.PI) / 2, label: "3\\pi/2", major: true },
          { value: 2 * Math.PI, label: "2\\pi" },
        ],
        functions: [{ kind: "sine", latex: "y = \\sin x", params: { a: 1, b: 1, c: 0, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const xTicks = spec.xTicks as Array<{ value: number }>;
    expect(xTicks.length).toBe(5);
  });

  it("drops a yTick label far outside the graph's actual y-range", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 2.5], domain: [-2, 2],
        yTicks: [{ value: -1, label: "-1" }, { value: 0, label: "0" }, { value: 1, label: "1" }, { value: 50, label: "50" }],
        functions: [{ kind: "quadratic", latex: "y = x^2", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const yTicks = spec.yTicks as Array<{ value: number }>;
    expect(yTicks.map((t) => t.value)).toEqual([-1, 0, 1]);
  });
});

describe("closed-form spot-check: at least half mismatch, not a strict majority", () => {
  it("corrects a wrong 'sine' classification whose curve coincidentally agrees at one of the 4 fixed sample points", () => {
    // Real observed case: an IVT proof for sin(x) = x-1 diagrams
    // f(x) = sin x - x + 1, but the AI classified it as kind "sine" with
    // params {a:1,b:1,c:0,d:0} — plain sin(x). Plain sin(x) and the true
    // latex agree exactly at x=1 (where "-x+1" = 0), and the 4 fixed sample
    // points for domain [-1,4] land exactly on x=0,1,2,3 — so only 3 of 4
    // disagreed, not all 4. A unanimous-mismatch requirement missed this;
    // a strict-majority one must not.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 1.5], domain: [-1, 4],
        functions: [{ kind: "sine", latex: "y = \\sin x - x + 1", params: { a: 1, b: 1, c: 0, d: 0 }, points: [] }],
        graphStyle: "trig-wave",
        featurePoints: [
          { color: "primary", label: "(-1, -0.841)", point: [-1, -0.8414709848078965], closed: true },
          { color: "primary", label: "(\\pi/2, 1)", point: [Math.PI / 2, 1], closed: true },
          { color: "primary", label: "(4, -0.757)", point: [4, -0.7568024953079282], closed: true },
        ],
        guideLines: [
          { orientation: "vertical", value: Math.PI / 2, from: 0, to: 1, label: "\\pi/2", color: "focus" },
          { orientation: "horizontal", value: 1, from: 0, to: Math.PI / 2, color: "focus" },
        ],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => Math.sin(x) - x + 1;
    for (const x of [-1, 0, Math.PI, 4]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 1);
    }
    // The feature points and guide lines were computed against the wrong
    // (plain sin x) curve — none of them lie on the true one, so all
    // should be dropped rather than left stale.
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect(spec.featurePoints).toEqual([]);
    expect(spec.guideLines).toEqual([]);
  });

  it("still corrects a closed-form kind whose curve disagrees at every sample point (unanimous case still works)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-4, 4],
        functions: [{ kind: "quadratic", latex: "y = x^3", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
  });

  it("leaves a genuinely correct closed-form kind's default trig guide lines intact (no over-correction)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1.25, 1.25], domain: [0, 2 * Math.PI],
        functions: [{ kind: "sine", latex: "y = \\sin x", params: { a: 1, b: 1, c: 0, d: 0 }, points: [] }],
        graphStyle: "trig-wave",
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("sine");
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect((spec.guideLines as unknown[]).length).toBeGreaterThan(0);
  });

  it("corrects a wrong 'cubic' classification whose mismatch is an exact 2-of-4 tie", () => {
    // Real observed case: y=x^4-3x^3+x^2 (a second-derivative problem) got
    // kind:"cubic" params for -3x^3+x^2 — the AI dropped the x^4 term
    // entirely. claimed-vs-truth disagrees by exactly x^4 at every sample
    // point: tiny at the two sample points close to x=0 (where x^4 is
    // small enough to fall inside the tolerance floor), large at the two
    // further out — an exact 2-of-4 tie that a strict "more than half"
    // rule doesn't count as a majority, letting the wrong cubic survive
    // with a stale (0,-3) feature point (the real function has f(0)=0).
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-42, 36], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "y = x^4 - 3x^3 + x^2", params: { a: -3, b: 1, c: 0, d: 0 }, points: [] }],
        featurePoints: [{ color: "primary", label: "(0, -3)", point: [0, -3] }],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => x ** 4 - 3 * x ** 3 + x ** 2;
    for (const x of [-2, -1, 1, 2]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 1);
    }
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect(spec.featurePoints).toEqual([]);
  });
});

describe("\\log/\\ln support in the general expression engine", () => {
  it("evaluates \\log_{10} with its explicit base", () => {
    expect(evaluateLatexWithBindings("\\log_{10}x", { x: 100 })).toBeCloseTo(2, 10);
    expect(evaluateLatexWithBindings("\\log_{2}x", { x: 8 })).toBeCloseTo(3, 10);
  });

  it("defaults a bare \\log (no subscript) to base 10", () => {
    expect(evaluateLatexWithBindings("\\log x", { x: 1000 })).toBeCloseTo(3, 10);
  });

  it("evaluates \\ln as natural log", () => {
    expect(evaluateLatexWithBindings("\\ln x", { x: Math.E * Math.E })).toBeCloseTo(2, 10);
  });

  it("corrects a wrong 'linear' classification for a genuinely logarithmic function", () => {
    // Real observed case: an IVT proof for 20*log10(x)-x=0 diagrams the
    // correct latex "y = 20 \log_{10} x - x", but the AI classified it as
    // kind "linear" with params {m:-1, b:10} (i.e. y=10-x) — a straight
    // line nowhere near the true, sharply-rising-then-flattening curve.
    // This slipped through undetected because the general engine's grammar
    // didn't parse `\log` at all, so the "never trust AI numbers over
    // latex" spot-check silently no-op'd (no parseable AST to check
    // against). Once `\log` parses, "linear" is a spot-checkable kind, so
    // the mismatch (a straight line vs. a logarithmic curve disagrees
    // everywhere except by coincidence) gets caught and resampled.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2, 12], domain: [0.5, 11],
        functions: [{ kind: "linear", latex: "y = 20 \\log_{10} x - x", params: { b: 10, m: -1 }, points: [] }],
        featurePoints: [
          { color: "primary", label: "(1, -1)", point: [1, -1] },
          { color: "primary", label: "(10, 10)", point: [10, 10] },
        ],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => 20 * Math.log10(x) - x;
    for (const x of [1, 2, 5, 10, 11]) {
      const [, y] = nearestPoint(points, x);
      // Loose tolerance: the nearest sampled x isn't exactly x, and log
      // curves fastest right near x=1, so a fixed sample spacing means a
      // slightly bigger gap there than toBeCloseTo's default precision.
      expect(Math.abs(y - trueF(x))).toBeLessThan(0.2);
    }
    // These happen to already lie on the true curve, so they should survive.
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect((spec.featurePoints as unknown[]).length).toBe(2);
  });
});

describe("trig-power notation (\\sin^2 x, \\tan^2 x, ...) in the general expression engine", () => {
  it("evaluates \\tan^2 x as (\\tan x)^2, not a parse failure", () => {
    expect(evaluateLatexWithBindings("\\tan^2 x", { x: 0.5 })).toBeCloseTo(Math.tan(0.5) ** 2, 10);
  });

  it("evaluates the Pythagorean identity \\sin^2 x + \\cos^2 x as ~1 everywhere", () => {
    expect(evaluateLatexWithBindings("\\sin^2 x + \\cos^2 x", { x: 0.7 })).toBeCloseTo(1, 10);
    expect(evaluateLatexWithBindings("\\sin^{2}x", { x: 0.5 })).toBeCloseTo(Math.sin(0.5) ** 2, 10);
  });

  it("bails (returns null) on \\tan^{-1} x rather than misreading it as 1/\\tan x", () => {
    // \tan^{-1}x conventionally means arctan(x) in real math notation, not a
    // reciprocal — this engine has no inverse-trig support, so silently
    // computing 1/tan(x) here would be actively wrong, not just unverified.
    expect(evaluateLatexWithBindings("\\tan^{-1} x", { x: 0.5 })).toBeNull();
  });

  it("corrects a fabricated placeholder quadratic hiding behind an unparseable \\tan^2 x term", () => {
    // Real observed case: "y = x^2 - \tan^2 x" (from a derivative problem)
    // diagrammed as kind:"quadratic", params {a:1,b:0,c:0} — i.e. plain
    // y=x^2, silently dropping the entire -\tan^2 x term. This slipped
    // through undetected because \tan^2 x (the exponent written directly
    // after the function name, before its argument) failed to parse at all
    // — parseFuncArg saw "^" where it expected "(" or an atom — so the
    // general engine's spot-check had no ground truth to compare against
    // and silently no-op'd. The true function is a downward-opening dome
    // peaking at (0,0) and dropping steeply to ~-1.43 by x=±1, nothing like
    // the AI's upward-opening y=x^2.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2, 3], domain: [-1, 1],
        functions: [{ kind: "quadratic", latex: "y = x^2 - \\tan^2 x", params: { a: 1, b: 0, c: 0 }, points: [] }],
        featurePoints: [{ color: "primary", label: "(0, 0)", point: [0, 0], closed: true }],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => x * x - Math.tan(x) ** 2;
    for (const x of [-1, -0.5, 0, 0.5, 1]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 2);
    }
    // The old, uncorrected reading (plain y=x^2) would put f(1) at +1; the
    // true function is deeply negative there — pin down the actual sign.
    const [, yAtOne] = nearestPoint(points, 1);
    expect(yAtOne).toBeLessThan(-1);
  });
});

describe("bare trig argument absorbs a leading numeric/pi coefficient (\\sin 2x means sin(2x))", () => {
  it("evaluates \\sin 2x as sin(2x), not sin(2)*x", () => {
    expect(evaluateLatexWithBindings("\\sin 2x", { x: 0.15 })).toBeCloseTo(Math.sin(0.3), 10);
  });

  it("evaluates \\cos \\pi x as cos(pi*x)", () => {
    expect(evaluateLatexWithBindings("\\cos \\pi x", { x: 0.5 })).toBeCloseTo(Math.cos(Math.PI * 0.5), 10);
  });

  it("still parses \\sin x \\cos x as a product, not sin(x*cos(x))", () => {
    // The coefficient-absorption rule must stop at a nested function call —
    // otherwise this would wrongly become sin(x*cos(x)) instead of two
    // separate multiplied factors.
    expect(evaluateLatexWithBindings("\\sin x \\cos x", { x: 0.4 })).toBeCloseTo(Math.sin(0.4) * Math.cos(0.4), 10);
  });

  it("leaves \\sqrt's bare-argument convention alone (\\sqrt 2x is sqrt(2)*x, not sqrt(2x))", () => {
    // Unlike trig functions, \sqrt (and \ln/\log) genuinely only binds to
    // the single next token without braces — this is real LaTeX macro
    // semantics, not a convenience convention like the trig case above, so
    // the coefficient-absorption fix must not be generalized to them.
    expect(evaluateLatexWithBindings("\\sqrt2x", { x: 3 })).toBeCloseTo(Math.sqrt(2) * 3, 10);
  });

  it("corrects a curve that was silently wrong only in the domain's interior, not at its edges", () => {
    // Real observed case: "y = 3x^2 - \sin 2x" sampled as if it were
    // "3x^2 - sin(2)*x" — a straight-line term standing in for the sine
    // term — because the old bare-argument rule for \sin/\cos/\tan grabbed
    // only the "2" token, leaving "x" to multiply onto the function's
    // *result* (via the outer implicit-multiplication loop) instead of
    // becoming part of its argument. Both readings happen to agree at
    // x=-1, x=0, and x=1 (sin(±2)=±sin(2), sin(0)=0) — exactly the
    // function-graph's domain endpoints and midpoint — so a spot-check
    // sampling only those would have missed this bug entirely; the
    // mismatch only shows up strictly inside the domain (e.g. x=0.15,
    // where the two readings differ by about 0.16).
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-0.6, 4.4], domain: [-1, 1],
        functions: [{ kind: "quadratic", latex: "y = 3x^2 - \\sin 2x", params: { a: 3, b: 0, c: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn.kind).toBe("points");
    const points = fn.points as [number, number][];
    const trueF = (x: number) => 3 * x * x - Math.sin(2 * x);
    for (const x of [-1, -0.5, -0.15, 0, 0.15, 0.5, 1]) {
      const [, y] = nearestPoint(points, x);
      expect(y).toBeCloseTo(trueF(x), 2);
    }
    // Pin down the specific interior point that a wrong sin(2)*x reading
    // would put at a visibly different value (-0.069 instead of -0.228).
    const [, yAtQuarter] = nearestPoint(points, 0.15);
    expect(yAtQuarter).toBeCloseTo(-0.228, 2);
  });
});

describe("piecewise domain restriction inferred from latex", () => {
  it("clips each half of a jump-discontinuity graph to its own \\quad (x OP N) restriction", () => {
    // Real observed case: a jump discontinuity's two half-lines (both
    // slope 2, one "y=2x+1 (x >= 0)", one "y=2x-1 (x < 0)") had no
    // structured `domain` field at all — only a free-text restriction
    // inside the latex. Without it, both got rendered as full lines
    // spanning the whole graph instead of two rays split at x=0.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-8.4, 8.4], domain: [-3, 3],
        functions: [
          { kind: "linear", latex: "y = 2x + 1 \\quad (x \\ge 0)", params: { b: 1, m: 2 }, points: [] },
          { kind: "linear", latex: "y = 2x - 1 \\quad (x < 0)", params: { b: -1, m: 2 }, points: [] },
        ],
        featurePoints: [],
      },
    }]);
    const functions = (blocks[0]?.spec as Record<string, unknown>).functions as Array<Record<string, unknown>>;
    expect(functions[0].domain).toEqual([0, 3]);
    expect(functions[1].domain).toEqual([-3, 0]);
  });

  it("leaves domain alone when the function already has an explicit one", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-3, 3],
        functions: [{ kind: "linear", latex: "y = 2x + 1 \\quad (x \\ge 0)", params: { b: 1, m: 2 }, domain: [1, 2], points: [] }],
        featurePoints: [],
      },
    }]);
    const functions = (blocks[0]?.spec as Record<string, unknown>).functions as Array<Record<string, unknown>>;
    expect(functions[0].domain).toEqual([1, 2]);
  });

  it("does not misfire on latex with parentheses but no domain restriction", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-10, 10], domain: [-4, 4],
        functions: [{ kind: "quadratic", latex: "y = (x-3)(x+2)", params: { a: 1, b: -1, c: -6 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const functions = (blocks[0]?.spec as Record<string, unknown>).functions as Array<Record<string, unknown>>;
    expect(functions[0].domain).toBeUndefined();
  });
});

describe("range re-fit after a kind correction", () => {
  it("tightly re-fits the y-range once a function's kind/params were shown untrustworthy, instead of only ever growing the AI's original guess", () => {
    // Real observed case: f(x) = -3x^4 + sin(2x^3 - 1) was misclassified as
    // "cubic", and its declared range was [-309, 159] — the true curve never
    // goes above about -0.8, so once the curve got corrected to "points",
    // the AI's own range guess (computed against the same wrong assumption)
    // left well over half the chart's vertical space empty. The general
    // "grow if too small" range-fit never shrinks an oversized range, so
    // this needed a separate rule specifically for the corrected case.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-309, 159], domain: [-2, 3],
        functions: [{ kind: "cubic", latex: "f(x) = -3x^4 + \\sin(2x^3 - 1)", params: { a: -12, b: 0, c: 6, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const range = spec.range as [number, number];
    // The true data spans about [-242.6, -0.84] — the re-fit range should be
    // close to that with padding, nowhere near the original [-309, 159].
    expect(range[1]).toBeLessThan(30);
    expect(range[0]).toBeGreaterThan(-280);
  });

  it("still only grows (never shrinks) an undersized range when nothing was corrected", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1, 1], domain: [-1, 1],
        functions: [{ kind: "linear", latex: "y = 5x", params: { m: 5, b: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const range = spec.range as [number, number];
    // y=5x over [-1,1] spans [-5,5] — outside the AI's stated [-1,1], so this
    // should grow to fit, same as before this change (no correction fired).
    expect(range[0]).toBeLessThanOrEqual(-5);
    expect(range[1]).toBeGreaterThanOrEqual(5);
  });

  it("does not shrink a correctly-sized range when nothing was corrected", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-10, 10], domain: [-1, 1],
        functions: [{ kind: "linear", latex: "y = 2x", params: { m: 2, b: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    expect(spec.range).toEqual([-10, 10]);
  });

  it("captures a narrow near-asymptote spike a coarse 40-sample re-grid would step over", () => {
    // Real observed case: y=1/sqrt(5x^3+2) has a vertical asymptote right
    // at the edge of its domain, near x=-0.7368. Once corrected to
    // "points", re-fitting the range by coarsely re-sampling the curve at
    // just 40 evenly-spaced points across [-2,2] (spacing 0.1) stepped
    // right over the narrow sliver between the asymptote and the nearest
    // coarse sample at x=-0.7 — so the fitted range only ever saw y=1.87
    // there, when the function's own densely-sampled `points` (computed at
    // ~200+ resolution) actually reach y=5.96 at the domain's edge. The
    // range must be built from the function's own stored points, not a
    // coarser re-sample of it.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2, 3], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "y = \\frac{1}{\\sqrt{5x^3 + 2}}", params: { a: 5, b: 0, c: 0, d: 2 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const range = spec.range as [number, number];
    // The true near-asymptote peak in the sampled data is ~5.96 — the
    // range must extend well past that, not stop around 2.4 (where the
    // coarse-regrid bug would have capped it).
    expect(range[1]).toBeGreaterThan(5.5);
  });
});

describe("stale xTicks/yTicks after a genuine kind correction", () => {
  it("replaces stale trig-template ticks with ticks proportioned to the corrected range", () => {
    // Real observed case: y=5x^3-2\sin x\cos x got kind:"cubic" corrected
    // (compound trig + dominant cubic, true curve spans about ±41, range
    // grows to ±49), but its xTicks ({0, pi/2}) and yTicks ({-1,0,1}) were
    // computed for the AI's original wrong assumption — a bounded,
    // canonical-looking trig wave — and never got re-evaluated. They
    // aren't literally out of range (all technically fall inside ±49), so
    // the existing out-of-range tick filter doesn't catch them; they're
    // just uselessly clustered near zero on an axis that now spans ±49.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-1.25, 1.25], domain: [-2, 2],
        xTicks: [{ value: 0 }, { value: Math.PI / 2, major: true }],
        yTicks: [{ value: -1 }, { value: 0, major: true }, { value: 1 }],
        functions: [{ kind: "cubic", latex: "y = 5x^3 - 2\\sin x \\cos x", params: { a: 5, b: 0, c: 0, d: 0 }, points: [] }],
        graphStyle: "trig-wave",
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const xTicks = (spec.xTicks as Array<{ value: number }>).map((t) => t.value);
    const yTicks = (spec.yTicks as Array<{ value: number }>).map((t) => t.value);
    // The old ticks are gone; the new ones actually span the real range.
    expect(xTicks).not.toContain(Math.PI / 2);
    expect(yTicks).not.toEqual([-1, 0, 1]);
    expect(Math.max(...yTicks.map(Math.abs))).toBeGreaterThan(10);
  });

  it("does not regenerate ticks for a function that was already kind:\"points\" (routine re-verification, not a genuine correction)", () => {
    // This is the exact regression this fix caused and then had to
    // correct: a piecewise function already correctly using kind:"points"
    // gets a `function-kind-corrected:*` warning on every normalization
    // (points-kind functions are always re-verified against latex,
    // unconditionally, by design) — that must NOT be treated as "the AI's
    // original claim was shown wrong" the way a genuine kind:"cubic" (etc)
    // misclassification is, or every points-kind diagram's perfectly good,
    // already-correctly-filtered ticks get needlessly replaced.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-2.5, 2.5], domain: [-Math.PI / 2, Math.PI / 2],
        xTicks: [
          { value: 0, label: "0" },
          { value: Math.PI / 2, label: "\\pi/2", major: true },
        ],
        functions: [
          { kind: "points", latex: "y = \\sin x + \\sqrt{2}", domain: [0, Math.PI / 2], points: [[0, Math.SQRT2], [Math.PI / 2, 1 + Math.SQRT2]] },
          { kind: "points", latex: "y = \\sin x - \\sqrt{2}", domain: [-Math.PI / 2, 0], points: [[-Math.PI / 2, -1 - Math.SQRT2], [0, -Math.SQRT2]] },
        ],
        featurePoints: [],
      },
    }]);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const xTicks = (spec.xTicks as Array<{ value: number }>).map((t) => t.value);
    expect(xTicks).toEqual([0, Math.PI / 2]);
  });

  it("never leaks the internal _wasReclassifiedFromClosedForm marker into the stored spec", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      spec: {
        type: "function-graph", range: [-5, 5], domain: [-2, 2],
        functions: [{ kind: "cubic", latex: "y = x^3", params: { a: 1, b: 0, c: 0, d: 0 }, points: [] }],
        featurePoints: [],
      },
    }]);
    const fn = firstFunction(blocks)!;
    expect(fn).not.toHaveProperty("_wasReclassifiedFromClosedForm");
  });
});

describe("sign-table landmark-shorthand expansion", () => {
  function signTableRows(blocks: ReturnType<typeof normalizeDiagramBlocks>) {
    const spec = blocks[0]?.spec as Record<string, unknown> | undefined;
    return spec?.rows as Array<{ label: string; cells: string[] }> | undefined;
  }

  it("still expands the original single-critical-point shorthand (3 cells -> 5 cells)", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "sign-table",
      rows: [
        { label: "x", cells: ["-∞", "2", "+∞"] },
        { label: "f'(x)", cells: ["+", "0", "-"] },
      ],
    }]);
    expect(signTableRows(blocks)).toEqual([
      { label: "x", cells: ["-∞", "", "2", "", "+∞"] },
      { label: "f'(x)", cells: ["", "+", "0", "-", ""] },
    ]);
  });

  it("expands a three-critical-point shorthand (5 cells -> 9 cells), the shape a fixed narrow N=1 check missed", () => {
    // Real observed case: x=-2 and x=0 are ordinary critical points, x=-1
    // is a vertical asymptote (the "||" undefined marker) sitting between
    // them. The AI supplied the x row as just the 5 landmark values (no
    // spacer cells) and the sign row as the already-correctly-alternating
    // 7-cell sequence — the old code only recognized this shape when both
    // rows were exactly 3 cells, so a 5-vs-7 mismatch fell through
    // untouched, leaving the two rows misaligned under shared columns.
    const blocks = normalizeDiagramBlocks([{
      diagramType: "sign-table",
      rows: [
        { label: "x", cells: ["-∞", "-2", "-1", "0", "+∞"] },
        { label: "y'", cells: ["+", "0", "-", "||", "-", "0", "+"] },
      ],
    }]);
    expect(signTableRows(blocks)).toEqual([
      { label: "x", cells: ["-∞", "", "-2", "", "-1", "", "0", "", "+∞"] },
      { label: "y'", cells: ["", "+", "0", "-", "||", "-", "0", "+", ""] },
    ]);
  });

  it("does not misfire on a row pair whose lengths don't match the 2N+1 relationship", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "sign-table",
      rows: [
        { label: "x", cells: ["-∞", "-2", "-1", "0", "+∞"] },
        { label: "y'", cells: ["+", "0", "-"] }, // 3, not 2*3+1=7 — genuinely inconsistent input
      ],
    }]);
    expect(signTableRows(blocks)).toEqual([
      { label: "x", cells: ["-∞", "-2", "-1", "0", "+∞"] },
      { label: "y'", cells: ["+", "0", "-"] },
    ]);
  });

  it("leaves an already-well-formed table (rows already the same length) alone", () => {
    const blocks = normalizeDiagramBlocks([{
      diagramType: "sign-table",
      rows: [
        { label: "x", cells: ["-∞", "", "-1", "", "1", "", "+∞"] },
        { label: "f'(x)", cells: ["", "+", "0", "-", "0", "+", ""] },
      ],
    }]);
    expect(signTableRows(blocks)).toEqual([
      { label: "x", cells: ["-∞", "", "-1", "", "1", "", "+∞"] },
      { label: "f'(x)", cells: ["", "+", "0", "-", "0", "+", ""] },
    ]);
  });
});

describe("Euler's number ('e') support in the general expression engine", () => {
  it("evaluates e^{-2x} at x=0 as 1 (this used to accidentally work — Math.pow(NaN, 0) is 1)", () => {
    expect(evaluateLatexAt("y=e^{-2x}", 0)).toBeCloseTo(1, 6);
  });

  it("evaluates e^{-2x} at a nonzero x correctly instead of returning null", () => {
    // Real observed case: with "e" tokenized as an unbound bare-letter variable
    // (no dedicated Euler's-number AST node), "e^{-2x}" evaluated to
    // Math.pow(NaN, exponent), which is only finite (and only by a JS
    // quirk) when the exponent happens to be exactly 0 — every other x
    // returned null, making a perfectly evaluable exponential function look
    // completely unplottable.
    expect(evaluateLatexAt("y=e^{-2x}", 1)).toBeCloseTo(Math.exp(-2), 6);
    expect(evaluateLatexAt("y=e^{-2x}", -1)).toBeCloseTo(Math.exp(2), 6);
  });

  it("evaluates a product-with-exponential function across several x (not just x=0)", () => {
    // "f(x) = (x + 1)(e^{-2x} + 1)" — a real observed case that a
    // function-graph diagram needed to plot.
    const latex = "y=(x + 1)(e^{-2x} + 1)";
    expect(evaluateLatexAt(latex, 0)).toBeCloseTo(2, 6);
    expect(evaluateLatexAt(latex, 1)).toBeCloseTo(2 * (Math.exp(-2) + 1), 6);
    expect(evaluateLatexAt(latex, -1)).toBeCloseTo(0, 6);
  });

  it("still treats a genuinely unbound single-letter variable (not 'e') as NaN/null", () => {
    expect(evaluateLatexAt("y=k^{-2x}", 1)).toBeNull();
  });
});

describe("function latex is not truncated mid-expression before parsing", () => {
  // Real observed case: normalizeFunctionGraphSpec used to cap a function's
  // own `latex` at 80 characters before doing anything else with it. A
  // legitimate multi-term expression with a couple of
  // \left(\frac{...}{...}\right) groups easily exceeds that (this one is
  // ~94 chars) — the cap chopped it off mid-"\frac", so it failed to parse
  // at all, and the "can't verify this function's shape" branch dropped it
  // outright. The bug wasn't the AI or the general expression engine; it
  // was silent truncation before either ever got a chance to run.
  it("keeps a long-but-legitimate compound expression intact and plots it, rather than silently dropping the function", () => {
    const latex = "y=x + 1 + \\left(\\frac{x}{e^x}\\right)\\left(\\frac{1}{e^x}\\right) + \\left(\\frac{1}{e^x}\\right)^2";
    expect(latex.length).toBeGreaterThan(80); // pins down that this is exercising the >80-char case
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "points", latex, points: [] }],
      domain: [-2.4, 6],
      range: [-208, 43],
    }]);
    expect(blocks.length).toBe(1);
    const spec = blocks[0]?.spec as Record<string, unknown>;
    const fn = (spec.functions as Array<Record<string, unknown>>)[0];
    expect(Array.isArray(fn.points)).toBe(true);
    expect((fn.points as unknown[]).length).toBeGreaterThan(10);
  });
});

describe("dropped functions/blocks are logged loudly, not silently swallowed", () => {
  // Every one of the bugs this file's other describe blocks document (a
  // missing Euler's-e binding, an 80-char truncation, an asymptote
  // heuristic mistaking exponential growth for a pole, ...) looked
  // identical from the outside: a diagram the user expected just never
  // showed up, and finding the actual cause meant re-deriving from scratch
  // which of several possible drop points fired. These tests pin down that
  // every drop point actually emits a structured, greppable log line
  // instead of just `return null`, so the next one is a log lookup, not a
  // fresh investigation.
  it("logs when a function is dropped for an empty-latex placeholder", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "quadratic", latex: "", params: { a: 1, b: 0, c: 0 } }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[diagram:dropped-function] empty-latex-placeholder"),
      expect.objectContaining({ kind: "quadratic" }),
    );
    warnSpy.mockRestore();
  });

  it("logs when a function is dropped for containing \\lim in its own latex", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "cubic", latex: "\\lim_{x\\to0}\\frac{x^3-x\\sin x}{x-\\sin^2x}", params: { a: 1, b: 0, c: 0, d: 0 } }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[diagram:dropped-function] lim-expression-as-latex"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("logs when the whole block is dropped (critical warning, e.g. its only function got dropped)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "quadratic", latex: "", params: { a: 1, b: 0, c: 0 } }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    expect(blocks).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[diagram:dropped-block] empty-function-graph"),
      expect.objectContaining({ diagramType: "function-graph" }),
    );
    warnSpy.mockRestore();
  });

  it("includes the latex length in the payload when an oversized/unparseable latex is dropped — the exact signal that would have surfaced the 80-char truncation bug immediately", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "quadratic", latex: "y=4xy=x^2+y^2", params: { a: 1, b: 0, c: 0 } }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[diagram:dropped-function] unparseable-latex"),
      expect.objectContaining({ latexLength: expect.any(Number), hasEquals: true }),
    );
    warnSpy.mockRestore();
  });

  it("does not log anything when nothing was dropped", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const blocks = normalizeDiagramBlocks([{
      diagramType: "function-graph",
      functions: [{ kind: "linear", latex: "y=x+1", params: { m: 1, b: 1 } }],
      domain: [-5, 5],
      range: [-5, 5],
    }]);
    expect(blocks.length).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
