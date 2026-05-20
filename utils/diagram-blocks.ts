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
  const normalizedRows = rows
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
        cells: cells.map((cell) => String(cell ?? "").slice(0, 32)).slice(0, 8),
      };
    })
    .filter((row) => row && (row.label || row.cells.length));
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

function normalizeFunctionGraphSpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const functions = Array.isArray(input.functions) ? [...input.functions] : [];
  const featurePoints = Array.isArray(input.featurePoints) ? [...input.featurePoints] : [];
  const shadedRegions = Array.isArray(input.shadedRegions) ? [...input.shadedRegions] : [];

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

      const latex = String(item.latex || item.label || "").slice(0, 80);
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
            if (!["linear", "quadratic", "absolute-value", "rational-reciprocal", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine"].includes(fnKind)) return null;
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

      if (!points.length && !["linear", "quadratic", "absolute-value", "rational-reciprocal", "exponential", "logarithmic", "square-root", "sine", "trig-sine", "cosine", "trig-cosine", "piecewise"].includes(kind)) return null;
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
  const normalizedShadedRegions = shadedRegions
    .map((region) => {
      if (!region || typeof region !== "object") return null;
      const item = region as Record<string, unknown>;
      const from = asFiniteNumber(item.from ?? item.xMin ?? item.start, Number.NaN);
      const to = asFiniteNumber(item.to ?? item.xMax ?? item.end, Number.NaN);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
      return {
        from: Math.min(from, to),
        to: Math.max(from, to),
        baseline: asFiniteNumber(item.baseline, 0),
        functionIndex: Math.max(0, Math.floor(asFiniteNumber(item.functionIndex, 0))),
        label: typeof item.label === "string" ? item.label.slice(0, 48) : undefined,
        color: typeof item.color === "string" ? item.color.slice(0, 24) : "primary",
      };
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!normalizedFunctions.length && !normalizedFeaturePoints.length) warnings.push("empty-function-graph");
  return {
    type: "function-graph",
    functions: normalizedFunctions,
    featurePoints: normalizedFeaturePoints,
    shadedRegions: normalizedShadedRegions,
    domain: Array.isArray(input.domain) ? input.domain.slice(0, 2).map((v) => asFiniteNumber(v, 0)) : [-5, 5],
    range: Array.isArray(input.range) ? input.range.slice(0, 2).map((v) => asFiniteNumber(v, 0)) : [-5, 5],
    xAxisLabel: typeof input.xAxisLabel === "string" ? input.xAxisLabel.slice(0, 32) : undefined,
    yAxisLabel: typeof input.yAxisLabel === "string" ? input.yAxisLabel.slice(0, 32) : undefined,
  };
}

function normalizeSolidGeometrySpec(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const shape = String(input.shape || "").trim();
  const allowed = ["cube", "cuboid", "pyramid", "prism", "cylinder", "cone", "sphere"];
  if (!allowed.includes(shape)) warnings.push("unsupported-solid-shape");
  const dimensions = input.dimensions && typeof input.dimensions === "object" ? input.dimensions as Record<string, unknown> : {};
  return {
    type: "solid-geometry",
    shape: allowed.includes(shape) ? shape : "cube",
    dimensions: {
      width: asFiniteNumber(dimensions.width, 100),
      height: asFiniteNumber(dimensions.height, 100),
      depth: asFiniteNumber(dimensions.depth, 80),
    },
    labels: input.labels && typeof input.labels === "object" ? input.labels : {},
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
