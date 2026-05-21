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

      let from = asFiniteNumber(item.from ?? item.xMin ?? item.start, Number.NaN);
      let to = asFiniteNumber(item.to ?? item.xMax ?? item.end, Number.NaN);
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
      return {
        from: Math.min(from, to),
        to: Math.max(from, to),
        baseline,
        functionIndex,
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
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
  if (!normalizedFunctions.length && !normalizedFeaturePoints.length) warnings.push("empty-function-graph");

  const rawDomain = Array.isArray(input.domain)
    ? input.domain.slice(0, 2).map((v) => asFiniteNumber(v, 0)) as [number, number]
    : ([-5, 5] as [number, number]);
  const rawRange = Array.isArray(input.range)
    ? input.range.slice(0, 2).map((v) => asFiniteNumber(v, 0)) as [number, number]
    : ([-5, 5] as [number, number]);

  // Enhance rational-reciprocal functions that have a compound form (linear + rational).
  // The renderer only draws a/(x-h)+k — if the latex includes an "x" term the AI dropped
  // into params as k, we regenerate accurate sample points for the full expression and
  // suppress the horizontal asymptote label (which is meaningless for oblique asymptotes).
  const normalizedFunctionsEnhanced = normalizedFunctions.map((fn) => {
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

  // When all shaded regions are strictly in the first quadrant (from≥0, baseline≥0),
  // snap the lower bounds to 0 so the viewport focuses on the relevant area, and
  // restrict each function's plotted domain to its shading extent so the line
  // stops at the x-axis intercept rather than dipping below y=0.
  const allShadedFirstQuadrant =
    normalizedShadedRegions.length > 0 &&
    normalizedShadedRegions.every((r) => r.from >= 0 && r.baseline >= 0);

  const domain = allShadedFirstQuadrant
    ? [Math.max(0, rawDomain[0]), rawDomain[1]]
    : rawDomain;
  const range = allShadedFirstQuadrant
    ? [Math.max(0, rawRange[0]), rawRange[1]]
    : rawRange;

  let resolvedFunctions = normalizedFunctionsEnhanced;
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
    resolvedFunctions = normalizedFunctionsEnhanced.map((fn, i) => {
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
      const candidates: Array<[number, number]> = [
        [r.from, r.baseline],
        [r.to, r.baseline],
        ...(Number.isFinite(yAtFrom) && yAtFrom !== r.baseline ? [[r.from, yAtFrom] as [number, number]] : []),
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

  return {
    type: "function-graph",
    functions: resolvedFunctions,
    featurePoints: resolvedFeaturePoints,
    shadedRegions: normalizedShadedRegions,
    domain,
    range,
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
  const sectors = Array.isArray(input.sectors) ? input.sectors : [];
  const normalizedSectors = sectors
    .map((sector) => {
      if (!sector || typeof sector !== "object") return null;
      const item = sector as Record<string, unknown>;
      const label = typeof item.label === "string" ? item.label.slice(0, 80) : "Category";
      const percentage = asFiniteNumber(item.percentage, Number.NaN);
      if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) return null;
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
    } else if (Array.isArray(spec.sectors) || Array.isArray(raw.sectors)) {
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
