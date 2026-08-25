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

export type DiagramRenderBlock = {
  type: "diagram";
  diagramType: DiagramType;
  spec: Record<string, unknown>;
  renderer: "zupiq-svg";
  version: 1;
  cacheKey: string;
  warnings?: string[];
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
    },
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
      if (!["triangle", "polygon", "circle", "segment", "line", "arrow", "angle", "arc", "semicircle", "sector"].includes(shapeType)) return null;
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
        startAngle: Number.isFinite(startAngle) ? startAngle : undefined,
        endAngle: Number.isFinite(endAngle) ? endAngle : undefined,
        labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label).slice(0, 16)).slice(0, 8) : undefined,
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: typeof item.color === "string" ? item.color.slice(0, 24) : undefined,
        fill: typeof item.fill === "string" ? item.fill.slice(0, 24) : undefined,
      };
    })
    .filter((shape) => {
      if (!shape) return false;
      if (shape.shape === "circle") return Boolean(shape.center) && Number.isFinite(shape.radius);
      if (shape.shape === "arc") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "semicircle") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "sector") return Boolean(shape.center) && Number.isFinite(shape.radius) && Number.isFinite(shape.startAngle) && Number.isFinite(shape.endAngle);
      if (shape.shape === "arrow" || shape.shape === "line") return Boolean(shape.start) && Boolean(shape.end);
      if (shape.shape === "angle") return Boolean(shape.vertex) && Boolean(shape.from) && Boolean(shape.to);
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
        color: typeof item.color === "string" ? item.color.slice(0, 24) : undefined,
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
  return /(?:\\pi|\bpi\b|π|\\sin|\bsin\b|\\cos|\bcos\b)/i.test(String(value ?? ""));
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
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

/**
 * Returns the coefficient of the standalone linear (x) term in a compound rational
 * expression like "x + 1/(x-2)" or "2x - 3/(x+1)".
 * Returns 0 when no linear term is present.
 */
function extractLinearCoeff(latex: string): number {
  const clean = String(latex || "")
    .replace(/\s+/g, "")
    .replace(/^(?:[a-zA-Z]\([a-zA-Z]\)|[a-zA-Z])=/, "");

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

      const points = Array.isArray(item.points) ? item.points.map(asPoint).filter(Boolean).slice(0, 80) : [];
      
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
            if (!["linear", "quadratic", "cubic", "absolute-value", "rational-reciprocal", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine"].includes(fnKind)) return null;
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

      const KNOWN_KINDS = ["linear", "quadratic", "cubic", "absolute-value", "rational-reciprocal", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine", "piecewise"];
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
              color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
            };
          }
        }
        return null;
      }
      return {
        kind: kind || "points",
        latex,
        points,
        params,
        pieces,
        domain,
        color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
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
        color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
        closed: closed,
      };
    })
    .filter(Boolean)
    .slice(0, 8);

  let resolvedNormalizedFunctions = normalizedFunctions;
  const hasTrigFeaturePoints = normalizedFeaturePoints.some((point) => {
    const item = point as Record<string, unknown>;
    const coordinates = item.point as [number, number] | undefined;
    const y = Array.isArray(coordinates) ? coordinates[1] : Number.NaN;
    return hasTrigLabel(item.label) || Math.abs(y) === 1;
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
      // Only allow design-system tokens for shading color; raw CSS names like "red"/"blue" → "primary"
      const rawColor = typeof item.color === "string" ? item.color : "";
      const shadingColor = ["primary", "muted", "secondary"].includes(rawColor) ? rawColor : "primary";
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
      color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
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
  const graphStyle = ["trig-wave", "textbook-wave"].includes(String(input.graphStyle || input.template || "")) || hasTrigFunction || hasTrigFeaturePoints
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

  return {
    type: "function-graph",
    functions: resolvedFunctions,
    featurePoints: resolvedFeaturePoints,
    shadedRegions: normalizedShadedRegions,
    domain,
    range,
    graphStyle,
    xTicks: xTicks?.length ? xTicks : graphStyle === "trig-wave" ? defaultTrigWaveXTicks() : undefined,
    yTicks: yTicks?.length ? yTicks : graphStyle === "trig-wave" ? defaultTrigWaveYTicks() : undefined,
    guideLines: guideLines.length ? guideLines : graphStyle === "trig-wave" ? computedGuideLines.length ? computedGuideLines : defaultSineWaveGuideLines() : [],
    xAxisLabel: typeof input.xAxisLabel === "string" ? input.xAxisLabel.slice(0, 32) : undefined,
    yAxisLabel: typeof input.yAxisLabel === "string" ? input.yAxisLabel.slice(0, 32) : undefined,
  };
}

function normalizeSolidGeometrySpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const shape = String(input.shape || "").trim();
  const allowed = ["cube", "cuboid", "pyramid", "prism", "cylinder", "cone", "frustum", "sphere"];
  if (!allowed.includes(shape)) warnings.push("unsupported-solid-shape");
  const dimensions = input.dimensions && typeof input.dimensions === "object" ? input.dimensions as Record<string, unknown> : {};
  const radius = asFiniteNumber(dimensions.radius, Number.NaN);
  const topRadius = asFiniteNumber(dimensions.topRadius, Number.NaN);
  const bottomRadius = asFiniteNumber(dimensions.bottomRadius, Number.NaN);
  return {
    type: "solid-geometry",
    shape: allowed.includes(shape) ? shape : "cube",
    dimensions: {
      width: asFiniteNumber(dimensions.width, 100),
      height: asFiniteNumber(dimensions.height, 100),
      depth: asFiniteNumber(dimensions.depth, 80),
      ...(Number.isFinite(radius) ? { radius } : {}),
      ...(Number.isFinite(topRadius) ? { topRadius } : {}),
      ...(Number.isFinite(bottomRadius) ? { bottomRadius } : {}),
    },
    labels: input.labels && typeof input.labels === "object" ? input.labels : {},
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

  return {
    type: "diagram",
    diagramType,
    spec,
    renderer: "zupiq-svg",
    version: 1,
    cacheKey: cacheKey(diagramType, spec),
    ...(warnings.length ? { warnings } : {}),
  };
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
