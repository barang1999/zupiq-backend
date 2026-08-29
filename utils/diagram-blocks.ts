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

  const normalizedFeaturePoints = featurePoints
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
  const guideLines = guideLineInputs.map(normalizeGuideLine).filter(Boolean).slice(0, 10);
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
  const outputXTicks = graphStyle === "reciprocal-interval"
    ? reciprocalXTicks.map((value) => ({ value, label: String(value), major: value === 0 }))
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? undefined : xTicks?.length ? xTicks : graphStyle === "trig-wave" ? defaultTrigWaveXTicks() : undefined;
  const outputYTicks = graphStyle === "reciprocal-interval"
    ? [-1, 0, 1, 2, 3, 4].map((value) => ({ value, label: String(value), major: value === 0 }))
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? undefined : yTicks?.length ? yTicks : graphStyle === "trig-wave" ? defaultTrigWaveYTicks() : undefined;
  const outputGuideLines = graphStyle === "reciprocal-interval"
    ? [
      { orientation: "vertical", value: reciprocalGuidePoint[0], from: -1, to: 4, color: "primary" },
      { orientation: "horizontal", value: reciprocalGuidePoint[1], from: 0, to: reciprocalGuidePoint[0], color: "primary" },
    ]
    : hasBasicReciprocalFunction || hasInverseSquareFunction ? [] : guideLines.length ? guideLines : graphStyle === "trig-wave" ? computedGuideLines.length ? computedGuideLines : defaultSineWaveGuideLines() : [];

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
    if (dataYMin >= outputRange[0] && dataYMax <= outputRange[1]) return outputRange as [number, number];
    const pad = Math.max(0.5, (dataYMax - dataYMin) * 0.1);
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
