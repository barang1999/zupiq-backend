// Permanent regression suite for zupiq-backend/utils/diagram-blocks.ts.
//
// Every case here was a real bug found in production, diagnosed from an
// actual session record, fixed, and (until this file existed) verified only
// with a throwaway script — meaning every one of them could have silently
// regressed on the next change with nothing to catch it. This file is that
// catch. See DIAGRAM_STRUCTURE_JSON_GUIDE.md for the full narrative behind
// each fix.
import { describe, expect, it } from "vitest";
import { evaluateLatexWithBindings, latexReferencesVariable, normalizeDiagramBlocks } from "./diagram-blocks.js";

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

describe("dropped-placeholder-quadratic guard", () => {
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

describe("closed-form spot-check: majority mismatch, not unanimous", () => {
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
