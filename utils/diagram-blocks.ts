import { createHash } from "node:crypto";

export type DiagramType =
  | "geometry"
  | "function-graph"
  | "number-line"
  | "sign-table"
  | "venn-diagram"
  | "solid-geometry"
  | "pie-chart"
  | "tree-diagram";

export type DiagramMathFamily =
  | "linear"
  | "quadratic"
  | "cubic"
  | "polynomial"
  | "absolute-value"
  | "rational-reciprocal"
  | "inverse-square"
  | "rational-even"
  | "exponential"
  | "logarithmic"
  | "square-root"
  | "trigonometric"
  | "piecewise"
  | "number-line"
  | "sign-table"
  | "venn"
  | "geometry"
  | "solid-geometry"
  | "pie-chart"
  | "tree-diagram"
  | "graph"
  | "unknown";

export type DiagramProblemIntent =
  | "average-rate"
  | "point-membership"
  | "range"
  | "integral"
  | "function-value"
  | "variation"
  | "other";

export type DiagramIntent =
  | "interval-points"
  | "secant-interval"
  | "shaded-interval"
  | "point-check"
  | "function-value"
  | "variation"
  | "range"
  | "basic-graph"
  | "unknown";

export type DiagramRenderBlock = {
  type: "diagram";
  diagramType: DiagramType;
  mathFamily?: DiagramMathFamily;
  problemIntent?: DiagramProblemIntent;
  diagramIntent?: DiagramIntent;
  renderTemplate?: string;
  spec: Record<string, unknown>;
  renderer: "zupiq-svg";
  version: 1;
  cacheKey: string;
  warnings?: string[];
};

type SupportedFunctionGraphFamily = "rational-reciprocal" | "inverse-square" | "rational-even";

// Asymptotic rational-function kinds whose curve should always be computed from
// their closed-form params rather than trusted from AI-supplied sample points —
// see the usage in normalizeFunctionGraphSpec for the full rationale.
const RATIONAL_ASYMPTOTIC_KINDS = new Set<string>(["rational-reciprocal", "inverse-square", "rational-even"]);

// The function-graph kinds `evalFnAt` actually implements a formula for.
// Used to decide whether a closed-form kind's own params can be spot-checked
// against its latex (see the "never trust AI numbers over latex" pass in
// normalizeFunctionGraphSpec) — "absolute-value"/"logarithmic"/"piecewise"
// are real closed forms too, but have no evalFnAt branch yet, so there's
// nothing to spot-check their params against. That's fine: any kind NOT in
// this set still gets resampled from latex unconditionally whenever the
// latex parses (see `shouldResampleFromLatex`'s default), which is strictly
// safer than a spot-check anyway — it's only kinds *in* this set that get
// the benefit of the doubt pending 4 sample points disagreeing. The general
// expression engine's grammar does parse `\log`/`\ln` (with an explicit
// `\log_{base}`, defaulting to base 10 for a bare `\log`) — the gap that let
// a genuinely logarithmic function get diagrammed as `kind:"linear"`
// unnoticed. It still doesn't parse `|x|`, though, so "absolute-value"
// latex still fails to parse and that check is still a no-op there.
const EVALUATABLE_CLOSED_FORM_KINDS = new Set<string>([
  "linear", "quadratic", "cubic", "square-root",
  "rational-reciprocal", "inverse-square", "rational-even",
  "exponential", "sine", "trig-sine", "cosine", "trig-cosine",
]);

type FunctionGraphIntentBuildInput = {
  mathFamily: SupportedFunctionGraphFamily;
  problemIntent?: DiagramProblemIntent;
  diagramIntent?: DiagramIntent;
  renderTemplate?: string;
  interval: [number, number];
  closedStart?: boolean;
  closedEnd?: boolean;
  params: Record<string, unknown>;
  latex?: string;
  existingSpec?: Record<string, unknown>;
};

const DIAGRAM_TYPES = new Set<DiagramType>([
  "geometry",
  "function-graph",
  "number-line",
  "sign-table",
  "venn-diagram",
  "solid-geometry",
  "pie-chart",
  "tree-diagram",
]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cacheKey(diagramType: DiagramType, spec: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${diagramType}:${stableStringify(spec)}`)
    .digest("hex")
    .slice(0, 24);
}

function cleanToken(value: unknown, max = 48): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return normalized ? normalized.slice(0, max) : undefined;
}

/** Map raw AI color names to the canonical tokens understood by diagramColor(). */
function normalizeDiagramColor(value: string, fallback = "primary"): string {
  const c = value.trim().toLowerCase();
  if (c === "blue" || c === "primary") return "primary";
  if (c === "red" || c === "danger") return "red";
  if (c === "green" || c === "success") return "green";
  if (c === "cyan" || c === "focus") return "focus";
  if (c === "warm" || c === "accent" || c === "tertiary" || c === "orange" || c === "yellow") return "warm";
  if (c === "muted" || c === "secondary" || c === "grey" || c === "gray") return "muted";
  // Unknown token — fall back so the frontend defaults to primary.
  return fallback;
}

export function normalizeProblemIntent(value: unknown): DiagramProblemIntent | undefined {
  const normalized = cleanToken(value);
  return normalized && ["average-rate", "point-membership", "range", "integral", "function-value", "variation", "other"].includes(normalized)
    ? normalized as DiagramProblemIntent
    : undefined;
}

function normalizeDiagramIntent(value: unknown): DiagramIntent | undefined {
  const normalized = cleanToken(value);
  return normalized && [
    "interval-points",
    "secant-interval",
    "shaded-interval",
    "point-check",
    "function-value",
    "variation",
    "range",
    "basic-graph",
    "unknown",
  ].includes(normalized)
    ? normalized as DiagramIntent
    : undefined;
}

function normalizeMathFamily(value: unknown): DiagramMathFamily | undefined {
  const normalized = cleanToken(value);
  return normalized && [
    "linear",
    "quadratic",
    "cubic",
    "polynomial",
    "absolute-value",
    "rational-reciprocal",
    "inverse-square",
    "rational-even",
    "exponential",
    "logarithmic",
    "square-root",
    "trigonometric",
    "piecewise",
    "number-line",
    "sign-table",
    "venn",
    "geometry",
    "solid-geometry",
    "pie-chart",
    "tree-diagram",
    "graph",
    "unknown",
  ].includes(normalized)
    ? normalized as DiagramMathFamily
    : undefined;
}

function inferMathFamily(diagramType: DiagramType, spec: Record<string, unknown>): DiagramMathFamily {
  if (diagramType !== "function-graph") {
    if (diagramType === "venn-diagram") return "venn";
    return diagramType as DiagramMathFamily;
  }
  const functions = Array.isArray(spec.functions) ? spec.functions as Array<Record<string, unknown>> : [];
  const kinds = functions.map((fn) => String(fn.kind || "").trim()).filter(Boolean);
  if (kinds.some((kind) => ["sine", "trig-sine", "cosine", "trig-cosine"].includes(kind))) return "trigonometric";
  if (kinds.includes("rational-even")) return "rational-even";
  if (kinds.includes("inverse-square")) return "inverse-square";
  if (kinds.includes("rational-reciprocal")) return "rational-reciprocal";
  if (kinds.includes("piecewise")) return "piecewise";
  if (kinds.includes("absolute-value")) return "absolute-value";
  if (kinds.includes("square-root")) return "square-root";
  if (kinds.includes("logarithmic")) return "logarithmic";
  if (kinds.includes("exponential")) return "exponential";
  if (kinds.includes("cubic")) return "cubic";
  if (kinds.includes("quadratic")) return "quadratic";
  if (kinds.includes("linear")) return "linear";
  return functions.length > 1 ? "polynomial" : "unknown";
}

function defaultDiagramIntent(problemIntent: DiagramProblemIntent | undefined): DiagramIntent | undefined {
  if (problemIntent === "average-rate") return "secant-interval";
  if (problemIntent === "integral") return "shaded-interval";
  if (problemIntent === "point-membership") return "point-check";
  if (problemIntent === "function-value") return "function-value";
  if (problemIntent === "variation") return "variation";
  if (problemIntent === "range") return "range";
  return undefined;
}

function normalizeRenderTemplate(value: unknown, fallback: unknown): string | undefined {
  return cleanToken(value, 64) || cleanToken(fallback, 64);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  if (value === "Infinity" || value === Infinity) return Number.MAX_VALUE;
  if (value === "-Infinity" || value === -Infinity) return -Number.MAX_VALUE;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = asFiniteNumber(value[0], Number.NaN);
  const y = asFiniteNumber(value[1], Number.NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function normalizeNumberLineSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const ranges = Array.isArray(input.ranges) ? input.ranges : [];
  const points = Array.isArray(input.points) ? input.points : [];
  const normalizedRanges = ranges
    .map((range) => {
      if (!range || typeof range !== "object") return null;
      const item = range as Record<string, unknown>;
      const from = asFiniteNumber(item.from, Number.NaN);
      const to = asFiniteNumber(item.to, Number.NaN);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
      return {
        from: Math.min(from, to),
        to: Math.max(from, to),
        closedStart: Boolean(item.closedStart),
        closedEnd: Boolean(item.closedEnd),
        label: typeof item.label === "string" ? item.label.slice(0, 40) : undefined,
      };
    })
    .filter(Boolean);
  const normalizedPoints = points
    .map((point) => {
      if (typeof point === "number" || typeof point === "string") {
        const value = asFiniteNumber(point, Number.NaN);
        return Number.isFinite(value) ? { value, closed: true } : null;
      }
      if (!point || typeof point !== "object") return null;
      const item = point as Record<string, unknown>;
      const value = asFiniteNumber(item.value, Number.NaN);
      if (!Number.isFinite(value)) return null;
      return {
        value,
        closed: item.closed !== false,
        label: typeof item.label === "string" ? item.label.slice(0, 40) : undefined,
      };
    })
    .filter(Boolean);

  let normalizedBoxPlot: Record<string, number> | undefined = undefined;
  if (input.boxPlot && typeof input.boxPlot === "object") {
    const bp = input.boxPlot as Record<string, unknown>;
    const minVal = asFiniteNumber(bp.min, Number.NaN);
    const q1Val = asFiniteNumber(bp.q1, Number.NaN);
    const q2Val = asFiniteNumber(bp.q2, Number.NaN);
    const q3Val = asFiniteNumber(bp.q3, Number.NaN);
    const maxVal = asFiniteNumber(bp.max, Number.NaN);
    if (
      Number.isFinite(minVal) &&
      Number.isFinite(q1Val) &&
      Number.isFinite(q2Val) &&
      Number.isFinite(q3Val) &&
      Number.isFinite(maxVal)
    ) {
      normalizedBoxPlot = { min: minVal, q1: q1Val, q2: q2Val, q3: q3Val, max: maxVal };
    }
  }

  if (!normalizedRanges.length && !normalizedPoints.length && !normalizedBoxPlot) {
    warnings.push("empty-number-line");
  }

  return {
    type: "number-line",
    ranges: normalizedRanges,
    points: normalizedPoints,
    min: Number.isFinite(Number(input.min)) ? Number(input.min) : undefined,
    max: Number.isFinite(Number(input.max)) ? Number(input.max) : undefined,
    ...(normalizedBoxPlot ? { boxPlot: normalizedBoxPlot } : {}),
  };
}

function normalizeSignTableSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  let normalizedRows = rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const cells = Array.isArray(item.values)
        ? item.values
        : Array.isArray(item.signs)
          ? item.signs
          : Array.isArray(item.cells)
            ? item.cells
            : [];
      return {
        label: String(item.label || "").slice(0, 32),
        cells: cells.map((cell) => String(cell ?? "").slice(0, 32)),
      };
    })
    .filter((row) => row && (row.label || row.cells.length)) as { label: string; cells: string[] }[];

  // Automatically expand 3-column shorthand tables to 5-column interval tables
  if (
    normalizedRows.length === 2 &&
    normalizedRows[0].cells.length === 3 &&
    normalizedRows[1].cells.length === 3
  ) {
    const r0 = normalizedRows[0].cells;
    const r1 = normalizedRows[1].cells;
    const hasMinusInf = r0[0].includes("-∞") || r0[0].includes("-\\infty");
    const hasPlusInf = r0[2].includes("+∞") || r0[2].includes("+\\infty") || r0[2].includes("∞");
    const hasZero = r1[1] === "0";
    if (hasMinusInf && hasPlusInf && hasZero) {
      normalizedRows[0].cells = [r0[0], "", r0[1], "", r0[2]];
      normalizedRows[1].cells = ["", r1[0], "0", r1[2], ""];
    }
  }

  // Slice columns to limit size
  normalizedRows = normalizedRows.map(row => ({
    label: row.label,
    cells: row.cells.slice(0, 8)
  }));

  if (!normalizedRows.length) warnings.push("empty-sign-table");
  return { type: "sign-table", rows: normalizedRows.slice(0, 6) };
}

function normalizeVennDiagramSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const sets = Array.isArray(input.sets) ? input.sets : [];
  const leftSet = sets[0] && typeof sets[0] === "object" ? sets[0] as Record<string, unknown> : {};
  const rightSet = sets[1] && typeof sets[1] === "object" ? sets[1] as Record<string, unknown> : {};
  const regions = input.regions && typeof input.regions === "object" ? input.regions as Record<string, unknown> : {};
  const totals = input.totals && typeof input.totals === "object" ? input.totals as Record<string, unknown> : {};
  const leftLabel = String(leftSet.label || input.leftLabel || "M").slice(0, 24);
  const rightLabel = String(rightSet.label || input.rightLabel || "S").slice(0, 24);
  const leftTotal = asFiniteNumber(leftSet.total ?? totals.left ?? input.leftTotal, Number.NaN);
  const rightTotal = asFiniteNumber(rightSet.total ?? totals.right ?? input.rightTotal, Number.NaN);
  const intersection = asFiniteNumber(regions.intersection ?? input.intersection, Number.NaN);
  const leftOnly = asFiniteNumber(
    regions.leftOnly ?? input.leftOnly,
    Number.isFinite(leftTotal) && Number.isFinite(intersection) ? leftTotal - intersection : Number.NaN,
  );
  const rightOnly = asFiniteNumber(
    regions.rightOnly ?? input.rightOnly,
    Number.isFinite(rightTotal) && Number.isFinite(intersection) ? rightTotal - intersection : Number.NaN,
  );
  const universalTotal = asFiniteNumber(input.universalTotal ?? input.universeTotal ?? input.total, Number.NaN);
  const neither = asFiniteNumber(regions.neither ?? regions.none ?? regions.outside ?? input.neither ?? input.none ?? input.outside, Number.NaN);

  if (!Number.isFinite(leftOnly) && !Number.isFinite(rightOnly) && !Number.isFinite(intersection)) {
    warnings.push("empty-venn-diagram");
  }

  return {
    type: "venn-diagram",
    sets: [
      { label: leftLabel, total: Number.isFinite(leftTotal) ? leftTotal : undefined },
      { label: rightLabel, total: Number.isFinite(rightTotal) ? rightTotal : undefined },
    ],
    regions: {
      leftOnly: Number.isFinite(leftOnly) ? leftOnly : undefined,
      intersection: Number.isFinite(intersection) ? intersection : undefined,
      rightOnly: Number.isFinite(rightOnly) ? rightOnly : undefined,
      neither: Number.isFinite(neither) ? neither : undefined,
    },
    universalTotal: Number.isFinite(universalTotal) ? universalTotal : undefined,
    universeLabel: typeof input.universeLabel === "string" ? input.universeLabel.slice(0, 32) : undefined,
  };
}

function normalizeGeometrySpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const shapes = Array.isArray(input.shapes) ? input.shapes : [];
  const normalizedShapes = shapes
    .map((shape) => {
      if (!shape || typeof shape !== "object") return null;
      const item = shape as Record<string, unknown>;
      let shapeType = String(item.shape || item.type || "").toLowerCase().trim();
      if (shapeType === "rectangle" || shapeType === "square") {
        shapeType = "polygon";
      }
      if (!["triangle", "polygon", "circle", "ellipse", "segment", "line", "arrow", "angle", "arc", "semicircle", "sector", "point"].includes(shapeType)) return null;
      const vertices = Array.isArray(item.vertices)
        ? item.vertices.map(asPoint).filter(Boolean).slice(0, 8)
        : [];
      const center = asPoint(item.center);
      const start = asPoint(item.start);
      const end = asPoint(item.end);
      const vertex = asPoint(item.vertex);
      const from = asPoint(item.from);
      const to = asPoint(item.to);
      const radius = asFiniteNumber(item.radius, Number.NaN);
      const rx = asFiniteNumber(item.rx, Number.NaN);
      const ry = asFiniteNumber(item.ry, Number.NaN);
      const startAngle = asFiniteNumber(item.startAngle, Number.NaN);
      const endAngle = asFiniteNumber(item.endAngle, Number.NaN);
      return {
        shape: shapeType,
        vertices,
        center,
        start,
        end,
        vertex,
        from,
        to,
        radius: Number.isFinite(radius) ? radius : undefined,
        rx: Number.isFinite(rx) ? rx : undefined,
        ry: Number.isFinite(ry) ? ry : undefined,
        startAngle: Number.isFinite(startAngle) ? startAngle : undefined,
        endAngle: Number.isFinite(endAngle) ? endAngle : undefined,
        labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label).slice(0, 16)).slice(0, 8) : undefined,
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: typeof item.color === "string" ? normalizeDiagramColor(item.color, "primary") : undefined,
        fill: typeof item.fill === "string" ? item.fill.slice(0, 24) : undefined,
      };
    })
    .filter((shape) => {
      if (!shape) return false;
      if (shape.shape === "circle") return Boolean(shape.center) && Number.isFinite(shape.radius);
      if (shape.shape === "ellipse") return Boolean(shape.center) && Number.isFinite(shape.rx) && Number.isFinite(shape.ry);
      if (shape.shape === "arc") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "semicircle") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "sector") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "arrow" || shape.shape === "line") return Boolean(shape.start) && Boolean(shape.end);
      if (shape.shape === "angle") return Boolean(shape.vertex) && Boolean(shape.from) && Boolean(shape.to);
      if (shape.shape === "point") return Array.isArray(shape.vertices) && shape.vertices.length > 0;
      return Array.isArray(shape.vertices) && shape.vertices.length >= 2;
    });
  if (!normalizedShapes.length) warnings.push("empty-geometry");

  const inputOptions = input.options && typeof input.options === "object"
    ? input.options as Record<string, unknown>
    : {};
  const axisBounds = ["xMin", "xMax", "yMin", "yMax"].reduce<Record<string, number | undefined>>((acc, key) => {
    const value = asFiniteNumber(inputOptions[key], Number.NaN);
    if (Number.isFinite(value)) acc[key] = value;
    return acc;
  }, {});
  const options = {
    ...axisBounds,
    grid: inputOptions.grid === true,
    showOrigin: inputOptions.showOrigin === true,
    xAxisLabel: typeof inputOptions.xAxisLabel === "string" ? inputOptions.xAxisLabel.slice(0, 32) : undefined,
    yAxisLabel: typeof inputOptions.yAxisLabel === "string" ? inputOptions.yAxisLabel.slice(0, 32) : undefined,
  };

  const inputLabels = Array.isArray(input.labels) ? input.labels : [];
  const normalizedLabels = inputLabels
    .map((label) => {
      if (!label || typeof label !== "object") return null;
      const item = label as Record<string, unknown>;
      const text = typeof item.text === "string" ? item.text.slice(0, 32) : "";
      const position = asPoint(item.position);
      if (!text || !position) return null;
      return {
        text,
        position,
        color: typeof item.color === "string" ? normalizeDiagramColor(item.color, "primary") : undefined,
      };
    })
    .filter(Boolean);

  return {
    type: "geometry",
    shapes: normalizedShapes.slice(0, 12),
    options,
    labels: normalizedLabels.slice(0, 12),
  };
}

function evalFnAt(fn: Record<string, unknown>, x: number): number {
  const kind = String(fn.kind || "");
  const p = (fn.params && typeof fn.params === "object" ? fn.params : {}) as Record<string, unknown>;
  if (kind === "linear") return asFiniteNumber(p.m, 1) * x + asFiniteNumber(p.b, 0);
  if (kind === "quadratic") return asFiniteNumber(p.a, 1) * x * x + asFiniteNumber(p.b, 0) * x + asFiniteNumber(p.c, 0);
  if (kind === "cubic") {
    return asFiniteNumber(p.a, 1) * x ** 3 + asFiniteNumber(p.b, 0) * x ** 2 + asFiniteNumber(p.c, 0) * x + asFiniteNumber(p.d, 0);
  }
  if (kind === "square-root") {
    const dx = x - asFiniteNumber(p.h, 0);
    return dx >= 0 ? asFiniteNumber(p.a, 1) * Math.sqrt(dx) + asFiniteNumber(p.k, 0) : Number.NaN;
  }
  if (kind === "rational-reciprocal") {
    const h = asFiniteNumber(p.h ?? p.verticalAsymptote, 0);
    const dx = x - h;
    if (Math.abs(dx) < 0.0001) return Number.NaN;
    return asFiniteNumber(p.a, 1) / dx + asFiniteNumber(p.k ?? p.horizontalAsymptote, 0);
  }
  if (kind === "inverse-square") {
    const h = asFiniteNumber(p.h ?? p.verticalAsymptote, 0);
    const dx = x - h;
    if (Math.abs(dx) < 0.0001) return Number.NaN;
    return asFiniteNumber(p.a, 1) / (dx * dx) + asFiniteNumber(p.k ?? p.horizontalAsymptote, 0);
  }
  if (kind === "rational-even") {
    const h = asFiniteNumber(p.h, 0);
    const b = asFiniteNumber(p.b, 1);
    const denominator = (x - h) * (x - h) + b;
    if (Math.abs(denominator) < 0.0001) return Number.NaN;
    return asFiniteNumber(p.a, 1) / denominator + asFiniteNumber(p.k, 0);
  }
  if (kind === "exponential") return asFiniteNumber(p.a, 1) * Math.pow(asFiniteNumber(p.b, Math.E), x);
  if (kind === "sine" || kind === "trig-sine") return asFiniteNumber(p.a, 1) * Math.sin(asFiniteNumber(p.b, 1) * x + asFiniteNumber(p.c, 0)) + asFiniteNumber(p.d, 0);
  if (kind === "cosine" || kind === "trig-cosine") return asFiniteNumber(p.a, 1) * Math.cos(asFiniteNumber(p.b, 1) * x + asFiniteNumber(p.c, 0)) + asFiniteNumber(p.d, 0);
  if (kind === "points") {
    const pts = Array.isArray(fn.points) ? fn.points as [number, number][] : [];
    for (let i = 0; i < pts.length - 1; i++) {
      const x0 = pts[i][0], y0 = pts[i][1];
      const x1 = pts[i + 1][0], y1 = pts[i + 1][1];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
      if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return Number.NaN;
  }
  return Number.NaN;
}

function hasTrigLabel(value: unknown): boolean {
  return /(?:\\pi\b|\bpi\b|π|\\sin\b|\bsin\b|\\cos\b|\bcos\b)/i.test(String(value ?? ""));
}

function isBasicReciprocalLatex(value: unknown): boolean {
  return simpleReciprocalParamsFromLatex(value) !== null;
}

function basicReciprocalNumerator(value: unknown): number {
  const parsed = simpleReciprocalParamsFromLatex(value);
  return parsed ? parsed.a : Number.NaN;
}

function simpleReciprocalParamsFromLatex(value: unknown): { a: number; h: number; k: number } | null {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\\cdot/g, "*")
    .replace(/^(?:[a-z]\([a-z]\)|[a-z])=/, "");
  const parseDenominator = (denominator: string): { h: number; scale: number } | null => {
    const clean = denominator
      .replace(/^\((.*)\)$/, "$1")
      .replace(/\*/g, "");
    const scaledGroup = clean.match(/^([+-]?\d+(?:\.\d+)?)\((.+)\)$/);
    if (scaledGroup) {
      const scale = Number(scaledGroup[1]);
      const parsed = parseDenominator(scaledGroup[2]);
      return Number.isFinite(scale) && parsed ? { h: parsed.h, scale: parsed.scale * scale } : null;
    }
    const match = clean.match(/^([+-]?(?:\d+(?:\.\d+)?)?)x(?:(\+|-)(\d+(?:\.\d+)?))?$/);
    if (!match) return null;
    const coefficient = match[1] === "" || match[1] === "+" ? 1 : match[1] === "-" ? -1 : Number(match[1]);
    const offsetMagnitude = match[3] ? Number(match[3]) : 0;
    if (!Number.isFinite(coefficient) || Math.abs(coefficient) < 0.0001 || !Number.isFinite(offsetMagnitude)) return null;
    const offset = match[2] === "-" ? -offsetMagnitude : offsetMagnitude;
    return { h: -offset / coefficient, scale: coefficient };
  };
  const fracMatch = compact.match(/^\\frac\{([+-]?\d+(?:\.\d+)?)\}\{([^{}]+)\}$/);
  if (fracMatch) {
    const a = Number(fracMatch[1]);
    const denominator = parseDenominator(fracMatch[2]);
    return Number.isFinite(a) && denominator ? { a: a / denominator.scale, h: denominator.h, k: 0 } : null;
  }
  const slashMatch = compact.match(/^([+-]?\d+(?:\.\d+)?)\/(.+)$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const denominator = parseDenominator(slashMatch[2]);
    return Number.isFinite(a) && denominator ? { a: a / denominator.scale, h: denominator.h, k: 0 } : null;
  }
  return null;
}

// Parses a simple linear expression in x: "coeff*x + constant", e.g. "x-3",
// "2x+5", "-x", "4+x", "3(x-2)". Returns null if it isn't linear in x.
function parseLinearExpression(value: string): { coeff: number; constant: number } | null {
  const clean = value.replace(/^\((.*)\)$/, "$1").replace(/\*/g, "");
  const scaledGroup = clean.match(/^([+-]?\d+(?:\.\d+)?)\((.+)\)$/);
  if (scaledGroup) {
    const scale = Number(scaledGroup[1]);
    const inner = parseLinearExpression(scaledGroup[2]);
    return Number.isFinite(scale) && inner
      ? { coeff: inner.coeff * scale, constant: inner.constant * scale }
      : null;
  }
  // "[coeff]x[+-offset]", e.g. "x-3", "2x+5", "-x", "x"
  const xFirst = clean.match(/^([+-]?(?:\d+(?:\.\d+)?)?)x(?:(\+|-)(\d+(?:\.\d+)?))?$/);
  if (xFirst) {
    const coeff = xFirst[1] === "" || xFirst[1] === "+" ? 1 : xFirst[1] === "-" ? -1 : Number(xFirst[1]);
    const magnitude = xFirst[3] ? Number(xFirst[3]) : 0;
    const constant = xFirst[2] === "-" ? -magnitude : magnitude;
    return Number.isFinite(coeff) && Number.isFinite(constant) ? { coeff, constant } : null;
  }
  // "constant[+-][coeff]x", e.g. "4+x", "3-2x", "-4+x"
  const constFirst = clean.match(/^([+-]?\d+(?:\.\d+)?)(\+|-)(\d+(?:\.\d+)?)?x$/);
  if (constFirst) {
    const constant = Number(constFirst[1]);
    const magnitude = constFirst[3] ? Number(constFirst[3]) : 1;
    const coeff = constFirst[2] === "-" ? -magnitude : magnitude;
    return Number.isFinite(constant) && Number.isFinite(coeff) ? { coeff, constant } : null;
  }
  return null;
}

// Parses \frac{P}{Q} where P is a genuine linear-in-x numerator (a constant
// numerator is simpleReciprocalParamsFromLatex's job) and Q is linear in x,
// into { a, h, k } via polynomial division:
//   (px+q)/(rx+s) = p/r + [q/r - p·s/r²] / (x - (-s/r))
// Deliberately kept separate from simpleReciprocalParamsFromLatex — that
// function also gates the reciprocal-interval textbook template via
// isBasicReciprocalLatex, and a compound rational like (x-3)/(4+x) is a plain
// function-graph curve, not that specific k=0 textbook template.
function compoundReciprocalParamsFromLatex(value: unknown): { a: number; h: number; k: number } | null {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\\cdot/g, "*")
    .replace(/^(?:[a-z]\([a-z]\)|[a-z])=/, "");
  const fracMatch = compact.match(/^\\frac\{([^{}]+)\}\{([^{}]+)\}$/);
  if (!fracMatch) return null;
  const numerator = parseLinearExpression(fracMatch[1]);
  const denominator = parseLinearExpression(fracMatch[2]);
  if (!numerator || !denominator || Math.abs(denominator.coeff) < 0.0001) return null;
  if (Math.abs(numerator.coeff) < 0.0001) return null; // constant numerator — not this function's case
  const { coeff: p, constant: q } = numerator;
  const { coeff: r, constant: s } = denominator;
  const h = -s / r;
  const k = p / r;
  const a = q / r - (p * s) / (r * r);
  return Number.isFinite(a) && Number.isFinite(h) && Number.isFinite(k) ? { a, h, k } : null;
}

function simpleInverseSquareParamsFromLatex(value: unknown): { a: number; h: number; k: number; p: 2 } | null {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[²]/g, "^2")
    .replace(/^(?:[a-z]\([a-z]\)|[a-z])=/, "");
  const parseDenominator = (denominator: string): number | null => {
    const clean = denominator.replace(/^\((.*)\)$/, "$1");
    const match = clean.match(/^\(?x(?:(\+|-)(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})$/);
    if (!match) return null;
    const offset = match[2] ? Number(match[2]) : 0;
    if (!Number.isFinite(offset)) return null;
    return match[1] === "+" ? -offset : offset;
  };
  const fracMatch = compact.match(/^\\frac\{([+-]?\d+(?:\.\d+)?)\}\{(.+)\}$/);
  if (fracMatch) {
    const a = Number(fracMatch[1]);
    const h = parseDenominator(fracMatch[2]);
    return Number.isFinite(a) && h !== null ? { a, h, k: 0, p: 2 } : null;
  }
  const slashMatch = compact.match(/^([+-]?\d+(?:\.\d+)?)\/(.+)$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const h = parseDenominator(slashMatch[2]);
    return Number.isFinite(a) && h !== null ? { a, h, k: 0, p: 2 } : null;
  }
  return null;
}

function simpleRationalEvenParamsFromLatex(value: unknown): { a: number; h: number; b: number; k: number } | null {
  const compact = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[²]/g, "^2")
    .replace(/\\?left|\\?right/g, "")
    .replace(/^(?:[a-z]\([a-z]\)|[a-z])=/, "");
  const parseDenominator = (denominator: string): { h: number; b: number } | null => {
    const clean = denominator.replace(/^\((.*)\)$/, "$1");
    const match = clean.match(/^\(?x(?:(\+|-)(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})(?:(\+|-)(\d+(?:\.\d+)?))$/);
    if (!match) return null;
    const shift = match[2] ? Number(match[2]) : 0;
    const bMagnitude = Number(match[4]);
    if (!Number.isFinite(shift) || !Number.isFinite(bMagnitude)) return null;
    const h = match[1] === "+" ? -shift : shift;
    const b = match[3] === "-" ? -bMagnitude : bMagnitude;
    return Math.abs(b) > 0.0001 ? { h, b } : null;
  };
  const fracMatch = compact.match(/^\\frac\{([+-]?\d+(?:\.\d+)?)\}\{(.+)\}$/);
  if (fracMatch) {
    const a = Number(fracMatch[1]);
    const denominator = parseDenominator(fracMatch[2]);
    return Number.isFinite(a) && denominator ? { a, h: denominator.h, b: denominator.b, k: 0 } : null;
  }
  const slashMatch = compact.match(/^([+-]?\d+(?:\.\d+)?)\/(.+)$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const denominator = parseDenominator(slashMatch[2]);
    return Number.isFinite(a) && denominator ? { a, h: denominator.h, b: denominator.b, k: 0 } : null;
  }
  return null;
}

function parsePiValue(input: string): number | null {
  const raw = String(input || "").toLowerCase().replace(/\s+/g, "");
  const fracMatch = raw.match(/\\?frac\{\\?pi\}\{(\d+(?:\.\d+)?)\}/);
  if (fracMatch) {
    const denominator = Number(fracMatch[1]);
    return denominator ? Math.PI / denominator : null;
  }
  const fracMultipleMatch = raw.match(/\\?frac\{(\d+(?:\.\d+)?)\\?pi\}\{(\d+(?:\.\d+)?)\}/);
  if (fracMultipleMatch) {
    const numerator = Number(fracMultipleMatch[1]);
    const denominator = Number(fracMultipleMatch[2]);
    return denominator ? (numerator * Math.PI) / denominator : null;
  }
  const compact = String(input || "")
    .toLowerCase()
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");
  const compactFrac = compact.match(/frac(\d+(?:\.\d+)?)?(?:pi|π)(\d+(?:\.\d+)?)$/);
  if (compactFrac) {
    const numerator = compactFrac[1] ? Number(compactFrac[1]) : 1;
    const denominator = Number(compactFrac[2]);
    return denominator ? (numerator * Math.PI) / denominator : null;
  }
  if (!compact.includes("pi") && !compact.includes("π")) return null;
  const normalized = compact.replace(/π/g, "pi");
  const fraction = normalized.match(/^(\d+(?:\.\d+)?)?pi\/(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const numerator = fraction[1] ? Number(fraction[1]) : 1;
    const denominator = Number(fraction[2]);
    return denominator ? (numerator * Math.PI) / denominator : null;
  }
  const multiple = normalized.match(/^(\d+(?:\.\d+)?)?pi$/);
  if (multiple) return (multiple[1] ? Number(multiple[1]) : 1) * Math.PI;
  return null;
}

function parseTrigPhase(compact: string, fnName: "sin" | "cos"): number {
  const fnPattern = fnName === "sin" ? String.raw`(?:\\sin|sin)` : String.raw`(?:\\cos|cos)`;
  const argMatch = new RegExp(`${fnPattern}\\(([^)]*)\\)`).exec(compact);
  if (!argMatch) return 0;
  const arg = argMatch[1];
  const phaseMatch = arg.match(/x(\+|-)(.+)$/);
  if (!phaseMatch) return 0;
  const value = parsePiValue(phaseMatch[2]) ?? Number(phaseMatch[2]);
  if (!Number.isFinite(value)) return 0;
  return phaseMatch[1] === "-" ? -value : value;
}

function parseTrigAmplitude(compact: string, fnName: "sin" | "cos"): number {
  const fnPattern = fnName === "sin" ? String.raw`(?:\\sin|sin)` : String.raw`(?:\\cos|cos)`;
  const match = new RegExp(fnPattern).exec(compact);
  if (match) {
    const previous = compact.slice(0, match.index).replace(/[a-z]\([^)]*\)=|[a-z]=/g, "");
    if (previous.endsWith("-")) return -1;
  }
  return 1;
}

function trigFunctionFromLatex(latex: string): { kind: "sine" | "cosine"; params: { a: number; b: number; c: number; d: number }; compound: boolean } | null {
  const compact = String(latex || "")
    .toLowerCase()
    .replace(/\\?left|\\?right/g, "")
    .replace(/\s+/g, "");
  const hasSin = /(?:\\sin|sin)/.test(compact);
  const hasCos = /(?:\\cos|cos)/.test(compact);
  if (!hasSin && !hasCos) return null;

  // This family only models a single trig term (optionally phase-shifted)
  // applied directly to x, or the classic a*sin(x)±b*cos(x) two-term combo.
  // `\tan`/`\cot`/`\sec`/`\csc` — or anything else genuinely compound, like
  // `x\tan x - \cos x` — can't be represented by it; bail out to the general
  // compound-trig numeric sampler instead of silently misrendering it as a
  // plain sine/cosine wave (a real observed failure: `x\tan x - \cos x` was
  // misread as `a=-1` for a bare `-\cos x`, discarding the `x\tan x` term
  // entirely and producing a bounded curve with no asymptotes at all).
  if (/\\tan|\\cot|\\sec|\\csc/.test(compact)) return null;

  // The sin±cos combo regexes below are a flat scan for "\sin ... (+|-) ...
  // \cos" anywhere in the string — they don't understand LaTeX nesting, so
  // they can match across an unrelated \frac{}{} or \sqrt{}{} boundary (a
  // real observed failure: `\frac{2x-\sin x}{\sqrt{1-\cos x}}` — a "-"
  // that's actually part of "1-\cos x" *inside the sqrt in the
  // denominator* — matched as if it combined the numerator's `\sin x` and
  // that `\cos x` into a single phase-shifted sinusoid, producing a
  // completely fabricated `y=√2·sin(x-π/4)` for a function that isn't a
  // sinusoid at all). Skip combo detection whenever `\frac`/`\sqrt` is
  // present — leave those to the single-term check below (which will
  // reject them too, correctly, via its own "nothing but an optional sign
  // precedes the call" check) or the general compound-trig sampler.
  if (!/\\frac|\\sqrt/.test(compact)) {
    const sinBeforeCos = /(?:\\sin|sin)[^+\-]*(\+|-)(?:\\cos|cos)/.exec(compact);
    if (sinBeforeCos) {
      return {
        kind: "sine",
        params: {
          a: Math.SQRT2,
          b: 1,
          c: sinBeforeCos[1] === "-" ? -Math.PI / 4 : Math.PI / 4,
          d: 0,
        },
        compound: true,
      };
    }

    const cosBeforeSin = /(?:\\cos|cos)[^+\-]*(\+|-)(?:\\sin|sin)/.exec(compact);
    if (cosBeforeSin) {
      return {
        kind: "cosine",
        params: {
          a: Math.SQRT2,
          b: 1,
          c: cosBeforeSin[1] === "-" ? Math.PI / 4 : -Math.PI / 4,
          d: 0,
        },
        compound: true,
      };
    }
  }

  // Verify nothing besides an optional "y="/"f(x)=" prefix and an optional
  // leading sign precedes the trig call — anything else left over (like the
  // "x" in "x\cos x") means a factor is multiplying the trig term, which
  // `parseTrigAmplitude`'s "ends with -" heuristic would otherwise silently
  // misread as a plain -1 amplitude.
  const fnPattern = hasSin ? String.raw`(?:\\sin|sin)` : String.raw`(?:\\cos|cos)`;
  const fnMatch = new RegExp(fnPattern).exec(compact);
  if (fnMatch) {
    const before = compact.slice(0, fnMatch.index).replace(/^[a-z]\([a-z]\)=|^[a-z]=/, "");
    if (before !== "" && before !== "-") return null;
  }

  return hasSin
    ? { kind: "sine", params: { a: parseTrigAmplitude(compact, "sin"), b: 1, c: parseTrigPhase(compact, "sin"), d: 0 }, compound: false }
    : { kind: "cosine", params: { a: parseTrigAmplitude(compact, "cos"), b: 1, c: parseTrigPhase(compact, "cos"), d: 0 }, compound: false };
}

function defaultTrigWaveXTicks(): Array<{ value: number; label: string; major?: boolean }> {
  return [
    { value: 0, label: "0" },
    { value: Math.PI / 2, label: "\\pi/2", major: true },
    { value: Math.PI, label: "\\pi" },
    { value: (3 * Math.PI) / 2, label: "3\\pi/2", major: true },
    { value: 2 * Math.PI, label: "2\\pi" },
  ];
}

function defaultTrigWaveYTicks(): Array<{ value: number; label: string; major?: boolean }> {
  return [
    { value: -1, label: "-1" },
    { value: 0, label: "0", major: true },
    { value: 1, label: "1" },
  ];
}

function defaultSineWaveGuideLines(): Array<Record<string, unknown>> {
  return [
    { orientation: "vertical", value: Math.PI / 2, from: 0, to: 1, label: "\\pi/2", color: "focus" },
    { orientation: "vertical", value: (3 * Math.PI) / 2, from: 0, to: -1, label: "3\\pi/2", color: "focus" },
    { orientation: "horizontal", value: 1, from: 0, to: Math.PI / 2, color: "focus" },
    { orientation: "horizontal", value: -1, from: 0, to: (3 * Math.PI) / 2, color: "focus" },
  ];
}

function defaultTrigWaveFeaturePoints(functions: Array<Record<string, unknown>>): Array<{ point: [number, number]; label: string; color: string; closed: boolean }> {
  const fn = functions.find((item) => ["sine", "trig-sine", "cosine", "trig-cosine"].includes(String(item.kind || "")));
  if (!fn) return [];
  const params = fn.params && typeof fn.params === "object" ? fn.params as Record<string, unknown> : {};
  const a = asFiniteNumber(params.a, 1);
  const b = asFiniteNumber(params.b, 1);
  const c = asFiniteNumber(params.c, 0);
  const d = asFiniteNumber(params.d, 0);
  if (Math.abs(a - 1) > 0.0001 || Math.abs(b - 1) > 0.0001 || Math.abs(c) > 0.0001 || Math.abs(d) > 0.0001) return [];
  const kind = String(fn.kind || "");
  if (kind === "sine" || kind === "trig-sine") {
    return [
      { point: [Math.PI / 2, 1], label: "(\\pi/2, 1)", color: "primary", closed: true },
      { point: [(3 * Math.PI) / 2, -1], label: "(3\\pi/2, -1)", color: "primary", closed: true },
    ];
  }
  return [
    { point: [0, 1], label: "(0, 1)", color: "primary", closed: true },
    { point: [Math.PI, -1], label: "(\\pi, -1)", color: "primary", closed: true },
    { point: [2 * Math.PI, 1], label: "(2\\pi, 1)", color: "primary", closed: true },
  ];
}

function formatTrigX(value: number): string {
  const units = value / Math.PI;
  if (Math.abs(value) < 0.0001) return "0";
  const candidates: Array<[number, string]> = [
    [1 / 4, "\\pi/4"],
    [1 / 2, "\\pi/2"],
    [1, "\\pi"],
    [5 / 4, "5\\pi/4"],
    [3 / 2, "3\\pi/2"],
    [2, "2\\pi"],
  ];
  const match = candidates.find(([candidate]) => Math.abs(units - candidate) < 0.0001);
  return match ? match[1] : fmtCoord(value);
}

function formatTrigY(value: number): string {
  if (Math.abs(value) < 0.0001) return "0";
  if (Math.abs(value - 1) < 0.0001) return "1";
  if (Math.abs(value + 1) < 0.0001) return "-1";
  if (Math.abs(value - Math.SQRT2) < 0.0001) return "\\sqrt{2}";
  if (Math.abs(value + Math.SQRT2) < 0.0001) return "-\\sqrt{2}";
  if (Math.abs(value - 2) < 0.0001) return "2";
  if (Math.abs(value + 2) < 0.0001) return "-2";
  return fmtCoord(value);
}

function computedTrigFeaturePoints(fn: Record<string, unknown>, domain: [number, number], range: [number, number]): Array<{ point: [number, number]; label: string; color: string; closed: boolean }> {
  const kind = String(fn.kind || "");
  if (!["sine", "trig-sine", "cosine", "trig-cosine"].includes(kind)) return [];
  const params = fn.params && typeof fn.params === "object" ? fn.params as Record<string, unknown> : {};
  const b = asFiniteNumber(params.b, 1);
  const c = asFiniteNumber(params.c, 0);
  if (Math.abs(b) < 0.0001) return [];

  const domainMin = domain[0] <= 0 && domain[1] >= 2 * Math.PI ? 0 : domain[0];
  const domainMax = domain[0] <= 0 && domain[1] >= 2 * Math.PI ? 2 * Math.PI : domain[1];
  const candidates = new Map<string, number>();
  const addCandidate = (value: number) => {
    if (Number.isFinite(value)) candidates.set(String(Number(value.toFixed(6))), value);
  };
  addCandidate(domainMin);
  addCandidate(domainMax);
  const baseAngles = (kind === "sine" || kind === "trig-sine")
    ? [Math.PI / 2, (3 * Math.PI) / 2]
    : [0, Math.PI, 2 * Math.PI];
  for (let k = -4; k <= 8; k++) {
    for (const angle of baseAngles) {
      const x = (angle + 2 * Math.PI * k - c) / b;
      if (x >= domainMin - 0.0001 && x <= domainMax + 0.0001) {
        addCandidate(Math.abs(x) < 0.0001 ? 0 : x);
      }
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => a - b)
    .map((x) => {
      const y = evalFnAt(fn, x);
      if (!Number.isFinite(y) || y < range[0] - 0.1 || y > range[1] + 0.1) return null;
      return {
        point: [x, y] as [number, number],
        label: `(${formatTrigX(x)}, ${formatTrigY(y)})`,
        color: "primary",
        closed: true,
      };
    })
    .filter((point): point is { point: [number, number]; label: string; color: string; closed: boolean } => point !== null)
    .slice(0, 6);
}

function computedTrigGuideLines(points: Array<{ point: [number, number]; label: string }>): Array<Record<string, unknown>> {
  return points
    .filter((point) => Math.abs(point.point[1]) > 0.9 && Math.abs(point.point[0]) > 0.0001 && Math.abs(point.point[0] - 2 * Math.PI) > 0.0001)
    .slice(0, 4)
    .flatMap((point) => [
      {
        orientation: "vertical",
        value: point.point[0],
        from: 0,
        to: point.point[1],
        label: formatTrigX(point.point[0]),
        color: "focus",
      },
      {
        orientation: "horizontal",
        value: point.point[1],
        from: 0,
        to: point.point[0],
        color: "focus",
      },
    ])
    .slice(0, 8);
}

function fmtCoord(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}

/**
 * Returns the coefficient of the standalone linear (x) term in a compound rational
 * expression like "x + 1/(x-2)" or "2x - 3/(x+1)".
 * Returns 0 when no linear term is present.
 */
function extractLinearCoeff(latex: string): number {
  const clean = String(latex || "")
    .replace(/\s+/g, "")
    .replace(/^(?:[a-zA-Z]\([a-zA-Z]\)|[a-zA-Z])=/, "")
    // Strip \frac{...}{...} sub-expressions before any variable detection.
    // Without this, a variable letter inside a frac's numerator/denominator —
    // or even the "f" in "\frac" itself — gets mistaken for the function's
    // variable (corrupting "\frac" into "\xrac" below) or for a standalone
    // additive linear term. This function only wants to detect a genuine
    // "m·x + ..." term added OUTSIDE a reciprocal, e.g. distinguishing
    // "2x + 3/(x-1)" (m=2) from a single compound fraction like
    // "(x-3)/(x+4)" (m=0 — the whole thing is one rational expression, not
    // a linear term plus a reciprocal).
    .replace(/\\frac\{[^{}]*\}\{[^{}]*\}/g, "");

  // Normalise variable to x
  const v = (clean.match(/[a-zA-Z]/) || ["x"])[0];
  const s = v !== "x" ? clean.split(v).join("x") : clean;

  // Strip all rational sub-expressions (±coeff/(…)) so only the polynomial residual remains
  const residual = s.replace(/[+-]?\d*\.?\d*\/\([^)]+\)/g, "");

  // Look for a bare x term in the residual
  const m = residual.match(/([+-]?\d*\.?\d*)x/);
  if (!m) return 0;
  const c = m[1];
  if (c === "" || c === "+") return 1;
  if (c === "-") return -1;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : 0;
}

function parsePolynomial(latex: string): { a: number; b: number; c: number; d: number } | null {
  let clean = String(latex || "")
    .replace(/\s+/g, "")
    // Strip common LHS prefixes: y=, f(x)=, s(t)=, v(t)=, a(t)=, g(x)=, etc.
    .replace(/^[a-zA-Z]\([a-zA-Z]\)=/, "")
    .replace(/^[a-zA-Z]=/, "");

  if (!clean) return null;

  // This function only understands a bare polynomial — not a rational
  // expression. Without this guard, a whole-expression \frac{P}{Q} (e.g. a
  // quadratic-over-quadratic rational that no other parser recognizes) slips
  // through: "f" from "\frac" gets picked up as the detected variable below,
  // and the coefficient scan that follows walks across BOTH the numerator's
  // and denominator's terms as if they were one polynomial, silently
  // overwriting same-power coefficients left-to-right — so whichever side
  // comes last in the string (the denominator) wins, and the caller ends up
  // plotting Q(x) alone as if it were the whole function.
  if (/\\frac\{[^{}]*\}\{[^{}]*\}/.test(clean)) return null;

  // Detect polynomial variable (first letter in the RHS) and normalize it to 'x'
  const varMatch = clean.match(/[a-zA-Z]/);
  const varName = varMatch ? varMatch[0] : "x";
  if (varName !== "x") {
    clean = clean.split(varName).join("x");
  }

  const matches = clean.matchAll(/([+-]?(?:\d+(?:\.\d+)?)?)(x(?:\^(\d+))?|(?!\d))/g);
  const coefficients = { a: 0, b: 0, c: 0, d: 0 };
  let foundPower = false;

  for (const match of matches) {
    const rawCoeff = match[1];
    const rawVar = match[2];
    const powerStr = match[3];
    
    if (!rawCoeff && !rawVar) continue;
    
    let val = 1;
    if (rawCoeff === "+") val = 1;
    else if (rawCoeff === "-") val = -1;
    else if (rawCoeff) val = parseFloat(rawCoeff);
    
    let power = 0;
    if (rawVar) {
      if (powerStr) {
        power = parseInt(powerStr, 10);
      } else {
        power = 1;
      }
    }
    
    if (power === 3) { coefficients.a = val; foundPower = true; }
    else if (power === 2) { coefficients.b = val; foundPower = true; }
    else if (power === 1) { coefficients.c = val; foundPower = true; }
    else if (power === 0) { coefficients.d = val; foundPower = true; }
  }
  
  return foundPower ? coefficients : null;
}

// NOTE: this used to be three separate bespoke samplers/parsers
// (sampleGenericRationalFromLatex for P(x)/Q(x), sampleSqrtOfPolynomialFromLatex
// for sqrt(Q(x)), sampleCompoundTrigFromLatex for compound trig expressions),
// each written reactively when a specific shape of AI mistake was found. They
// were unified into the one general expression engine below
// (tokenizeMathExpr/parseMathExpr/evalMathAst/sampleExpressionFromLatex) —
// see its own comment for why: three parsers meant three places a new shape
// (a rational function INSIDE a sqrt, a trig function times a rational, ...)
// could still slip through unhandled, when one general AST-based evaluator
// covers all of them at once.

type MathAstNode =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "pi" }
  | { type: "neg"; arg: MathAstNode }
  | { type: "add"; left: MathAstNode; right: MathAstNode }
  | { type: "sub"; left: MathAstNode; right: MathAstNode }
  | { type: "mul"; left: MathAstNode; right: MathAstNode }
  | { type: "div"; left: MathAstNode; right: MathAstNode }
  | { type: "pow"; base: MathAstNode; exp: MathAstNode }
  | { type: "sqrt"; arg: MathAstNode }
  | { type: "func"; name: "sin" | "cos" | "tan"; arg: MathAstNode }
  | { type: "log"; base: number; arg: MathAstNode };

// Tokenizer for the small recursive-descent parser below. Deliberately
// minimal: numbers, single-letter variables (`x`, or any other bare Latin
// letter — e.g. an unknown constant like `a` in "1+ax-\sqrt{1+x}"), `\pi`,
// +-*/^(){}, `\frac`, `\sqrt`, `\sin`/`\cos`/`\tan`, `\log`/`\ln`,
// `\cdot`/`\times`.
// Anything else (an unrecognized command, a stray symbol) fails the whole
// parse rather than guessing.
function tokenizeMathExpr(compact: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < compact.length) {
    const ch = compact[i];
    if (compact.startsWith("\\sin", i)) { tokens.push("sin"); i += 4; continue; }
    if (compact.startsWith("\\cos", i)) { tokens.push("cos"); i += 4; continue; }
    if (compact.startsWith("\\tan", i)) { tokens.push("tan"); i += 4; continue; }
    if (compact.startsWith("\\sqrt", i)) { tokens.push("sqrt"); i += 5; continue; }
    if (compact.startsWith("\\ln", i)) { tokens.push("ln"); i += 3; continue; }
    if (compact.startsWith("\\log", i)) {
      i += 4;
      let base = 10; // bare `\log` (no subscript) defaults to base 10, this codebase's convention
      if (compact[i] === "_") {
        i++;
        if (compact[i] === "{") {
          i++;
          const closeIndex = compact.indexOf("}", i);
          if (closeIndex === -1) return null;
          const parsedBase = Number(compact.slice(i, closeIndex));
          if (!Number.isFinite(parsedBase) || parsedBase <= 0 || parsedBase === 1) return null;
          base = parsedBase;
          i = closeIndex + 1;
        } else if (/[0-9]/.test(compact[i])) {
          let j = i;
          while (j < compact.length && /[0-9]/.test(compact[j])) j++;
          base = Number(compact.slice(i, j));
          i = j;
        } else {
          return null; // unrecognized subscript shape — don't guess
        }
      }
      tokens.push(`log_${base}`);
      continue;
    }
    if (compact.startsWith("\\pi", i)) { tokens.push("pi"); i += 3; continue; }
    if (compact.startsWith("\\cdot", i)) { tokens.push("*"); i += 5; continue; }
    if (compact.startsWith("\\times", i)) { tokens.push("*"); i += 6; continue; }
    if (compact.startsWith("\\frac", i)) { tokens.push("frac"); i += 5; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < compact.length && /[0-9.]/.test(compact[j])) j++;
      tokens.push(compact.slice(i, j));
      i = j;
      continue;
    }
    // A single Latin letter that isn't part of one of the multi-character
    // keywords matched above (those are all checked first via startsWith)
    // is a bare variable — "x" in the overwhelming majority of cases, but
    // for a problem's own equation ("1+ax-\sqrt{1+x}") a second letter
    // (the unknown constant, e.g. "a") legitimately appears too.
    if (/[a-zA-Z]/.test(ch)) { tokens.push(ch); i++; continue; }
    if ("+-*/^(){}".includes(ch)) { tokens.push(ch); i++; continue; }
    return null; // unsupported character/command — don't guess
  }
  return tokens;
}

// Small recursive-descent parser/evaluator for compound trig expressions
// this codebase's closed-form trig family (a single sin/cos term, optionally
// phase-shifted, or a two-term sin±cos combo) can't represent — e.g.
// `x\tan x - \cos x`. Supports +-*/^, `\frac{}{}`, `\pi`, implicit
// multiplication (adjacent factors, e.g. `x\tan x`, `2x`), and `\sin`/`\cos`/
// `\tan` with either a parenthesized/braced argument or (LaTeX convention)
// a bare trailing `x`.
function parseMathExpr(tokens: string[]): MathAstNode | null {
  let pos = 0;
  const peek = () => tokens[pos];
  // Plain `boolean` return types, deliberately not `t is string` type
  // predicates: `t` is already narrowed to `string` by the caller's own
  // `t === undefined` check by the time these run, so a predicate asserting
  // that same type collapses TS's negative-branch narrowing to `never`
  // (Exclude<string, string>) — harmless for callers that only do literal
  // `===` comparisons afterward, but a real compile error the moment a
  // later branch calls a string method (as isLogToken's caller below does).
  const isVarToken = (t: string | undefined): boolean => t !== undefined && /^[a-zA-Z]$/.test(t);
  const isLogToken = (t: string | undefined): boolean => t !== undefined && t.startsWith("log_");
  const atomStart = () => {
    const t = peek();
    return t !== undefined && (
      /^[0-9.]+$/.test(t) || isVarToken(t) || t === "pi" || t === "sin" || t === "cos" || t === "tan"
      || t === "ln" || isLogToken(t)
      || t === "frac" || t === "sqrt" || t === "(" || t === "{"
    );
  };

  function parseExpr(): MathAstNode | null {
    let left = parseTerm();
    if (!left) return null;
    while (peek() === "+" || peek() === "-") {
      const op = tokens[pos++];
      const right = parseTerm();
      if (!right) return null;
      left = op === "+" ? { type: "add", left, right } : { type: "sub", left, right };
    }
    return left;
  }

  function parseTerm(): MathAstNode | null {
    let left = parseUnary();
    if (!left) return null;
    for (;;) {
      if (peek() === "*" || peek() === "/") {
        const op = tokens[pos++];
        const right = parseUnary();
        if (!right) return null;
        left = op === "*" ? { type: "mul", left, right } : { type: "div", left, right };
      } else if (atomStart()) {
        // Implicit multiplication, e.g. "x\tan x" (= x * tan(x)), "2x".
        const right = parseUnary();
        if (!right) return null;
        left = { type: "mul", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): MathAstNode | null {
    if (peek() === "-") { pos++; const arg = parseUnary(); return arg ? { type: "neg", arg } : null; }
    if (peek() === "+") { pos++; return parseUnary(); }
    return parsePow();
  }

  function parsePow(): MathAstNode | null {
    const base = parseAtom();
    if (!base) return null;
    if (peek() === "^") {
      pos++;
      const exp = parseUnary();
      if (!exp) return null;
      return { type: "pow", base, exp };
    }
    return base;
  }

  function parseFuncArg(): MathAstNode | null {
    if (peek() === "(" || peek() === "{") {
      const close = peek() === "(" ? ")" : "}";
      pos++;
      const inner = parseExpr();
      if (!inner || peek() !== close) return null;
      pos++;
      return inner;
    }
    // LaTeX convention: `\cos x` (no braces) applies to just the next atom.
    return parseAtom();
  }

  function parseAtom(): MathAstNode | null {
    const t = peek();
    if (t === undefined) return null;
    if (/^[0-9.]+$/.test(t)) { pos++; return { type: "num", value: Number(t) }; }
    if (isVarToken(t)) { pos++; return { type: "var", name: t }; }
    if (t === "pi") { pos++; return { type: "pi" }; }
    if (t === "sin" || t === "cos" || t === "tan") {
      pos++;
      const arg = parseFuncArg();
      if (!arg) return null;
      return { type: "func", name: t, arg };
    }
    if (t === "ln") {
      pos++;
      const arg = parseFuncArg();
      if (!arg) return null;
      return { type: "log", base: Math.E, arg };
    }
    if (isLogToken(t)) {
      pos++;
      const arg = parseFuncArg();
      if (!arg) return null;
      return { type: "log", base: Number(t.slice(4)), arg };
    }
    if (t === "sqrt") {
      pos++;
      const arg = parseFuncArg();
      if (!arg) return null;
      return { type: "sqrt", arg };
    }
    if (t === "frac") {
      pos++;
      if (peek() !== "{") return null;
      pos++;
      const num = parseExpr();
      if (!num || peek() !== "}") return null;
      pos++;
      if (peek() !== "{") return null;
      pos++;
      const den = parseExpr();
      if (!den || peek() !== "}") return null;
      pos++;
      return { type: "div", left: num, right: den };
    }
    if (t === "(" || t === "{") {
      const close = t === "(" ? ")" : "}";
      pos++;
      const inner = parseExpr();
      if (!inner || peek() !== close) return null;
      pos++;
      return inner;
    }
    return null;
  }

  const result = parseExpr();
  if (!result || pos !== tokens.length) return null;
  return result;
}

// `bindings` maps variable names to values — almost always just `{ x }` for
// diagram sampling, but the final-answer verification pass in
// gemini.service.ts also binds a second name (an unknown constant like `a`)
// to its claimed value. A variable name with no binding evaluates to NaN
// (not 0, not an error) — the same "can't evaluate, don't guess" posture as
// an unparseable expression, so an equation the AI got a stray extra letter
// into still safely fails to verify rather than silently treating that
// letter as zero.
function evalMathAst(node: MathAstNode, bindings: Record<string, number>): number {
  switch (node.type) {
    case "num": return node.value;
    case "var": return bindings[node.name] ?? Number.NaN;
    case "pi": return Math.PI;
    case "neg": return -evalMathAst(node.arg, bindings);
    case "add": return evalMathAst(node.left, bindings) + evalMathAst(node.right, bindings);
    case "sub": return evalMathAst(node.left, bindings) - evalMathAst(node.right, bindings);
    case "mul": return evalMathAst(node.left, bindings) * evalMathAst(node.right, bindings);
    case "div": return evalMathAst(node.left, bindings) / evalMathAst(node.right, bindings);
    case "pow": return Math.pow(evalMathAst(node.base, bindings), evalMathAst(node.exp, bindings));
    case "sqrt": return Math.sqrt(evalMathAst(node.arg, bindings));
    case "func": {
      const argVal = evalMathAst(node.arg, bindings);
      if (node.name === "sin") return Math.sin(argVal);
      if (node.name === "cos") return Math.cos(argVal);
      return Math.tan(argVal);
    }
    case "log": return Math.log(evalMathAst(node.arg, bindings)) / Math.log(node.base);
    default: return Number.NaN;
  }
}

function containsTrigFunc(node: MathAstNode): boolean {
  switch (node.type) {
    case "func": return true;
    case "neg": case "sqrt": return containsTrigFunc(node.arg);
    case "log": return containsTrigFunc(node.arg);
    case "add": case "sub": case "mul": case "div":
      return containsTrigFunc(node.left) || containsTrigFunc(node.right);
    case "pow": return containsTrigFunc(node.base) || containsTrigFunc(node.exp);
    default: return false;
  }
}

function containsVarNamed(node: MathAstNode, name: string): boolean {
  switch (node.type) {
    case "var": return node.name === name;
    case "neg": case "sqrt": return containsVarNamed(node.arg, name);
    case "add": case "sub": case "mul": case "div":
      return containsVarNamed(node.left, name) || containsVarNamed(node.right, name);
    case "pow": return containsVarNamed(node.base, name) || containsVarNamed(node.exp, name);
    case "func": return containsVarNamed(node.arg, name);
    case "log": return containsVarNamed(node.arg, name);
    default: return false;
  }
}

// Strips a leading "y="/"f(x)="-style prefix and normalizes whitespace/
// \left\right — the common first step before tokenizing any latex expression
// in this file.
function stripLatexPrefix(latex: string): string {
  return String(latex || "")
    .replace(/\\left|\\right/g, "")
    .replace(/\s+/g, "")
    .replace(/^(?:[a-zA-Z]\([a-zA-Z]\)=|[a-zA-Z]=)/, "");
}

// Parses a latex expression into the general MathAstNode grammar (numbers,
// `x`, `\pi`, +-*/^, `\frac`, `\sqrt`, `\sin`/`\cos`/`\tan`, `\log`/`\ln`,
// implicit multiplication). Returns null for anything outside that grammar
// (an unrecognized command, mismatched braces, ...) rather than guessing.
//
// This is the ONE place in the codebase that turns a function's own latex
// into numeric ground truth. It replaces what used to be three separate,
// narrower, reactively-written parsers — one for P(x)/Q(x) rationals, one
// for sqrt(Q(x)), one for compound trig expressions — each added only after
// a specific AI mistake shape was found in production. A single general
// expression engine closes off that whole *class* of bug at once (it
// already handles combinations none of the three bespoke parsers could,
// like sqrt of a rational or a trig function times a rational) instead of
// needing a fourth, fifth, sixth bespoke parser every time a new shape
// shows up. See `sampleExpressionFromLatex` and `evaluateLatexAt` for its
// two jobs: sampling a curve, and verifying a single claimed value.
function parseMathExpressionFromLatex(latex: string): MathAstNode | null {
  const compact = stripLatexPrefix(latex);
  const tokens = tokenizeMathExpr(compact);
  if (!tokens || !tokens.length) return null;
  return parseMathExpr(tokens);
}

// Evaluates a function's latex at a single x, or null if the latex can't be
// parsed by the general engine or evaluates to a non-finite result there.
// This is the general-purpose "never trust AI numbers — code evaluates"
// primitive: anywhere a claimed value (a feature point, a sign-table cell,
// a solution's own worked number) needs checking against a function's actual
// formula, this is what does the checking.
export function evaluateLatexAt(latex: string, x: number): number | null {
  const ast = parseMathExpressionFromLatex(latex);
  if (!ast) return null;
  const y = evalMathAst(ast, { x });
  return Number.isFinite(y) ? y : null;
}

// General form of evaluateLatexAt for an expression with more than one
// named variable — e.g. a problem's own equation "1+ax-\sqrt{1+x}" where `a`
// is an unknown constant a solution claims to have solved for. Binds every
// name in `bindings`; any variable in the expression left unbound evaluates
// to NaN rather than being guessed at, so an incomplete binding set safely
// fails to verify instead of silently substituting 0.
export function evaluateLatexWithBindings(latex: string, bindings: Record<string, number>): number | null {
  const ast = parseMathExpressionFromLatex(latex);
  if (!ast) return null;
  const y = evalMathAst(ast, bindings);
  return Number.isFinite(y) ? y : null;
}

// True when `name` genuinely appears as a variable somewhere in `latex`, or
// null if the latex doesn't parse at all. Deliberately AST-based rather than
// a word-boundary regex — LaTeX has no spacing between implicitly-
// multiplied single-letter factors ("ax" tokenizes as two separate
// variables, "a" and "x", not one two-letter identifier), so a regex using
// `(?<![a-z])a(?![a-z])`-style lookarounds would wrongly reject "a" in
// exactly that "ax" case. Used to sanity-check that a claimed constant
// (e.g. from a final answer) is actually part of the equation being
// verified, not an unrelated variable mention.
export function latexReferencesVariable(latex: string, name: string): boolean | null {
  const ast = parseMathExpressionFromLatex(latex);
  if (!ast) return null;
  return containsVarNamed(ast, name);
}

// Numerically samples any expression the general engine can parse: a
// compound rational (P(x)/Q(x)), sqrt of a polynomial, a compound trig
// expression, or any combination — e.g. sqrt of a rational, a trig function
// times x. This is the last-resort ground truth for a function graph whose
// shape doesn't match any of this codebase's closed-form families (see the
// family detectors in normalizeFunctionGraphSpec, which run first and take
// priority — they produce exact closed-form params, which the frontend
// evaluates precisely, rather than a finite interpolated sample).
function sampleExpressionFromLatex(
  latex: string,
  domain: [number, number],
): [number, number][] | null {
  const ast = parseMathExpressionFromLatex(latex);
  if (!ast) return null;

  const [dMin, dMax] = domain;
  if (!Number.isFinite(dMin) || !Number.isFinite(dMax) || dMin >= dMax) return null;

  const SAMPLES = 240; // trig waves + asymptotes need finer resolution than polynomials
  const MAX_ABS_Y = 1e4; // treat very large magnitudes as an asymptote blow-up, not real data
  const points: [number, number][] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = dMin + ((dMax - dMin) * i) / SAMPLES;
    const y = evalMathAst(ast, { x });
    if (!Number.isFinite(y) || Math.abs(y) > MAX_ABS_Y) continue;
    points.push([Number(x.toFixed(6)), Number(y.toFixed(6))]);
  }
  return points.length >= 2 ? points : null;
}

// Linear interpolation over a densely-sampled `points`-kind curve — the
// shared "ask the corrected curve what it actually says at x" primitive
// used to check both feature points and guide lines against a curve that
// was just resampled from latex (see the two call sites below).
function evalPiecewiseLinearCurveAt(points: [number, number][], x: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) {
      if (Math.abs(x1 - x0) < 1e-9) return y0;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return Number.NaN;
}

/**
 * Detect a normal-distribution (Gaussian) PDF in a LaTeX string by looking for
 * a standardisation sub-expression \frac{x - mean}{std}.
 * Returns { mean, std } on success, null otherwise.
 */
function tryParseGaussianLatex(latex: string): { mean: number; std: number } | null {
  const clean = latex.replace(/\s+/g, "");
  // Pattern 1: standardisation form \frac{x-mean}{std}
  const m1 = clean.match(/\\frac\{x[-−](\d+(?:\.\d+)?)\}\{(\d+(?:\.\d+)?)\}/);
  if (m1) {
    const mean = parseFloat(m1[1]);
    const std = parseFloat(m1[2]);
    if (Number.isFinite(mean) && Number.isFinite(std) && std > 0) return { mean, std };
  }
  // Pattern 2: squared form (x-mean)^2 / (2*std^2) e.g. e^{-\frac{(x-70)^2}{2\cdot10^2}}
  const m2 = clean.match(/\(x[-−](\d+(?:\.\d+)?)\)\^(?:2|\{2\})/) ;
  if (m2) {
    const mean = parseFloat(m2[1]);
    // Extract std from the denominator: look for \cdot or \times followed by std^2, or 2std^2
    const stdMatch = clean.match(/(?:\\cdot|\\times|[*·])(\d+(?:\.\d+)?)\^(?:2|\{2\})|[{(]2[*·]?(\d+(?:\.\d+)?)\^(?:2|\{2\})/);
    if (stdMatch) {
      const std = parseFloat(stdMatch[1] ?? stdMatch[2]);
      if (Number.isFinite(mean) && Number.isFinite(std) && std > 0) return { mean, std };
    }
  }
  return null;
}

function sampleGaussian(mean: number, std: number, xMin: number, xMax: number, n = 80): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = xMin + ((xMax - xMin) * i) / (n - 1);
    const z = (x - mean) / std;
    const y = (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
    if (Number.isFinite(y)) pts.push([x, y]);
  }
  return pts;
}

function normalizeFunctionGraphSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const functions = Array.isArray(input.functions) ? [...input.functions] : [];
  const featurePoints = Array.isArray(input.featurePoints) ? [...input.featurePoints] : [];
  
  const rawRegions: unknown[] = [];
  if (Array.isArray(input.shadedRegions)) rawRegions.push(...input.shadedRegions);
  else if (input.shadedRegions && typeof input.shadedRegions === "object") rawRegions.push(input.shadedRegions);
  
  if (Array.isArray(input.shadedRegion)) rawRegions.push(...input.shadedRegion);
  else if (input.shadedRegion && typeof input.shadedRegion === "object") rawRegions.push(input.shadedRegion);
  
  if (Array.isArray(input.fillRegions)) rawRegions.push(...input.fillRegions);
  else if (input.fillRegions && typeof input.fillRegions === "object") rawRegions.push(input.fillRegions);
  
  if (Array.isArray(input.fillRegion)) rawRegions.push(...input.fillRegion);
  else if (input.fillRegion && typeof input.fillRegion === "object") rawRegions.push(input.fillRegion);

  if (Array.isArray(input.segments) && input.segments.length > 0) {
    const pieces = input.segments.map((seg) => {
      if (!seg || typeof seg !== "object") return null;
      const s = seg as Record<string, unknown>;
      const start = asPoint(s.start);
      const end = asPoint(s.end);
      if (!start || !end) return null;
      const [x1, y1] = start;
      const [x2, y2] = end;
      const dx = x2 - x1;
      let m = 0;
      let b = y1;
      if (Math.abs(dx) > 0.0001) {
        m = (y2 - y1) / dx;
        b = y1 - m * x1;
      }

      if (s.closedStart !== undefined) {
        featurePoints.push({
          point: start,
          closed: s.closedStart === true || String(s.closedStart).toLowerCase().includes("closed"),
        });
      }
      if (s.closedEnd !== undefined) {
        featurePoints.push({
          point: end,
          closed: s.closedEnd === true || String(s.closedEnd).toLowerCase().includes("closed"),
        });
      }

      return {
        domain: [x1, x2],
        function: {
          kind: "linear",
          params: { m, b }
        }
      };
    }).filter(Boolean);

    if (pieces.length > 0) {
      functions.push({
        kind: "piecewise",
        pieces: pieces,
      });
    }
  }

  const normalizedFunctions = functions
    .map((fn) => {
      if (!fn || typeof fn !== "object") return null;
      const item = fn as Record<string, unknown>;
      let kind = String(item.kind || "").trim();
      if (kind === "line") kind = "linear";

      let params = item.params && typeof item.params === "object" ? item.params : undefined;
      const latex = String(item.latex || item.label || "").slice(0, 80);

      // A function's `latex` should be a bare function definition (`y=...`,
      // `f(x)=...`, or just the expression) — never a full `\lim_{x\to a}...`
      // statement. Unlike most content bugs, this one doesn't need the
      // original problem text to catch: a `\lim` inside a function's own
      // latex is a self-contained red flag that whatever `kind`/`params`/
      // `points` came with it are unverifiable (a real observed case: the
      // AI supplied `kind:"cubic"`, `latex:"\lim_{x\to0}\frac{x^3-x\sin
      // x}{x-\sin^2x}"`, and `points` that traced out plain `y=x^3` — just
      // the numerator's leading term, discarding everything else about the
      // actual function under the limit). Drop it outright.
      if (/\\lim/.test(latex)) {
        warnings.push("dropped-lim-expression-as-latex");
        if (functions.length === 1) warnings.push("empty-function-graph");
        return null;
      }

      const trigFromLatex = trigFunctionFromLatex(latex);

      if (trigFromLatex) {
        const matchingKind = (trigFromLatex.kind === "sine" && ["sine", "trig-sine"].includes(kind))
          || (trigFromLatex.kind === "cosine" && ["cosine", "trig-cosine"].includes(kind));
        const previousParams = params && typeof params === "object" ? params as Record<string, unknown> : {};
        const parsedDiffers = Math.abs(asFiniteNumber(previousParams.a, trigFromLatex.params.a) - trigFromLatex.params.a) > 0.0001
          || Math.abs(asFiniteNumber(previousParams.b, trigFromLatex.params.b) - trigFromLatex.params.b) > 0.0001
          || Math.abs(asFiniteNumber(previousParams.c, trigFromLatex.params.c) - trigFromLatex.params.c) > 0.0001
          || Math.abs(asFiniteNumber(previousParams.d, trigFromLatex.params.d) - trigFromLatex.params.d) > 0.0001;
        if (trigFromLatex.compound || !matchingKind || parsedDiffers) {
          warnings.push(`function-kind-corrected:${kind || "missing"}:${trigFromLatex.compound ? "compound-trig" : trigFromLatex.kind}`);
          kind = trigFromLatex.kind;
          params = trigFromLatex.params;
        }
      }

      const inverseSquareFromLatex = simpleInverseSquareParamsFromLatex(latex);
      if (inverseSquareFromLatex) {
        kind = "inverse-square";
        params = {
          ...(params && typeof params === "object" ? params as Record<string, unknown> : {}),
          ...inverseSquareFromLatex,
          verticalAsymptote: inverseSquareFromLatex.h,
          horizontalAsymptote: inverseSquareFromLatex.k,
        };
      }
      const rationalEvenFromLatex = simpleRationalEvenParamsFromLatex(latex);
      if (rationalEvenFromLatex) {
        kind = "rational-even";
        params = rationalEvenFromLatex;
      }
      const reciprocalFromLatex = simpleReciprocalParamsFromLatex(latex);
      if (reciprocalFromLatex) {
        kind = "rational-reciprocal";
        params = {
          ...(params && typeof params === "object" ? params as Record<string, unknown> : {}),
          a: reciprocalFromLatex.a,
          h: reciprocalFromLatex.h,
          k: reciprocalFromLatex.k,
          verticalAsymptote: reciprocalFromLatex.h,
          horizontalAsymptote: reciprocalFromLatex.k,
        };
      }
      // Compound linear-over-linear rationals, e.g. (x-3)/(4+x) — the AI
      // frequently gets `a`/`h` right here but omits `k` (or gets it wrong),
      // since it requires doing the polynomial division correctly. The latex
      // is ground truth, so derive a/h/k from it deterministically and
      // override whatever params the AI supplied rather than trusting them.
      const compoundReciprocalFromLatex = !reciprocalFromLatex ? compoundReciprocalParamsFromLatex(latex) : null;
      if (compoundReciprocalFromLatex) {
        kind = "rational-reciprocal";
        params = {
          ...(params && typeof params === "object" ? params as Record<string, unknown> : {}),
          a: compoundReciprocalFromLatex.a,
          h: compoundReciprocalFromLatex.h,
          k: compoundReciprocalFromLatex.k,
          verticalAsymptote: compoundReciprocalFromLatex.h,
          horizontalAsymptote: compoundReciprocalFromLatex.k,
        };
      }

      if (!params && latex) {
        const poly = parsePolynomial(latex);
        if (poly) {
          if (poly.a !== 0) {
            kind = "cubic";
            params = poly;
          } else if (poly.b !== 0) {
            kind = "quadratic";
            params = { a: poly.b, b: poly.c, c: poly.d };
          } else if (poly.c !== 0 || poly.d !== 0) {
            kind = "linear";
            params = { m: poly.c, b: poly.d };
          }
        }
      }

      // Normalize vertex-form quadratic params {a, h, k} → standard form {a, b, c}.
      // The evaluator (evalFnAt) expects a·x² + b·x + c; h/k are unknown to it.
      if (kind === "quadratic" && params && typeof params === "object") {
        const p = params as Record<string, unknown>;
        if (!("b" in p) && !("c" in p) && ("h" in p || "k" in p)) {
          const a = asFiniteNumber(p.a, 1);
          const h = asFiniteNumber(p.h, 0);
          const k = asFiniteNumber(p.k, 0);
          params = { a, b: -2 * a * h, c: a * h * h + k };
        }
      }

      let domain = Array.isArray(item.domain)
        ? [asFiniteNumber(item.domain[0], -Number.MAX_VALUE), asFiniteNumber(item.domain[1], Number.MAX_VALUE)]
        : undefined;

      // A piecewise function's own latex sometimes carries its domain
      // restriction as free text rather than a structured `domain` field —
      // e.g. "y = 2x + 1 \quad (x \ge 0)" for one half of a jump-
      // discontinuity graph. Without an explicit `domain`, the renderer
      // draws the full line across the whole graph instead of just this
      // piece's ray, overlapping the other half entirely — a real observed
      // case: two half-lines of a jump discontinuity (both slope 2, one
      // "(x \ge 0)" and one "(x < 0)"), rendered as two full parallel lines
      // spanning the entire x-axis instead of two rays split at x=0. Parse
      // a simple `(x OP N)` restriction out of the latex and use it as this
      // function's domain, clamped to the graph's own overall domain.
      if (!domain && latex) {
        const restrictionMatch = latex.match(/\(\s*x\s*(\\ge|\\geq|\\gt|\\leq|\\le|\\lt|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*\)/);
        if (restrictionMatch) {
          const bound = Number(restrictionMatch[2]);
          if (Number.isFinite(bound)) {
            const specDomain: [number, number] = Array.isArray(input.domain) && input.domain.length === 2
              ? [asFiniteNumber(input.domain[0], -10), asFiniteNumber(input.domain[1], 10)]
              : [-10, 10];
            const isLowerBound = ["\\ge", "\\geq", "\\gt", ">=", ">"].includes(restrictionMatch[1]);
            domain = isLowerBound ? [bound, specDomain[1]] : [specDomain[0], bound];
          }
        }
      }

      if (kind === "segment") {
        kind = "linear";
        const start = asPoint(item.start);
        const end = asPoint(item.end);
        if (start && end) {
          const [x1, y1] = start;
          const [x2, y2] = end;
          const dx = x2 - x1;
          let m = 0;
          let b = y1;
          if (Math.abs(dx) > 0.0001) {
            m = (y2 - y1) / dx;
            b = y1 - m * x1;
          }
          params = { m, b };
          domain = [x1, x2];
        }
      }

      let points = Array.isArray(item.points) ? item.points.map(asPoint).filter(Boolean).slice(0, 80) : [];

      // The single, general "never trust AI-computed numbers over the
      // function's own latex" pass. Replaces what used to be three separate
      // bespoke overrides (a bare-sqrt-of-polynomial sampler, a
      // compound-trig sampler, a P(x)/Q(x) rational sampler), each added
      // reactively for one observed shape of AI mistake. Two situations
      // trigger a full resample from latex here, replacing whatever
      // kind/params/points came before:
      //  1. No recognized, evaluable closed-form kind is assigned (kind is
      //     "points", empty, or some other/AI-invented label) — there is no
      //     ground truth other than evaluating the latex directly (e.g.
      //     `x\tan x - \cos x`, `\sqrt{25-x^2}`, `(x^2-16)/(x^2-3x+4)`, or
      //     an AI-supplied `points` array that's simply wrong or doesn't
      //     cover the declared domain).
      //  2. A recognized, evaluable closed-form kind IS assigned, but its
      //     own evaluator (evalFnAt) disagrees with the latex at real
      //     sample points — i.e. the AI classified the shape correctly but
      //     computed wrong numbers for it (a fabricated quadratic/cubic
      //     coefficient is the general case this closes off, beyond any one
      //     bug already found and fixed one at a time).
      // "piecewise" is exempted: it has no `params`-based evaluator (it uses
      // `pieces` instead) and is genuinely out of scope here.
      if (kind !== "piecewise" && latex) {
        const domainForSampling: [number, number] = Array.isArray(domain) && Number.isFinite(domain[0]) && Number.isFinite(domain[1])
          ? domain as [number, number]
          : Array.isArray(input.domain) && input.domain.length === 2
            ? [asFiniteNumber(input.domain[0], -10), asFiniteNumber(input.domain[1], 10)]
            : [-10, 10];
        const ast = parseMathExpressionFromLatex(latex);
        if (ast) {
          const isEvaluableClosedForm = kind !== "points" && EVALUATABLE_CLOSED_FORM_KINDS.has(kind) && params && typeof params === "object";
          let shouldResampleFromLatex = true;
          if (isEvaluableClosedForm) {
            const [dMin, dMax] = domainForSampling;
            let mismatchCount = 0;
            let checkedCount = 0;
            for (let i = 1; i <= 4; i++) {
              const x = dMin + ((dMax - dMin) * i) / 5;
              const claimed = evalFnAt({ kind, params } as Record<string, unknown>, x);
              const truth = evalMathAst(ast, { x });
              if (!Number.isFinite(truth)) continue; // e.g. near an asymptote the closed form also has
              checkedCount++;
              const tolerance = Math.max(0.05, Math.abs(truth) * 0.02);
              if (!Number.isFinite(claimed) || Math.abs(claimed - truth) > tolerance) mismatchCount++;
            }
            // A strict majority of checkable samples disagreeing counts as a
            // genuine mismatch. This used to require *every* sample to
            // disagree, but the 4 fixed sample points (evenly spaced across
            // the domain) can coincide exactly with a root of
            // (claimed-truth) purely by chance — a real observed case: kind
            // "sine" params {a:1,b:1,c:0,d:0} (i.e. plain sin x) claimed for
            // latex "sin x - x + 1" over domain [-1,4]. Those two agree
            // exactly at x=1 (where "-x+1"=0), which is exactly one of the 4
            // sample points, so only 3 of 4 disagreed — not unanimous, so
            // the wrong closed-form params survived uncorrected. A strict
            // majority still protects the original intent (a single stray
            // disagreement, e.g. floating-point noise right at a shared
            // asymptote, is a minority and won't trigger) while closing this
            // gap.
            shouldResampleFromLatex = checkedCount > 0 && mismatchCount > checkedCount / 2;
          }
          if (shouldResampleFromLatex) {
            const sampled = sampleExpressionFromLatex(latex, domainForSampling);
            if (sampled) {
              const tag = containsTrigFunc(ast) ? "compound-trig-expr" : ast.type === "sqrt" ? "sqrt-of-polynomial" : "expression-sampled";
              warnings.push(`function-kind-corrected:${kind || "missing"}:${tag}`);
              kind = "points";
              params = undefined;
              points = sampled;
            }
          }
        }
      }

      // Never trust AI-supplied sample points for asymptotic rational-function
      // families, even outside the protected reciprocal-interval/inverse-square/
      // rational-even templates — these curves (near-asymptote blowups sampled
      // across ~80 points) are exactly the shape LLMs get individually wrong most
      // often, while the closed-form params (a, h, k/b) are trivial to evaluate
      // correctly. Discard whatever points were given whenever params are usable;
      // FunctionGraphDiagram.js already computes the curve from params directly
      // when points is empty, so this is a safe no-op for rendering, not a
      // regression risk.
      if (RATIONAL_ASYMPTOTIC_KINDS.has(kind) && params && typeof params === "object") {
        const p = params as Record<string, unknown>;
        const a = asFiniteNumber(p.a, Number.NaN);
        const h = asFiniteNumber((p.h ?? p.verticalAsymptote) as number, Number.NaN);
        const bOk = kind !== "rational-even" || Number.isFinite(asFiniteNumber(p.b, Number.NaN));
        if (Number.isFinite(a) && Number.isFinite(h) && bOk) {
          if (points.length) warnings.push(`discarded-unverified-points:${kind}`);
          points = [];
        }
      }

      let pieces = undefined;
      if (kind === "piecewise" && Array.isArray(item.pieces)) {
        pieces = item.pieces
          .map((piece) => {
            if (!piece || typeof piece !== "object") return null;
            const p = piece as Record<string, unknown>;
            const domain = Array.isArray(p.domain)
              ? [asFiniteNumber(p.domain[0], -Number.MAX_VALUE), asFiniteNumber(p.domain[1], Number.MAX_VALUE)]
              : [-Number.MAX_VALUE, Number.MAX_VALUE];
            
            let fnObj: Record<string, unknown> = {};
            if (p.function && typeof p.function === "object") {
              fnObj = p.function as Record<string, unknown>;
            } else if (typeof p.function === "string") {
              const str = p.function.trim().replace(/\s+/g, "");
              const match = str.match(/^(?:y|f\(x\))=(-?\d+(?:\.\d+)?)$/) || str.match(/^(-?\d+(?:\.\d+)?)$/);
              if (match) {
                fnObj = {
                  kind: "linear",
                  params: {
                    m: 0,
                    b: parseFloat(match[1]),
                  }
                };
              }
            }

            let fnKind = String(fnObj.kind || "").trim();
            if (fnKind === "line") fnKind = "linear";

            const fnParams = fnObj.params && typeof fnObj.params === "object" ? fnObj.params : undefined;
            if (!["linear", "quadratic", "cubic", "absolute-value", "rational-reciprocal", "inverse-square", "rational-even", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine"].includes(fnKind)) return null;
            return {
              domain,
              function: {
                kind: fnKind,
                params: fnParams,
              }
            };
          })
          .filter(Boolean);
      }

      const KNOWN_KINDS = ["linear", "quadratic", "cubic", "absolute-value", "rational-reciprocal", "inverse-square", "rational-even", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine", "piecewise"];
      if (!points.length && !KNOWN_KINDS.includes(kind)) {
        // Explicit normal-distribution kind with params { mean, stdDev/std/sigma }
        let gauss: { mean: number; std: number } | null = null;
        if (kind === "normal-distribution" && params && typeof params === "object") {
          const p = params as Record<string, unknown>;
          const mean = asFiniteNumber(p.mean as number, Number.NaN);
          const std = asFiniteNumber((p.stdDev ?? p.std ?? p.sigma ?? p.standardDeviation) as number, Number.NaN);
          if (Number.isFinite(mean) && Number.isFinite(std) && std > 0) gauss = { mean, std };
        }
        // Fall back: detect and sample a gaussian bell curve from the latex
        if (!gauss) gauss = tryParseGaussianLatex(latex);
        if (gauss) {
          const rawDom = Array.isArray(item.domain)
            ? [asFiniteNumber(item.domain[0], gauss.mean - 4 * gauss.std), asFiniteNumber(item.domain[1], gauss.mean + 4 * gauss.std)]
            : [gauss.mean - 4 * gauss.std, gauss.mean + 4 * gauss.std];
          const sampledPoints = sampleGaussian(gauss.mean, gauss.std, rawDom[0], rawDom[1]);
          if (sampledPoints.length > 0) {
            return {
              kind: "points",
              // Clear the raw PDF formula — the SVG label renderer can't handle
              // nested fracs and would show garbled text like "frac110sqrt2pi e".
              latex: "",
              points: sampledPoints,
              params: undefined,
              pieces: undefined,
              domain: undefined,
              color: typeof item.color === "string" ? normalizeDiagramColor(item.color) : "primary",
            };
          }
        }
        return null;
      }

      // Guard against a placeholder the AI sometimes emits when it fails to
      // actually work out the function graph — e.g. for a compound rational
      // it couldn't classify, or (a real observed case) for
      // (x²-x·sin x)/(x-sin²x), an L'Hôpital limit problem with no
      // quadratic in sight at all: `kind: "quadratic"` with completely
      // empty `latex` and params with no relationship to the real function
      // (that case: y=x²-x, matching neither the original expression nor
      // its post-L'Hôpital derivative form; an earlier case: the literal
      // "nothing was specified" a=1,b=0,c=0 default). Once latex is empty
      // there is no ground truth left to verify ANY params against — a
      // "quadratic" is not even the right family for most of the trig/limit
      // problems this fires on — so treat any empty-latex quadratic as
      // unverifiable and drop it; that's worse than no diagram.
      if (kind === "quadratic" && !latex && params && typeof params === "object") {
        warnings.push("dropped-placeholder-quadratic");
        // When this placeholder was the AI's only function for the block,
        // also force the whole thing to be treated as empty even if a
        // stray feature point (e.g. this same placeholder's own vertex)
        // survives alongside it — a lone dot with no curve is just as
        // uninformative here as the fake parabola would have been. If
        // other real functions are present, leave the empty-graph decision
        // to the normal functions/feature-points check below.
        if (functions.length === 1) warnings.push("empty-function-graph");
        return null;
      }

      return {
        kind: kind || "points",
        latex,
        simplifiedLatex: typeof item.simplifiedLatex === "string" ? item.simplifiedLatex.slice(0, 80) : undefined,
        points,
        params,
        pieces,
        domain,
        color: typeof item.color === "string" ? normalizeDiagramColor(item.color) : "primary",
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  let normalizedFeaturePoints = featurePoints
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const item = point as Record<string, unknown>;
      const coordinates = asPoint(item.point ?? item.coordinates);
      if (!coordinates) return null;

      let closed = undefined;
      if (typeof item.closed === "boolean") {
        closed = item.closed;
      } else if (typeof item.open === "boolean") {
        closed = !item.open;
      } else {
        const typeStr = String(item.type || item.kind || item.closed || item.open || "").toLowerCase();
        if (typeStr.includes("open")) {
          closed = false;
        } else if (typeStr.includes("closed")) {
          closed = true;
        }
      }

      return {
        point: coordinates,
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: typeof item.color === "string" ? normalizeDiagramColor(item.color) : "primary",
        closed: closed,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  // A feature point the AI computed against its *original* (wrong) kind/
  // params for a function this normalizer just corrected via one of the
  // numeric fallbacks above (sqrt-of-polynomial, compound-trig-expr, generic
  // rational) is now stale — it no longer lies on the corrected curve (a
  // real observed failure: feature points computed from a fabricated
  // `y=√2·sin(x-π/4)` stayed in the spec unchanged after the curve was
  // corrected to the true, unrelated function). Drop any feature point that
  // falls within a densely-sampled `points`-kind function's domain but
  // doesn't actually lie on it — a wrong dot is worse than no dot.
  {
    const sampledCurveFunctions = normalizedFunctions.filter((fn) => {
      const item = fn as Record<string, unknown>;
      return item.kind === "points" && Array.isArray(item.points) && (item.points as unknown[]).length > 15;
    }) as Array<{ points: [number, number][] }>;
    if (sampledCurveFunctions.length) {
      const evalSampledCurveAt = evalPiecewiseLinearCurveAt;
      let droppedStaleFeaturePoint = false;
      normalizedFeaturePoints = normalizedFeaturePoints.filter((point) => {
        const item = point as Record<string, unknown>;
        const coordinates = item.point as [number, number] | undefined;
        if (!Array.isArray(coordinates)) return true;
        const [px, py] = coordinates;
        for (const fn of sampledCurveFunctions) {
          const xs = fn.points.map((p) => p[0]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          if (px < minX || px > maxX) continue;
          const expectedY = evalSampledCurveAt(fn.points, px);
          if (Number.isFinite(expectedY) && Math.abs(expectedY - py) > 0.15) {
            droppedStaleFeaturePoint = true;
            return false;
          }
        }
        return true;
      });
      if (droppedStaleFeaturePoint) warnings.push("dropped-stale-feature-point");
    }
  }

  let resolvedNormalizedFunctions = normalizedFunctions;
  const hasTrigFeaturePoints = normalizedFeaturePoints.some((point) => {
    const item = point as Record<string, unknown>;
    return hasTrigLabel(item.label);
  });
  if (!resolvedNormalizedFunctions.length && hasTrigFeaturePoints) {
    resolvedNormalizedFunctions = [{
      kind: "sine",
      latex: "f(x)=\\sin x",
      points: [],
      params: { a: 1, b: 1, c: 0, d: 0 },
      domain: undefined,
      color: "primary",
    }] as typeof normalizedFunctions;
  }

  // Compute rawDomain early so shaded-region normalization can use it as
  // a fallback when the AI omits "to" or "from" (e.g. "to": null meaning "right tail").
  const rawDomain = Array.isArray(input.domain)
    ? input.domain.slice(0, 2).map((v) => asFiniteNumber(v, 0)) as [number, number]
    : ([-5, 5] as [number, number]);

  const normalizedShadedRegions = rawRegions
    .map((region) => {
      if (!region || typeof region !== "object") return null;
      const item = region as Record<string, unknown>;

      let points: [number, number][] = [];
      if (Array.isArray(item.points)) {
        points = item.points.map(asPoint).filter((p): p is [number, number] => p !== null);
      } else if (Array.isArray(item.vertices)) {
        points = item.vertices.map(asPoint).filter((p): p is [number, number] => p !== null);
      } else if (Array.isArray(item.coordinates)) {
        points = item.coordinates.map(asPoint).filter((p): p is [number, number] => p !== null);
      } else if (Array.isArray(region)) {
        points = (region as unknown[]).map(asPoint).filter((p): p is [number, number] => p !== null);
      }

      let from = asFiniteNumber(item.from ?? item.xMin ?? item.start, rawDomain[0]);
      let to = asFiniteNumber(item.to ?? item.xMax ?? item.end, rawDomain[1]);
      let baseline = asFiniteNumber(item.baseline, 0);
      let functionIndex = Math.max(0, Math.floor(asFiniteNumber(item.functionIndex, 0)));

      if (points.length >= 2) {
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        from = Math.min(...xs);
        to = Math.max(...xs);
        
        // Find the most common Y value as baseline
        const yCounts: Record<number, number> = {};
        let maxCount = 0;
        let mostCommonY = 0;
        for (const y of ys) {
          yCounts[y] = (yCounts[y] || 0) + 1;
          if (yCounts[y] > maxCount) {
            maxCount = yCounts[y];
            mostCommonY = y;
          }
        }
        baseline = mostCommonY;
        functionIndex = 0;
      }

      if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
      const shadingColor = typeof item.color === "string" ? normalizeDiagramColor(item.color) : "primary";
      return {
        from: Math.min(from, to),
        to: Math.max(from, to),
        baseline,
        functionIndex,
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: shadingColor,
      };
    })
    .filter((region): region is {
      from: number;
      to: number;
      baseline: number;
      functionIndex: number;
      label: string | undefined;
      color: string;
    } => region !== null)
    .slice(0, 4);
  if (!resolvedNormalizedFunctions.length && !normalizedFeaturePoints.length) warnings.push("empty-function-graph");

  const rawRange = Array.isArray(input.range)
    ? input.range.slice(0, 2).map((v) => asFiniteNumber(v, 0)) as [number, number]
    : ([-5, 5] as [number, number]);

  // Enhance rational-reciprocal functions that have a compound form (linear + rational).
  // The renderer only draws a/(x-h)+k — if the latex includes an "x" term the AI dropped
  // into params as k, we regenerate accurate sample points for the full expression and
  // suppress the horizontal asymptote label (which is meaningless for oblique asymptotes).
  const normalizedFunctionsEnhanced = resolvedNormalizedFunctions.map((fn) => {
    const f = fn as Record<string, unknown>;
    if (f.kind !== "rational-reciprocal") return fn;
    const lat = String(f.latex || "");
    if (isBasicReciprocalLatex(lat)) return fn;
    if (/^(?:f\(x\)|y)?\s*=?\s*\\?frac\{\s*[+-]?\d+(?:\.\d+)?\s*\}\{\s*x\s*\}\s*$/i.test(lat.replace(/\s+/g, ""))) return fn;
    if (/^(?:f\(x\)|y)?\s*=?\s*[+-]?\d+(?:\.\d+)?\s*\/\s*x\s*$/i.test(lat.replace(/\s+/g, ""))) return fn;
    const m = extractLinearCoeff(lat);
    if (m === 0) return fn; // pure rational — no change needed

    const p = (f.params && typeof f.params === "object" ? f.params : {}) as Record<string, unknown>;
    const a = asFiniteNumber(p.a as number, 1);
    const h = asFiniteNumber(((p.verticalAsymptote ?? p.h) as number | undefined) ?? Number.NaN, 0);
    const k = asFiniteNumber(((p.horizontalAsymptote ?? p.k) as number | undefined) ?? 0, 0);

    // Sample f(x) = m·x + a/(x-h) + k across the full viewport domain
    const [dMin, dMax] = rawDomain;
    const samples: [number, number][] = [];
    const N = 120;
    for (let i = 0; i < N; i++) {
      const x = dMin + ((dMax - dMin) * i) / (N - 1);
      const dx = x - h;
      if (Math.abs(dx) < 0.08) continue; // skip near vertical asymptote
      const y = m * x + a / dx + k;
      if (Number.isFinite(y)) samples.push([x, y]);
    }

    return {
      ...f,
      points: samples,
      // Clear k so the renderer won't draw a spurious horizontal asymptote line
      params: { ...p, k: undefined, horizontalAsymptote: undefined },
    };
  }) as typeof normalizedFunctions;
  const uniqueNormalizedFunctionsEnhanced = normalizedFunctionsEnhanced.filter((fn, index, list) => {
    const item = fn as Record<string, unknown>;
    const kind = String(item.kind || "");
    if (!["sine", "trig-sine", "cosine", "trig-cosine"].includes(kind)) return true;
    const earlierEquivalent = list.slice(0, index).some((previous) => {
      const previousItem = previous as Record<string, unknown>;
      const previousKind = String(previousItem.kind || "");
      if (!["sine", "trig-sine", "cosine", "trig-cosine"].includes(previousKind)) return false;
      const samples = [rawDomain[0], 0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, rawDomain[1]]
        .filter((x, sampleIndex, values) => Number.isFinite(x) && values.indexOf(x) === sampleIndex);
      return samples.length > 0 && samples.every((x) => {
        const y1 = evalFnAt(item, x);
        const y2 = evalFnAt(previousItem, x);
        return Number.isFinite(y1) && Number.isFinite(y2) && Math.abs(y1 - y2) < 0.015;
      });
    });
    if (earlierEquivalent) warnings.push("duplicate-equivalent-trig-function-dropped");
    return !earlierEquivalent;
  }) as typeof normalizedFunctions;

  // When all shaded regions are strictly in the first quadrant (from≥0, baseline≥0),
  // snap the lower bounds to 0 so the viewport focuses on the relevant area, and
  // restrict each function's plotted domain to its shading extent so the line
  // stops at the x-axis intercept rather than dipping below y=0.
  const allShadedFirstQuadrant =
    normalizedShadedRegions.length > 0 &&
    normalizedShadedRegions.every((r) => r.from >= 0 && r.baseline >= 0);

  const hasTrigFunctionSeed = resolvedNormalizedFunctions.some((fn) => {
    const item = fn as Record<string, unknown>;
    return ["sine", "trig-sine", "cosine", "trig-cosine"].includes(String(item.kind || ""))
      || hasTrigLabel(item.latex);
  });
  const shouldExpandTrigDomain = hasTrigFunctionSeed || hasTrigFeaturePoints;
  const resolvedRawDomain: [number, number] = shouldExpandTrigDomain && rawDomain[0] >= 0 && rawDomain[1] <= 2 * Math.PI + 0.2
    ? [-Math.PI / 4, (9 * Math.PI) / 4]
    : rawDomain;

  const domain = allShadedFirstQuadrant
    ? [Math.max(0, resolvedRawDomain[0]), resolvedRawDomain[1]]
    : resolvedRawDomain;
  const range = allShadedFirstQuadrant
    ? [Math.max(0, rawRange[0]), rawRange[1]]
    : rawRange;

  let resolvedFunctions = uniqueNormalizedFunctionsEnhanced;
  if (allShadedFirstQuadrant) {
    // Build per-function shading extents, then clamp each function's domain to them.
    const shadingExtents = new Map<number, [number, number]>();
    for (const r of normalizedShadedRegions) {
      const fi = r.functionIndex;
      const existing = shadingExtents.get(fi);
      shadingExtents.set(fi, existing
        ? [Math.min(existing[0], r.from), Math.max(existing[1], r.to)]
        : [r.from, r.to]);
    }
    resolvedFunctions = uniqueNormalizedFunctionsEnhanced.map((fn, i) => {
      const ext = shadingExtents.get(i);
      if (!ext) return fn;

      // Don't restrict the domain of rational-reciprocal functions whose vertical
      // asymptote falls within the shaded range — that would clip a valid branch.
      // Don't restrict point-sampled functions (e.g. gaussian bell curves) — they
      // need their full pre-sampled x range to render the correct curve shape.
      const f = fn as Record<string, unknown>;
      if (f.kind === "points") return fn;
      if (f.kind === "rational-reciprocal") {
        const p = (f.params && typeof f.params === "object" ? f.params : {}) as Record<string, unknown>;
        const h = asFiniteNumber(((p.verticalAsymptote ?? p.h) as number | undefined) ?? Number.NaN, Number.NaN);
        if (Number.isFinite(h) && h > ext[0] && h <= ext[1]) return fn;
      }

      const fnDomain = Array.isArray(fn.domain) ? fn.domain as [number, number] : null;
      return {
        ...fn,
        domain: fnDomain
          ? [Math.max(ext[0], fnDomain[0]), Math.min(ext[1], fnDomain[1])]
          : ext,
      };
    });
  }

  resolvedFunctions = resolvedFunctions.map((fn) => {
    const item = fn as Record<string, unknown>;
    if (item.kind !== "rational-reciprocal" || !isBasicReciprocalLatex(item.latex)) return fn;
    const parsed = simpleReciprocalParamsFromLatex(item.latex);
    if (!parsed) return fn;
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    return {
      ...item,
      points: [],
      domain: [parsed.h + 0.08, Math.max(parsed.h + 4, rawDomain[1])],
      params: {
        ...params,
        a: parsed.a,
        h: parsed.h,
        k: parsed.k,
        verticalAsymptote: parsed.h,
        horizontalAsymptote: parsed.k,
      },
    };
  }) as typeof normalizedFunctions;
  const simpleReciprocalFunctions = resolvedFunctions.filter((fn) => {
    const item = fn as Record<string, unknown>;
    return item.kind === "rational-reciprocal" && isBasicReciprocalLatex(item.latex);
  });
  if (simpleReciprocalFunctions.length) {
    const reciprocalItem = simpleReciprocalFunctions[0] as Record<string, unknown>;
    const reciprocalParsed = simpleReciprocalParamsFromLatex(reciprocalItem.latex);
    const shadedInterval = normalizedShadedRegions.find((region) => (
      region.functionIndex === 0
      && Number.isFinite(region.from)
      && Number.isFinite(region.to)
      && Math.abs(region.from - region.to) > 0.0001
    ));
    const reciprocalYAt = (x: number) => (
      reciprocalParsed && Math.abs(x - reciprocalParsed.h) > 0.0001
        ? reciprocalParsed.a / (x - reciprocalParsed.h) + reciprocalParsed.k
        : Number.NaN
    );
    const featurePointXs = normalizedFeaturePoints
      .flatMap((point) => {
        const item = point as Record<string, unknown>;
        const coordinates = item.point as [number, number] | undefined;
        if (!Array.isArray(coordinates)) return [];
        const [x, y] = coordinates;
        const expectedY = reciprocalYAt(x);
        return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(expectedY) && Math.abs(expectedY - y) < 0.08
          ? [x]
          : [];
      })
      .filter((x, index, list) => list.findIndex((candidate) => Math.abs(candidate - x) < 0.0001) === index)
      .sort((a, b) => a - b);
    const intervalXs = shadedInterval
      ? [shadedInterval.from, shadedInterval.to].sort((a, b) => a - b)
      : featurePointXs.length >= 2
        ? [featurePointXs[0], featurePointXs[featurePointXs.length - 1]]
        : rawDomain
          .slice(0, 2)
          .map((value) => asFiniteNumber(value, Number.NaN))
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
    const validSecantFunctions = resolvedFunctions.filter((fn) => {
      const item = fn as Record<string, unknown>;
      if (item.kind !== "linear" || intervalXs.length !== 2 || !reciprocalParsed) return false;
      const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
      return intervalXs.every((x) => {
        const y = reciprocalYAt(x);
        const lineY = asFiniteNumber(params.m, 1) * x + asFiniteNumber(params.b, 0);
        return Number.isFinite(y) && Number.isFinite(lineY) && Math.abs(y - lineY) < 0.08;
      });
    });
    resolvedFunctions = [...simpleReciprocalFunctions, ...validSecantFunctions] as typeof normalizedFunctions;
  }
  resolvedFunctions = resolvedFunctions.map((fn) => {
    const item = fn as Record<string, unknown>;
    if (item.kind !== "inverse-square") return fn;
    const parsed = simpleInverseSquareParamsFromLatex(item.latex);
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    const a = parsed?.a ?? asFiniteNumber(params.a, 1);
    const h = parsed?.h ?? asFiniteNumber(params.h ?? params.verticalAsymptote, 0);
    const k = parsed?.k ?? asFiniteNumber(params.k ?? params.horizontalAsymptote, 0);
    return {
      ...item,
      points: [],
      params: {
        ...params,
        a,
        h,
        k,
        p: 2,
        verticalAsymptote: h,
        horizontalAsymptote: k,
      },
    };
  }) as typeof normalizedFunctions;

  // Auto-inject triangle vertex featurePoints for first-quadrant shaded regions
  // so students see labeled dots at (from, baseline), (to, baseline), (from, f(from)).
  let resolvedFeaturePoints = normalizedFeaturePoints;
  if (allShadedFirstQuadrant && normalizedFeaturePoints.length === 0) {
    const vertexSet = new Map<string, { point: [number, number]; label: string; color: string; closed: boolean }>();
    for (const r of normalizedShadedRegions) {
      const fn = normalizedFunctionsEnhanced[r.functionIndex] as Record<string, unknown> | undefined;
      const yAtFrom = fn ? evalFnAt(fn, r.from) : Number.NaN;
      const hasCurvePoint = Number.isFinite(yAtFrom) && yAtFrom !== r.baseline;
      const candidates: Array<[number, number]> = [
        // Skip (from, baseline) when there's already a curve point at x=from — it's redundant
        ...(hasCurvePoint ? [] : [[r.from, r.baseline] as [number, number]]),
        [r.to, r.baseline],
        ...(hasCurvePoint ? [[r.from, yAtFrom] as [number, number]] : []),
      ];
      for (const [vx, vy] of candidates) {
        const key = `${vx}_${vy}`;
        if (!vertexSet.has(key)) {
          vertexSet.set(key, {
            point: [vx, vy],
            label: `(${fmtCoord(vx)}, ${fmtCoord(vy)})`,
            color: "primary",
            closed: true,
          });
        }
      }
    }
    resolvedFeaturePoints = Array.from(vertexSet.values());
  }

  const normalizeTick = (tick: unknown) => {
    if (typeof tick === "number" || typeof tick === "string") {
      const value = asFiniteNumber(tick, Number.NaN);
      return Number.isFinite(value) ? { value } : null;
    }
    if (!tick || typeof tick !== "object") return null;
    const item = tick as Record<string, unknown>;
    const value = asFiniteNumber(item.value, Number.NaN);
    if (!Number.isFinite(value)) return null;
    return {
      value,
      label: typeof item.label === "string" ? item.label.slice(0, 32) : undefined,
      major: item.major === true,
    };
  };

  const normalizeGuideLine = (guide: unknown) => {
    if (!guide || typeof guide !== "object") return null;
    const item = guide as Record<string, unknown>;
    const orientation = String(item.orientation || item.axis || "").toLowerCase();
    const value = asFiniteNumber(item.value, Number.NaN);
    if (!Number.isFinite(value) || !["vertical", "horizontal", "x", "y"].includes(orientation)) return null;
    const from = asFiniteNumber(item.from, Number.NaN);
    const to = asFiniteNumber(item.to, Number.NaN);
    const normalizedOrientation = orientation === "x" ? "vertical" : orientation === "y" ? "horizontal" : orientation;
    return {
      orientation: normalizedOrientation,
      value,
      from: Number.isFinite(from) ? from : undefined,
      to: Number.isFinite(to) ? to : undefined,
      label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
      color: typeof item.color === "string" ? normalizeDiagramColor(item.color) : "primary",
    };
  };

  const xTicks = Array.isArray(input.xTicks)
    ? input.xTicks.map(normalizeTick).filter(Boolean).slice(0, 12)
    : undefined;
  const yTicks = Array.isArray(input.yTicks)
    ? input.yTicks.map(normalizeTick).filter(Boolean).slice(0, 12)
    : undefined;
  const guideLineInputs = [
    ...(Array.isArray(input.guideLines) ? input.guideLines : []),
    ...(Array.isArray(input.referenceLines) ? input.referenceLines : []),
  ];
  const rawGuideLines = guideLineInputs.map(normalizeGuideLine).filter(Boolean).slice(0, 10);

  // Same "stale after a curve correction" problem as feature points above,
  // for the same reason: a guide line's (value, to) pair is this codebase's
  // convention for marking a specific point on the curve (a peak, a shared
  // value at a given x) — e.g. a real observed case, a vertical/horizontal
  // guide-line pair marking (pi/2, 1) as the peak of what the AI labeled
  // "sine" params (plain sin x), left in place unchanged after the curve
  // was corrected to its true latex, sin x - x + 1, whose value at pi/2 is
  // actually ~0.43, not 1. Drop any guide line whose implied curve point
  // falls within a densely-sampled `points`-kind function's domain but
  // doesn't actually lie on it.
  const sampledCurveFunctionsForGuideLines = resolvedFunctions.filter((fn) => {
    const item = fn as Record<string, unknown>;
    return item.kind === "points" && Array.isArray(item.points) && (item.points as unknown[]).length > 15;
  }) as Array<{ points: [number, number][] }>;
  const guideLines = sampledCurveFunctionsForGuideLines.length
    ? rawGuideLines.filter((guide) => {
      const item = guide as Record<string, unknown>;
      const to = item.to as number | undefined;
      if (to === undefined || !Number.isFinite(to)) return true; // nothing to check against
      const value = item.value as number;
      const [claimedX, claimedY] = item.orientation === "vertical" ? [value, to] : [to, value];
      for (const fn of sampledCurveFunctionsForGuideLines) {
        const xs = fn.points.map((p) => p[0]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        if (claimedX < minX || claimedX > maxX) continue;
        const expectedY = evalPiecewiseLinearCurveAt(fn.points, claimedX);
        if (Number.isFinite(expectedY) && Math.abs(expectedY - claimedY) > 0.15) return false;
      }
      return true;
    })
    : rawGuideLines;
  const hasTrigFunction = resolvedFunctions.some((fn) => {
    const item = fn as Record<string, unknown>;
    return ["sine", "trig-sine", "cosine", "trig-cosine"].includes(String(item.kind || ""))
      || hasTrigLabel(item.latex);
  });
  const hasBasicReciprocalFunction = resolvedFunctions.some((fn) => {
    const item = fn as Record<string, unknown>;
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    const parsed = simpleReciprocalParamsFromLatex(item.latex);
    return item.kind === "rational-reciprocal"
      && parsed
      && Math.abs(asFiniteNumber(params.a, parsed.a) - parsed.a) < 0.0001
      && Math.abs(asFiniteNumber(params.h ?? params.verticalAsymptote, parsed.h) - parsed.h) < 0.0001
      && Math.abs(asFiniteNumber(params.k ?? params.horizontalAsymptote, parsed.k) - parsed.k) < 0.0001;
  });
  const hasInverseSquareFunction = resolvedFunctions.some((fn) => {
    const item = fn as Record<string, unknown>;
    return item.kind === "inverse-square";
  });
  const hasOriginReciprocalFunction = resolvedFunctions.some((fn) => {
    const item = fn as Record<string, unknown>;
    const params = item.params && typeof item.params === "object" ? item.params as Record<string, unknown> : {};
    const parsed = simpleReciprocalParamsFromLatex(item.latex);
    return item.kind === "rational-reciprocal"
      && parsed
      && Math.abs(asFiniteNumber(params.a, parsed.a) - parsed.a) < 0.0001
      && Math.abs(asFiniteNumber(params.h ?? params.verticalAsymptote, 0)) < 0.0001
      && Math.abs(asFiniteNumber(params.k ?? params.horizontalAsymptote, 0)) < 0.0001;
  });
  const requestedGraphStyle = String(input.graphStyle || input.template || "");
  const requestedDiagramIntent = String(input.diagramIntent || "");
  const diagramIntent = ["interval-points", "secant-interval", "shaded-interval"].includes(requestedDiagramIntent)
    ? requestedDiagramIntent
    : undefined;
  const graphStyle = requestedGraphStyle === "removable-rational"
      ? "removable-rational"
    : requestedGraphStyle === "reciprocal-interval" || hasOriginReciprocalFunction
      ? "reciprocal-interval"
    : hasBasicReciprocalFunction || hasInverseSquareFunction
      ? undefined
    : ["trig-wave", "textbook-wave"].includes(requestedGraphStyle) || hasTrigFunction || hasTrigFeaturePoints
      ? "trig-wave"
    : undefined;
  const primaryTrigFunction = graphStyle === "trig-wave"
    ? resolvedFunctions.find((fn) => {
      const item = fn as Record<string, unknown>;
      return ["sine", "trig-sine", "cosine", "trig-cosine"].includes(String(item.kind || ""));
    }) as Record<string, unknown> | undefined
    : undefined;
  const computedTrigPoints = primaryTrigFunction ? computedTrigFeaturePoints(primaryTrigFunction, domain as [number, number], range as [number, number]) : [];
  const computedGuideLines = computedTrigGuideLines(computedTrigPoints);
  if (graphStyle === "trig-wave") {
    const hasMismatchedTrigFeaturePoint = resolvedFeaturePoints.some((point) => {
      const item = point as Record<string, unknown>;
      const coordinates = item.point as [number, number] | undefined;
      if (!primaryTrigFunction || !Array.isArray(coordinates)) return false;
      const expectedY = evalFnAt(primaryTrigFunction, coordinates[0]);
      return Number.isFinite(expectedY) && Math.abs(expectedY - coordinates[1]) > 0.08;
    });
    if (computedTrigPoints.length && (resolvedFeaturePoints.length === 0 || hasMismatchedTrigFeaturePoint)) {
      if (hasMismatchedTrigFeaturePoint) warnings.push("trig-feature-points-recomputed");
      resolvedFeaturePoints = computedTrigPoints;
    } else if (resolvedFeaturePoints.length === 0) {
      resolvedFeaturePoints = defaultTrigWaveFeaturePoints(resolvedFunctions);
    }
  }
  if (graphStyle === "reciprocal-interval") {
    const reciprocalFn = resolvedFunctions.find((fn) => {
      const item = fn as Record<string, unknown>;
      return item.kind === "rational-reciprocal" && isBasicReciprocalLatex(item.latex);
    }) as Record<string, unknown> | undefined;
    if (reciprocalFn) {
      const reciprocalParams = reciprocalFn.params && typeof reciprocalFn.params === "object" ? reciprocalFn.params as Record<string, unknown> : {};
      const reciprocalA = asFiniteNumber(reciprocalParams.a, basicReciprocalNumerator(reciprocalFn.latex));
      const reciprocalH = asFiniteNumber(reciprocalParams.h ?? reciprocalParams.verticalAsymptote, 0);
      const reciprocalK = asFiniteNumber(reciprocalParams.k ?? reciprocalParams.horizontalAsymptote, 0);
      const reciprocalYAt = (x: number) => Math.abs(x - reciprocalH) < 0.0001 ? Number.NaN : reciprocalA / (x - reciprocalH) + reciprocalK;
      const existingCurvePoints = resolvedFeaturePoints.filter((point) => {
        const item = point as Record<string, unknown>;
        const coordinates = item.point as [number, number] | undefined;
        if (!Array.isArray(coordinates)) return false;
        const [x, y] = coordinates;
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - reciprocalH) < 0.0001) return false;
        const expectedY = reciprocalYAt(x);
        return Number.isFinite(expectedY) && Math.abs(expectedY - y) < 0.08;
      });
      const shadedInterval = normalizedShadedRegions.find((region) => (
        region.functionIndex === 0
        && Number.isFinite(region.from)
        && Number.isFinite(region.to)
        && Math.abs(region.from - region.to) > 0.0001
      ));
      const endpointXs = shadedInterval
        ? [shadedInterval.from, shadedInterval.to]
        : existingCurvePoints.length >= 2
          ? []
          : rawDomain;
      const domainEndpointPoints = endpointXs
        .filter((x, index, list) => Number.isFinite(x) && list.indexOf(x) === index && Math.abs(x - reciprocalH) > 0.0001)
        .map((x) => {
          const y = reciprocalYAt(x);
          return Number.isFinite(y)
            ? { point: [x, y] as [number, number], label: `(${fmtCoord(x)}, ${fmtCoord(y)})`, color: "primary", closed: true }
            : null;
        })
        .filter((point): point is { point: [number, number]; label: string; color: string; closed: boolean } => point !== null);
      resolvedFeaturePoints = existingCurvePoints.length >= 2
        ? existingCurvePoints
        : domainEndpointPoints.length
        ? domainEndpointPoints
        : [{ point: [reciprocalH + 1, reciprocalYAt(reciprocalH + 1)], label: `(${fmtCoord(reciprocalH + 1)}, ${fmtCoord(reciprocalYAt(reciprocalH + 1))})`, color: "primary", closed: true }];
    }
  }
  if (hasBasicReciprocalFunction && graphStyle !== "reciprocal-interval") {
    const reciprocalFn = resolvedFunctions.find((fn) => {
      const item = fn as Record<string, unknown>;
      return item.kind === "rational-reciprocal" && simpleReciprocalParamsFromLatex(item.latex);
    }) as Record<string, unknown> | undefined;
    const reciprocalParams = reciprocalFn?.params && typeof reciprocalFn.params === "object" ? reciprocalFn.params as Record<string, unknown> : {};
    const parsed = simpleReciprocalParamsFromLatex(reciprocalFn?.latex);
    const a = parsed?.a ?? asFiniteNumber(reciprocalParams.a, 1);
    const h = parsed?.h ?? asFiniteNumber(reciprocalParams.h ?? reciprocalParams.verticalAsymptote, 0);
    const k = parsed?.k ?? asFiniteNumber(reciprocalParams.k ?? reciprocalParams.horizontalAsymptote, 0);
    const yAt = (x: number) => Math.abs(x - h) < 0.0001 ? Number.NaN : a / (x - h) + k;
    resolvedFeaturePoints = resolvedFeaturePoints.flatMap((point) => {
      const item = point as Record<string, unknown>;
      const coordinates = item.point as [number, number] | undefined;
      if (!Array.isArray(coordinates)) return [point];
      const [x, y] = coordinates;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const expectedY = yAt(x);
      if (Number.isFinite(expectedY) && Math.abs(expectedY - y) < 0.08) return [point];
      const repaired: Array<{ point: [number, number]; label: string; color: string; closed: boolean }> = [];
      if (x >= rawDomain[0] && x <= rawDomain[1] && Number.isFinite(expectedY)) {
        repaired.push({ point: [x, expectedY], label: `(${fmtCoord(x)}, ${fmtCoord(expectedY)})`, color: "primary", closed: item.closed !== false });
      }
      const intervalEndY = yAt(y);
      if (Math.abs(y - x) > 0.0001 && y >= rawDomain[0] && y <= rawDomain[1] && Number.isFinite(intervalEndY)) {
        repaired.push({ point: [y, intervalEndY], label: `(${fmtCoord(y)}, ${fmtCoord(intervalEndY)})`, color: "primary", closed: item.closed !== false });
      }
      return repaired;
    });
  }
  if (hasInverseSquareFunction) {
    const inverseFn = resolvedFunctions.find((fn) => {
      const item = fn as Record<string, unknown>;
      return item.kind === "inverse-square";
    }) as Record<string, unknown> | undefined;
    const inverseParams = inverseFn?.params && typeof inverseFn.params === "object" ? inverseFn.params as Record<string, unknown> : {};
    const a = asFiniteNumber(inverseParams.a, 1);
    const h = asFiniteNumber(inverseParams.h ?? inverseParams.verticalAsymptote, 0);
    const k = asFiniteNumber(inverseParams.k ?? inverseParams.horizontalAsymptote, 0);
    const existingXValues = resolvedFeaturePoints
      .map((point) => {
        const item = point as Record<string, unknown>;
        const coordinates = item.point as [number, number] | undefined;
        return Array.isArray(coordinates) && Number.isFinite(coordinates[0]) ? coordinates[0] : Number.NaN;
      })
      .filter(Number.isFinite);
    const xValues = existingXValues.length ? existingXValues : [1, 2];
    resolvedFeaturePoints = xValues
      .map((x) => {
        const dx = x - h;
        if (Math.abs(dx) < 0.0001) return null;
        const y = a / (dx * dx) + k;
        return Number.isFinite(y)
          ? { point: [x, y] as [number, number], label: `(${fmtCoord(x)}, ${fmtCoord(y)})`, color: "primary", closed: true }
          : null;
      })
      .filter((point): point is { point: [number, number]; label: string; color: string; closed: boolean } => point !== null);
  }
  // For basic-graph quadratic diagrams, ensure each function's vertex is present
  // and correct. This handles two cases:
  //   (a) featurePoints is empty — inject all vertices.
  //   (b) featurePoints exist but some don't lie on any function (AI gave wrong
  //       coordinates) — replace each wrong point with the vertex of the function
  //       whose color matches.
  if (!graphStyle) {
    const allQuadraticFns = resolvedFunctions.filter(
      (fn) => (fn as Record<string, unknown>).kind === "quadratic"
    );
    if (allQuadraticFns.length > 0 && allQuadraticFns.length === resolvedFunctions.length) {
      const computedVertices = allQuadraticFns
        .map((fn) => {
          const item = fn as Record<string, unknown>;
          const p = (item.params && typeof item.params === "object" ? item.params : {}) as Record<string, unknown>;
          const a = asFiniteNumber(p.a, 1);
          const b = asFiniteNumber(p.b, 0);
          const c = asFiniteNumber(p.c, 0);
          if (Math.abs(a) < 0.0001) return null;
          const vx = -b / (2 * a);
          const vy = c - (b * b) / (4 * a);
          if (!Number.isFinite(vx) || !Number.isFinite(vy)) return null;
          const color = typeof item.color === "string" ? item.color : "primary";
          return { point: [vx, vy] as [number, number], label: `(${fmtCoord(vx)}, ${fmtCoord(vy)})`, color, closed: true };
        })
        .filter((v): v is { point: [number, number]; label: string; color: string; closed: boolean } => v !== null);

      if (computedVertices.length) {
        if (resolvedFeaturePoints.length === 0) {
          resolvedFeaturePoints = computedVertices;
        } else {
          // Repair any feature point that doesn't lie on any quadratic function.
          resolvedFeaturePoints = resolvedFeaturePoints.map((point) => {
            const item = point as Record<string, unknown>;
            const coords = item.point as [number, number] | undefined;
            if (!Array.isArray(coords)) return point;
            const [px, py] = coords;
            // Prefer validating against the color-matched function so that a
            // point like (0,0) marked "red" is caught even though it lies on
            // the "primary" function (y=x²).
            const ptColor = typeof item.color === "string" ? item.color : "primary";
            const colorMatchedFn = allQuadraticFns.find(
              (fn) => (fn as Record<string, unknown>).color === ptColor
            ) as Record<string, unknown> | undefined;
            const fnToCheck = colorMatchedFn ?? (allQuadraticFns[0] as Record<string, unknown>);
            const expectedY = evalFnAt(fnToCheck, px);
            const liesOnMatchedFunction = Number.isFinite(expectedY) && Math.abs(expectedY - py) < 0.08;
            if (liesOnMatchedFunction) return point;
            // Wrong point — replace with the vertex of the color-matched function.
            return computedVertices.find((v) => v.color === ptColor) ?? point;
          });
        }
      }
    }
  }

  const reciprocalOutputPoints = graphStyle === "reciprocal-interval"
    ? resolvedFeaturePoints
      .map((point) => {
        const item = point as Record<string, unknown>;
        const coordinates = item.point as [number, number] | undefined;
        return Array.isArray(coordinates) ? coordinates : null;
      })
      .filter((point): point is [number, number] => point !== null && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .sort((a, b) => a[0] - b[0])
    : [];
  const reciprocalMaxX = graphStyle === "reciprocal-interval"
    ? Math.max(4, Math.ceil(Math.max(rawDomain[1], ...reciprocalOutputPoints.map((point) => point[0]))))
    : 4;
  const reciprocalGuidePoint = reciprocalOutputPoints[0] || [1, 1];
  const reciprocalXTicks = Array.from({ length: reciprocalMaxX + 2 }).map((_, index) => index - 1);
  const outputDomain = graphStyle === "reciprocal-interval" ? [-1, reciprocalMaxX] : domain;
  const outputRange = graphStyle === "reciprocal-interval" ? [-1, 4] : range;

  // The AI sometimes hands back a plausible-looking but too-small range (e.g. a
  // generic [-5, 5] default) that doesn't actually contain what gets plotted —
  // most visibly with piecewise functions where one branch reaches well outside
  // it, clipping the curve. Grow the range to fit the sampled y-values of each
  // well-behaved (non-asymptotic) function over its own domain, plus feature
  // points, before applying the oversized-range shrink below. Templates that own
  // their viewport (e.g. reciprocal-interval) already set a deliberate window,
  // so leave those alone.
  const FIT_RANGE_KINDS = new Set(["linear", "quadratic", "cubic", "polynomial", "absolute-value", "square-root", "points"]);
  const fittedRange: [number, number] = (() => {
    if (graphStyle === "reciprocal-interval") return outputRange as [number, number];
    let dataYMin = Infinity;
    let dataYMax = -Infinity;
    for (const fn of resolvedFunctions) {
      const item = fn as Record<string, unknown>;
      if (!FIT_RANGE_KINDS.has(String(item.kind || ""))) continue;
      const fnDomain = Array.isArray(item.domain) ? item.domain as [number, number] : (outputDomain as [number, number]);
      const [dMin, dMax] = fnDomain;
      if (!Number.isFinite(dMin) || !Number.isFinite(dMax) || dMin >= dMax) continue;
      const samples = 40;
      for (let i = 0; i <= samples; i++) {
        const x = dMin + ((dMax - dMin) * i) / samples;
        const y = evalFnAt(item, x);
        if (!Number.isFinite(y)) continue;
        dataYMin = Math.min(dataYMin, y);
        dataYMax = Math.max(dataYMax, y);
      }
    }
    for (const fp of resolvedFeaturePoints) {
      const coords = (fp as Record<string, unknown>).point as [number, number] | undefined;
      if (Array.isArray(coords) && Number.isFinite(coords[1])) {
        dataYMin = Math.min(dataYMin, coords[1]);
        dataYMax = Math.max(dataYMax, coords[1]);
      }
    }
    if (!Number.isFinite(dataYMin) || !Number.isFinite(dataYMax)) return outputRange as [number, number];
    const pad = Math.max(0.5, (dataYMax - dataYMin) * 0.1);
    // Once a function's own kind/params have already been shown untrustworthy
    // by the general expression engine (resampled from latex instead of the
    // AI's original claim), the AI's separately-stated `range` was computed
    // against that same wrong assumption and isn't trustworthy either — a
    // real observed case: -3x^4+sin(2x^3-1) got misclassified as "cubic",
    // and its stated range was [-309,159] despite the true curve never going
    // above about -0.8, leaving well over half the chart's vertical space
    // empty even after the curve itself was corrected. In that case, fit the
    // range tightly to the corrected data — don't just grow the AI's
    // original (equally suspect) bounds, replace them.
    const anyFunctionCorrected = warnings.some((w) => w.startsWith("function-kind-corrected:"));
    if (anyFunctionCorrected) return [dataYMin - pad, dataYMax + pad] as [number, number];
    if (dataYMin >= outputRange[0] && dataYMax <= outputRange[1]) return outputRange as [number, number];
    return [Math.min(outputRange[0], dataYMin - pad), Math.max(outputRange[1], dataYMax + pad)] as [number, number];
  })();

  // For basic-graph quadratic diagrams, prevent an oversized y-viewport that
  // would crush the vertex region. When the (possibly just-fitted) range is
  // taller than 20 units and all functions are quadratic, clamp the top to
  // maxFeatureY + 10 so the vertices stay visually prominent.
  const finalRange: [number, number] = (() => {
    const outputRange = fittedRange;
    if (graphStyle || outputRange[1] - outputRange[0] <= 20) return outputRange as [number, number];
    const allQuadratic =
      resolvedFunctions.length > 0 &&
      resolvedFunctions.every((fn) => (fn as Record<string, unknown>).kind === "quadratic");
    if (!allQuadratic || resolvedFeaturePoints.length === 0) return outputRange as [number, number];
    const featureYs = resolvedFeaturePoints
      .map((p) => {
        const coords = (p as Record<string, unknown>).point as [number, number] | undefined;
        return Array.isArray(coords) && Number.isFinite(coords[1]) ? coords[1] : Number.NaN;
      })
      .filter((y): y is number => Number.isFinite(y));
    if (!featureYs.length) return outputRange as [number, number];
    const smartMax = Math.max(...featureYs) + 10;
    return smartMax < outputRange[1]
      ? [outputRange[0], smartMax] as [number, number]
      : outputRange as [number, number];
  })();

  // The AI sometimes copies a canned example's tick set verbatim (e.g. the
  // full-period trig wave fixture's 0/pi/2/pi/3pi/2/2pi ticks) without
  // adapting it to this problem's own, much narrower, domain — a real
  // observed case: a piecewise function restricted to [-pi/2, pi/2] shipped
  // with xTicks out to 2pi. Those extra ticks land off the visible plot and
  // get clipped by the frontend today, so they aren't a visible rendering
  // bug yet, but they're still wrong data that shouldn't be stored. Drop any
  // tick whose value falls meaningfully outside the axis it labels.
  const domainTolerance = Math.max(0.01, Math.abs(outputDomain[1] - outputDomain[0]) * 0.02);
  const rangeTolerance = Math.max(0.01, Math.abs(finalRange[1] - finalRange[0]) * 0.02);
  const xTicksInDomain = xTicks?.filter((tick) => tick.value >= outputDomain[0] - domainTolerance && tick.value <= outputDomain[1] + domainTolerance);
  const yTicksInRange = yTicks?.filter((tick) => tick.value >= finalRange[0] - rangeTolerance && tick.value <= finalRange[1] + rangeTolerance);

  const outputXTicks = graphStyle === "reciprocal-interval"
    ? reciprocalXTicks.map((value) => ({ value, label: String(value), major: value === 0 }))
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? undefined : xTicksInDomain?.length ? xTicksInDomain : graphStyle === "trig-wave" ? defaultTrigWaveXTicks() : undefined;
  const outputYTicks = graphStyle === "reciprocal-interval"
    ? [-1, 0, 1, 2, 3, 4].map((value) => ({ value, label: String(value), major: value === 0 }))
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? undefined : yTicksInRange?.length ? yTicksInRange : graphStyle === "trig-wave" ? defaultTrigWaveYTicks() : undefined;
  const outputGuideLines = graphStyle === "reciprocal-interval"
    ? [
      { orientation: "vertical", value: reciprocalGuidePoint[0], from: -1, to: 4, color: "primary" },
      { orientation: "horizontal", value: reciprocalGuidePoint[1], from: 0, to: reciprocalGuidePoint[0], color: "primary" },
    ]
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? [] : guideLines.length ? guideLines : graphStyle === "trig-wave" ? (computedGuideLines.length ? computedGuideLines : primaryTrigFunction ? defaultSineWaveGuideLines() : []) : [];

  return {
    type: "function-graph",
    functions: resolvedFunctions,
    featurePoints: resolvedFeaturePoints,
    shadedRegions: normalizedShadedRegions,
    domain: outputDomain,
    range: finalRange,
    graphStyle,
    ...(diagramIntent ? { diagramIntent } : {}),
    xTicks: outputXTicks,
    yTicks: outputYTicks,
    guideLines: outputGuideLines,
    xAxisLabel: typeof input.xAxisLabel === "string" ? input.xAxisLabel.slice(0, 32) : undefined,
    yAxisLabel: typeof input.yAxisLabel === "string" ? input.yAxisLabel.slice(0, 32) : undefined,
  };
}

// ─── Solid geometry helpers ───────────────────────────────────────────────────

function extractLabelNumber(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const m = label.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function solidParamsFromInput(
  shape: string,
  inputParams: Record<string, unknown> | null,
  dim: Record<string, unknown>,
): Record<string, number> {
  const n = (v: unknown) => asFiniteNumber(v, Number.NaN);
  const pick = (...keys: (unknown | undefined)[]) => {
    for (const v of keys) if (Number.isFinite(n(v))) return n(v);
    return Number.NaN;
  };

  const p = inputParams ?? {};

  switch (shape) {
    case "cylinder":
    case "cone":
      return {
        r: pick(p.r, p.radius, dim.radius),
        h: pick(p.h, p.height, dim.height),
      };
    case "sphere":
      return { r: pick(p.r, p.R, p.radius, dim.radius) };
    case "cube":
      return { a: pick(p.a, p.edge, p.side, dim.width, dim.height) };
    case "cuboid":
    case "rectangular-prism":
      return {
        l: pick(p.l, p.length, p.width, dim.width),
        w: pick(p.w, p.width, p.depth, dim.depth),
        h: pick(p.h, p.height, dim.height),
      };
    case "pyramid":
      return {
        a: pick(p.a, p.base, p.edge, p.side, dim.width),
        h: pick(p.h, p.height, dim.height),
      };
    case "frustum":
      return {
        r: pick(p.r, p.topRadius, dim.topRadius),
        R: pick(p.R, p.bottomRadius, dim.bottomRadius),
        h: pick(p.h, p.height, dim.height),
      };
    case "prism":
    case "triangular-prism":
      return {
        a: pick(p.a, p.base, p.side, dim.width),
        h: pick(p.h, p.height, dim.height),
      };
    default:
      return {};
  }
}

function buildSolidLabels(shape: string, params: Record<string, number>): Record<string, string> {
  const v = (val: number, fallback: string) => Number.isFinite(val) ? fmtCoord(val) : fallback;
  switch (shape) {
    case "cylinder":
    case "cone":
      return {
        r: `r = ${v(params.r, "?")}`,
        h: `h = ${v(params.h, "?")}`,
      };
    case "sphere":
      return { r: `R = ${v(params.r, "?")}` };
    case "cube":
      return { a: `a = ${v(params.a, "?")}` };
    case "cuboid":
    case "rectangular-prism":
      return {
        l: v(params.l, "l"),
        w: v(params.w, "w"),
        h: v(params.h, "h"),
      };
    case "pyramid":
      return {
        a: `a = ${v(params.a, "?")}`,
        h: `h = ${v(params.h, "?")}`,
      };
    case "frustum":
      return {
        r: `r = ${v(params.r, "?")}`,
        R: `R = ${v(params.R, "?")}`,
        h: `h = ${v(params.h, "?")}`,
      };
    case "prism":
    case "triangular-prism":
      return {
        a: `a = ${v(params.a, "?")}`,
        h: `h = ${v(params.h, "?")}`,
      };
    default:
      return {};
  }
}

function repairSolidLabels(
  shape: string,
  params: Record<string, number>,
  provided: Record<string, unknown>,
  warnings: string[],
): Record<string, string> {
  const auto = buildSolidLabels(shape, params);
  const result: Record<string, string> = {};

  for (const [key, autoValue] of Object.entries(auto)) {
    const raw = provided[key];
    const providedNum = extractLabelNumber(raw);
    const paramVal = params[key as keyof typeof params];
    if (raw === undefined || raw === null) {
      result[key] = autoValue;
    } else if (Number.isFinite(paramVal) && Number.isFinite(providedNum) && Math.abs(providedNum - paramVal) > 0.01) {
      warnings.push(`solid-label-mismatch:${key}:label=${providedNum}:param=${paramVal}`);
      result[key] = autoValue;
    } else {
      result[key] = String(raw).slice(0, 32);
    }
  }
  // Pass through any extra keys the AI provided (e.g. diagonal, slant)
  for (const [key, value] of Object.entries(provided)) {
    if (!(key in result) && typeof value === "string") result[key] = value.slice(0, 32);
  }
  return result;
}

function solidRenderDimensions(shape: string, params: Record<string, number>, fallback: Record<string, unknown>): Record<string, unknown> {
  const fb = (key: string, def: number) => asFiniteNumber(fallback[key], def);
  switch (shape) {
    case "cylinder":
    case "cone":
      return {
        radius: Number.isFinite(params.r) ? params.r : fb("radius", 4),
        height: Number.isFinite(params.h) ? params.h : fb("height", 10),
      };
    case "sphere":
      return { radius: Number.isFinite(params.r) ? params.r : fb("radius", 5) };
    case "cube": {
      const a = Number.isFinite(params.a) ? params.a : fb("width", 100);
      return { width: a, height: a, depth: a * 0.8 };
    }
    case "cuboid":
    case "rectangular-prism":
      return {
        width: Number.isFinite(params.l) ? params.l : fb("width", 100),
        depth: Number.isFinite(params.w) ? params.w : fb("depth", 80),
        height: Number.isFinite(params.h) ? params.h : fb("height", 100),
      };
    case "pyramid": {
      const a = Number.isFinite(params.a) ? params.a : fb("width", 100);
      return { width: a, height: Number.isFinite(params.h) ? params.h : fb("height", 100), depth: a * 0.8 };
    }
    case "frustum":
      return {
        topRadius: Number.isFinite(params.r) ? params.r : fb("topRadius", 3),
        bottomRadius: Number.isFinite(params.R) ? params.R : fb("bottomRadius", 6),
        height: Number.isFinite(params.h) ? params.h : fb("height", 8),
      };
    case "prism":
    case "triangular-prism": {
      const a = Number.isFinite(params.a) ? params.a : fb("width", 100);
      return { width: a, height: Number.isFinite(params.h) ? params.h : fb("height", 100), depth: a * 0.8 };
    }
    default:
      return { width: fb("width", 100), height: fb("height", 100), depth: fb("depth", 80) };
  }
}

function normalizeSolidGeometrySpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const shape = String(input.shape || "").trim();
  const allowed = ["cube", "cuboid", "pyramid", "prism", "cylinder", "cone", "frustum", "sphere"];
  if (!allowed.includes(shape)) warnings.push("unsupported-solid-shape");
  const normalizedShape = allowed.includes(shape) ? shape : "cube";

  const inputParams = input.params && typeof input.params === "object" ? input.params as Record<string, unknown> : null;
  const inputDimensions = input.dimensions && typeof input.dimensions === "object" ? input.dimensions as Record<string, unknown> : {};

  const params = solidParamsFromInput(normalizedShape, inputParams, inputDimensions);
  // Drop NaN entries
  const cleanParams = Object.fromEntries(Object.entries(params).filter(([, v]) => Number.isFinite(v)));

  const providedLabels = input.labels && typeof input.labels === "object" ? input.labels as Record<string, unknown> : null;
  const labels = providedLabels
    ? repairSolidLabels(normalizedShape, cleanParams, providedLabels, warnings)
    : buildSolidLabels(normalizedShape, cleanParams);

  const dimensions = solidRenderDimensions(normalizedShape, cleanParams, inputDimensions);

  return {
    type: "solid-geometry",
    shape: normalizedShape,
    ...(Object.keys(cleanParams).length > 0 ? { params: cleanParams } : {}),
    dimensions,
    labels,
    showSpaceDiagonal: Boolean(input.showSpaceDiagonal),
  };
}

function normalizePieChartSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  // Accept both "sectors" and "slices" (AI commonly uses the latter)
  const rawItems = Array.isArray(input.sectors) ? input.sectors
    : Array.isArray(input.slices) ? input.slices
    : [];

  // If items use raw counts/values instead of percentages, convert proportionally
  const rawValues = rawItems.map((item) => {
    if (!item || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    const pct = asFiniteNumber(it.percentage, Number.NaN);
    if (Number.isFinite(pct)) return pct;
    const val = asFiniteNumber(it.value ?? it.count ?? it.amount, Number.NaN);
    return Number.isFinite(val) && val > 0 ? val : null;
  });

  const hasPercentages = rawValues.every((v, i) => {
    if (v === null) return false;
    const item = rawItems[i] as Record<string, unknown>;
    return Number.isFinite(asFiniteNumber(item.percentage, Number.NaN));
  });

  const total = hasPercentages ? 100 : rawValues.reduce((sum, v) => sum + (v ?? 0), 0);

  const normalizedSectors = rawItems
    .map((sector, i) => {
      if (!sector || typeof sector !== "object") return null;
      const item = sector as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.slice(0, 80) : "Category";
      const raw = rawValues[i];
      if (raw === null) return null;
      const percentage = hasPercentages ? raw : total > 0 ? (raw / total) * 100 : 0;
      if (!Number.isFinite(percentage) || percentage <= 0) return null;
      return {
        label,
        percentage
      };
    })
    .filter(Boolean);

  if (!normalizedSectors.length) {
    warnings.push("empty-pie-chart");
  }

  return {
    type: "pie-chart",
    sectors: normalizedSectors
  };
}

function normalizeTreeDiagramSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const normalizedNodes = nodes
    .map((node) => {
      if (!node || typeof node !== "object") return null;
      const item = node as Record<string, unknown>;
      return {
        id: String(item.id || "").trim(),
        parentId: item.parentId ? String(item.parentId).trim() : undefined,
        label: String(item.label || "").trim(),
        branchLabel: item.branchLabel ? String(item.branchLabel).trim() : undefined,
      };
    })
    .filter(Boolean);

  if (!normalizedNodes.length) {
    warnings.push("empty-tree-diagram");
  }

  return {
    type: "tree-diagram",
    rootLabel: input.rootLabel ? String(input.rootLabel).trim() : undefined,
    nodes: normalizedNodes,
  };
}

export function normalizeDiagramBlock(block: unknown): DiagramRenderBlock | null {
  if (!block || typeof block !== "object") return null;
  const raw = block as Record<string, unknown>;
  let diagramType = String(raw.diagramType || raw.type || raw.specType || "") as DiagramType;

  // Auto-detect / heal missing or invalid diagramType based on unique structural properties
  if (!diagramType || !DIAGRAM_TYPES.has(diagramType)) {
    const spec = (raw.spec && typeof raw.spec === "object" ? raw.spec : raw) as Record<string, unknown>;
    if (Array.isArray(spec.shapes) || Array.isArray(raw.shapes)) {
      diagramType = "geometry";
    } else if (Array.isArray(spec.functions) || Array.isArray(raw.functions)) {
      diagramType = "function-graph";
    } else if (Array.isArray(spec.ranges) || Array.isArray(spec.points) || spec.boxPlot || Array.isArray(raw.ranges) || Array.isArray(raw.points) || raw.boxPlot) {
      diagramType = "number-line";
    } else if (Array.isArray(spec.rows) || Array.isArray(raw.rows)) {
      diagramType = "sign-table";
    } else if (Array.isArray(spec.sets) || Array.isArray(raw.sets)) {
      diagramType = "venn-diagram";
    } else if (spec.shape || raw.shape) {
      diagramType = "solid-geometry";
    } else if (Array.isArray(spec.sectors) || Array.isArray(raw.sectors) || Array.isArray(spec.slices) || Array.isArray(raw.slices)) {
      diagramType = "pie-chart";
    } else if (Array.isArray(spec.nodes) || Array.isArray(raw.nodes)) {
      diagramType = "tree-diagram";
    }
  }

  if (!DIAGRAM_TYPES.has(diagramType)) return null;

  const inputSpec = raw.spec && typeof raw.spec === "object"
    ? raw.spec as Record<string, unknown>
    : raw;
  const warnings: string[] = [];

  const spec =
    diagramType === "number-line" ? normalizeNumberLineSpec(inputSpec, warnings)
      : diagramType === "sign-table" ? normalizeSignTableSpec(inputSpec, warnings)
        : diagramType === "venn-diagram" ? normalizeVennDiagramSpec(inputSpec, warnings)
          : diagramType === "geometry" ? normalizeGeometrySpec(inputSpec, warnings)
            : diagramType === "function-graph" ? normalizeFunctionGraphSpec(inputSpec, warnings)
              : diagramType === "pie-chart" ? normalizePieChartSpec(inputSpec, warnings)
                : diagramType === "tree-diagram" ? normalizeTreeDiagramSpec(inputSpec, warnings)
                  : normalizeSolidGeometrySpec(inputSpec, warnings);
  const problemIntent = normalizeProblemIntent(raw.problemIntent ?? inputSpec.problemIntent);
  const diagramIntent = normalizeDiagramIntent(raw.diagramIntent ?? inputSpec.diagramIntent) || defaultDiagramIntent(problemIntent);
  const mathFamily = normalizeMathFamily(raw.mathFamily ?? inputSpec.mathFamily) || inferMathFamily(diagramType, spec);
  const renderTemplate = diagramType === "function-graph"
    ? normalizeRenderTemplate(spec.graphStyle ?? inputSpec.graphStyle ?? inputSpec.template, raw.renderTemplate ?? inputSpec.renderTemplate)
    : normalizeRenderTemplate(raw.renderTemplate ?? inputSpec.renderTemplate, spec.graphStyle ?? inputSpec.graphStyle ?? inputSpec.template);
  const enrichedSpec = {
    ...spec,
    mathFamily,
    ...(problemIntent ? { problemIntent } : {}),
    ...(diagramIntent ? { diagramIntent } : {}),
    ...(renderTemplate ? { renderTemplate } : {}),
  };

  return {
    type: "diagram",
    diagramType,
    mathFamily,
    ...(problemIntent ? { problemIntent } : {}),
    ...(diagramIntent ? { diagramIntent } : {}),
    ...(renderTemplate ? { renderTemplate } : {}),
    spec: enrichedSpec,
    renderer: "zupiq-svg",
    version: 1,
    cacheKey: cacheKey(diagramType, enrichedSpec),
    ...(warnings.length ? { warnings } : {}),
  };
}

function formatDiagramNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value - Math.round(value)) < 0.000001) return `${Math.round(value)}`;
  return `${Number(value.toFixed(3))}`;
}

function functionLatexForFamily(family: SupportedFunctionGraphFamily, params: Record<string, unknown>, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  const a = asFiniteNumber(params.a, 1);
  const h = asFiniteNumber(params.h ?? params.verticalAsymptote, 0);
  const k = asFiniteNumber(params.k ?? params.horizontalAsymptote, 0);
  const shiftedX = h === 0 ? "x" : `(x${h < 0 ? "+" : "-"}${Math.abs(h)})`;
  const suffix = Math.abs(k) > 0.000001 ? `${k >= 0 ? "+" : ""}${formatDiagramNumber(k)}` : "";
  if (family === "rational-reciprocal") return `y=\\frac{${formatDiagramNumber(a)}}{${shiftedX}}${suffix}`;
  if (family === "inverse-square") return `y=\\frac{${formatDiagramNumber(a)}}{${shiftedX}^2}${suffix}`;
  const b = asFiniteNumber(params.b, 1);
  return `y=\\frac{${formatDiagramNumber(a)}}{${shiftedX}^2${b >= 0 ? "+" : ""}${formatDiagramNumber(b)}}${suffix}`;
}

function yAtFunctionFamily(family: SupportedFunctionGraphFamily, params: Record<string, unknown>, x: number): number {
  const a = asFiniteNumber(params.a, 1);
  const h = asFiniteNumber(params.h ?? params.verticalAsymptote, 0);
  const k = asFiniteNumber(params.k ?? params.horizontalAsymptote, 0);
  const dx = x - h;
  if (family === "rational-reciprocal") {
    if (Math.abs(dx) < 0.0001) return Number.NaN;
    return a / dx + k;
  }
  if (family === "inverse-square") {
    if (Math.abs(dx) < 0.0001) return Number.NaN;
    return a / (dx * dx) + k;
  }
  const b = asFiniteNumber(params.b, 1);
  const denominator = dx * dx + b;
  if (Math.abs(denominator) < 0.0001) return Number.NaN;
  return a / denominator + k;
}

export function buildFunctionGraphIntentDiagramBlock(input: FunctionGraphIntentBuildInput): DiagramRenderBlock | null {
  const [from, to] = input.interval;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  const yFrom = yAtFunctionFamily(input.mathFamily, input.params, from);
  const yTo = yAtFunctionFamily(input.mathFamily, input.params, to);
  if (!Number.isFinite(yFrom) || !Number.isFinite(yTo)) return null;

  const existingSpec = input.existingSpec || {};
  const problemIntent = normalizeProblemIntent(input.problemIntent);
  const diagramIntent = normalizeDiagramIntent(input.diagramIntent)
    || normalizeDiagramIntent(existingSpec.diagramIntent)
    || defaultDiagramIntent(problemIntent)
    || "interval-points";
  const renderTemplate = normalizeRenderTemplate(input.renderTemplate, existingSpec.renderTemplate ?? existingSpec.graphStyle ?? "reciprocal-interval") || "reciprocal-interval";
  const params = {
    ...input.params,
    ...(input.mathFamily === "rational-reciprocal" || input.mathFamily === "inverse-square"
      ? {
        verticalAsymptote: asFiniteNumber(input.params.h ?? input.params.verticalAsymptote, 0),
        horizontalAsymptote: asFiniteNumber(input.params.k ?? input.params.horizontalAsymptote, 0),
      }
      : {}),
  };
  const functions: Array<Record<string, unknown>> = [{
    kind: input.mathFamily,
    latex: functionLatexForFamily(input.mathFamily, params, input.latex),
    params,
    points: [],
    color: "primary",
  }];

  if (diagramIntent === "secant-interval") {
    const m = (yTo - yFrom) / (to - from);
    const b = yFrom - m * from;
    functions.push({
      kind: "linear",
      latex: `y=${Number(m.toFixed(6))}x${b >= 0 ? "+" : ""}${Number(b.toFixed(6))}`,
      params: { m, b },
      points: [],
      color: "secondary",
    });
  }

  const yMax = Math.max(4, Math.ceil(Math.max(yFrom, yTo) + 1));
  const startsAtZero = input.mathFamily === "rational-even";
  const spec = {
    ...existingSpec,
    type: "function-graph",
    mathFamily: input.mathFamily,
    ...(problemIntent ? { problemIntent } : {}),
    diagramIntent,
    renderTemplate,
    graphStyle: renderTemplate,
    domain: renderTemplate === "reciprocal-interval" && input.mathFamily === "rational-reciprocal"
      ? [from, to]
      : [startsAtZero ? Math.min(0, from) : from, Math.max(to, from + 1)],
    range: [startsAtZero ? 0 : -1, yMax],
    functions,
    featurePoints: [
      { point: [from, yFrom], label: `(${formatDiagramNumber(from)}, ${formatDiagramNumber(yFrom)})`, color: "primary", closed: diagramIntent === "secant-interval" || input.closedStart === true },
      { point: [to, yTo], label: `(${formatDiagramNumber(to)}, ${formatDiagramNumber(yTo)})`, color: "primary", closed: diagramIntent === "secant-interval" || input.closedEnd === true },
    ],
    guideLines: [],
    shadedRegions: diagramIntent === "shaded-interval"
      ? [{ from, to, baseline: 0, functionIndex: 0, color: "primary" }]
      : [],
  };

  return normalizeDiagramBlock({
    diagramType: "function-graph",
    mathFamily: input.mathFamily,
    ...(problemIntent ? { problemIntent } : {}),
    diagramIntent,
    renderTemplate,
    spec,
  });
}

const CRITICAL_WARNINGS = new Set([
  "empty-function-graph",
  "empty-geometry",
  "empty-sign-table",
  "empty-number-line",
  "empty-venn-diagram",
  "empty-pie-chart",
  "empty-tree-diagram",
]);

export function normalizeDiagramBlocks(blocks: unknown): DiagramRenderBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map(normalizeDiagramBlock)
    .filter((block): block is DiagramRenderBlock =>
      Boolean(block) && !block.warnings?.some((w) => CRITICAL_WARNINGS.has(w))
    );
}
