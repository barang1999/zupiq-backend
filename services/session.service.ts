import { getSupabaseAdmin } from "../config/supabase.js";
import { StudySession, CreateSessionDTO, UpdateSessionDTO } from "../models/session.model.js";
import { generateId, nowISO, slugify } from "../utils/helpers.js";
import { AppError } from "../api/middlewares/error.middleware.js";
import { canUserAccessSession, canUserEditSession } from "./collaboration.service.js";
import { normalizeDiagramBlocks } from "../utils/diagram-blocks.js";
import { logger } from "../utils/logger.js";

type CanonicalSubject = {
  slug: string;
  name: string;
  aliases: string[];
};

type SubjectRow = {
  id: string;
  name: string;
  slug: string;
};

function parseJsonDeep(value: unknown, maxDepth = 3): unknown {
  let current: unknown = value;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed) return current;
    if (!/^[{\["]/.test(trimmed)) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
}

function toCanonicalJsonString(value: unknown, fallback: unknown): string {
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") {
    try {
      return JSON.stringify(parsed);
    } catch {
      return JSON.stringify(fallback);
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        return JSON.stringify(fallback);
      }
    }
  }
  return JSON.stringify(fallback);
}

function toCanonicalJsonValue(value: unknown, fallback: unknown): unknown {
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") return parsed;
  return fallback;
}

function payloadText(value: unknown): string {
  const parsed = parseJsonDeep(value);
  if (typeof parsed === "string") return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.problem === "string") return record.problem;
  }
  return typeof value === "string" ? value : "";
}

function parseSimpleReciprocalInterval(source: string): { a: number; h: number; interval: [number, number] } | null {
  const normalized = `${source ?? ""}`.replace(/[០-៩]/g, (digit) => "០១២៣៤៥៦៧៨៩".indexOf(digit).toString()).replace(/\s+/g, "");
  const latexMatch = normalized.match(/(?:f\(x\)|y)=\\frac\{([+-]?\d+(?:\.\d+)?)\}\{x(?:([+-])(\d+(?:\.\d+)?))?\}/i);
  const slashMatch = latexMatch ? null : normalized.match(/(?:f\(x\)|y)=([+-]?\d+(?:\.\d+)?)\/\(?(?:x(?:([+-])(\d+(?:\.\d+)?))?)\)?/i);
  const match = latexMatch || slashMatch;
  if (!match) return null;
  const a = Number(match[1]);
  const shift = match[3] ? Number(match[3]) : 0;
  const h = match[2] === "+" ? -shift : shift;
  const interval = Array.from(normalized.matchAll(/[\[(]([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)[\])]/g))
    .map((item): [number, number] => [Number(item[1]), Number(item[2])])
    .find(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && from < to && Math.abs(from - h) > 0.0001 && Math.abs(to - h) > 0.0001);
  return Number.isFinite(a) && Number.isFinite(h) && interval ? { a, h, interval } : null;
}

function parseSimpleRationalEvenInterval(source: string): {
  a: number;
  h: number;
  b: number;
  interval: [number, number];
  closedStart: boolean;
  closedEnd: boolean;
} | null {
  const normalized = `${source ?? ""}`
    .replace(/[០-៩]/g, (digit) => "០១២៣៤៥៦៧៨៩".indexOf(digit).toString())
    .replace(/\s+/g, "")
    .replace(/\\?left|\\?right/g, "");
  const latexMatch = normalized.match(/(?:f\(x\)|y)=\\frac\{([+-]?\d+(?:\.\d+)?)\}\{\(?x(?:([+-])(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})(?:(\+|-)(\d+(?:\.\d+)?))\}/i);
  const slashMatch = latexMatch ? null : normalized.match(/(?:f\(x\)|y)=([+-]?\d+(?:\.\d+)?)\/\(?\(?x(?:([+-])(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})(?:(\+|-)(\d+(?:\.\d+)?))\)?/i);
  const match = latexMatch || slashMatch;
  if (!match) return null;
  const a = Number(match[1]);
  const shift = match[3] ? Number(match[3]) : 0;
  const h = match[2] === "+" ? -shift : shift;
  const bMagnitude = Number(match[5]);
  const b = match[4] === "-" ? -bMagnitude : bMagnitude;
  const intervalMatch = Array.from(normalized.matchAll(/([\[(])([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)([\])])/g))
    .find((item) => {
      const from = Number(item[2]);
      const to = Number(item[3]);
      return Number.isFinite(from) && Number.isFinite(to) && from < to;
    });
  if (!Number.isFinite(a) || !Number.isFinite(h) || !Number.isFinite(b) || Math.abs(b) < 0.0001 || !intervalMatch) return null;
  return {
    a,
    h,
    b,
    interval: [Number(intervalMatch[2]), Number(intervalMatch[3])],
    closedStart: intervalMatch[1] === "[",
    closedEnd: intervalMatch[4] === "]",
  };
}

function parseSimpleInverseSquareInterval(source: string): {
  a: number;
  h: number;
  interval: [number, number];
  closedStart: boolean;
  closedEnd: boolean;
} | null {
  const normalized = `${source ?? ""}`
    .replace(/[០-៩]/g, (digit) => "០១២៣៤៥៦៧៨៩".indexOf(digit).toString())
    .replace(/\s+/g, "")
    .replace(/\\?left|\\?right/g, "");
  const latexMatch = normalized.match(/(?:f\(x\)|y)=\\frac\{([+-]?\d+(?:\.\d+)?)\}\{\(?x(?:([+-])(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})\}/i);
  const slashMatch = latexMatch ? null : normalized.match(/(?:f\(x\)|y)=([+-]?\d+(?:\.\d+)?)\/\(?\(?x(?:([+-])(\d+(?:\.\d+)?))?\)?(?:\^2|\^\{2\})\)?/i);
  const match = latexMatch || slashMatch;
  if (!match) return null;
  const a = Number(match[1]);
  const shift = match[3] ? Number(match[3]) : 0;
  const h = match[2] === "+" ? -shift : shift;
  const intervalMatch = Array.from(normalized.matchAll(/([\[(])([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)([\])])/g))
    .find((item) => {
      const from = Number(item[2]);
      const to = Number(item[3]);
      return Number.isFinite(from)
        && Number.isFinite(to)
        && from < to
        && Math.abs(from - h) > 0.0001
        && Math.abs(to - h) > 0.0001;
    });
  if (!Number.isFinite(a) || !Number.isFinite(h) || !intervalMatch) return null;
  return {
    a,
    h,
    interval: [Number(intervalMatch[2]), Number(intervalMatch[3])],
    closedStart: intervalMatch[1] === "[",
    closedEnd: intervalMatch[4] === "]",
  };
}

function graphIntentFromProblemIntent(intent: unknown): "secant-interval" | "shaded-interval" | "interval-points" | null {
  const normalized = String(intent || "").trim();
  if (normalized === "average-rate") return "secant-interval";
  if (normalized === "integral") return "shaded-interval";
  if (["range", "point-membership", "function-value", "variation", "other"].includes(normalized)) return "interval-points";
  return null;
}

function problemIntentFromStructuredHint(source: string): string | null {
  const text = `${source || ""}`;
  const marker = text.match(/\*{0,2}Problem Intent:?\*{0,2}\s*([a-z-]+)/i);
  if (marker) return marker[1];

  const compact = text
    .replace(/[០-៩]/g, (digit) => "០១២៣៤៥៦៧៨៩".indexOf(digit).toString())
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (/(^|[^a-z])(?:secant-interval|secant-slope|average-rate)([^a-z]|$)/.test(compact)) return "average-rate";
  if (/(^|[^a-z])(?:shaded-interval|integral|area-under-curve)([^a-z]|$)/.test(compact)) return "integral";
  if (/(^|[^a-z])point-membership([^a-z]|$)/.test(compact)) return "point-membership";
  if (/(^|[^a-z])function-value([^a-z]|$)/.test(compact)) return "function-value";
  if (/(^|[^a-z])variation([^a-z]|$)/.test(compact)) return "variation";
  if (/(^|[^a-z])range([^a-z]|$)/.test(compact)) return "range";
  return null;
}

function repairSessionDiagramPayload(problem: unknown, breakdownValue: unknown): unknown {
  const payload = toCanonicalJsonValue(breakdownValue, {});
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  const breakdown = { ...(payload as Record<string, unknown>) };
  const source = `${payloadText(problem)}\n${payloadText(breakdown.problem)}\n${payloadText(breakdown.solutionText)}`;
  const inverseSquareParsed = parseSimpleInverseSquareInterval(source);
  if (inverseSquareParsed) {
    const problemIntent = breakdown.problemIntent && breakdown.problemIntent !== "other"
      ? breakdown.problemIntent
      : problemIntentFromStructuredHint(source) || breakdown.problemIntent;
    if ((!breakdown.problemIntent || breakdown.problemIntent === "other") && problemIntent) breakdown.problemIntent = problemIntent;
    const structuredIntent = graphIntentFromProblemIntent(problemIntent);
    const diagramBlocks = Array.isArray(breakdown.diagramBlocks)
      ? breakdown.diagramBlocks
      : Array.isArray(breakdown.solutionBlocks)
        ? breakdown.solutionBlocks.filter((block) => (block as Record<string, unknown>)?.type === "diagram")
        : [];
    const inverseBlock = diagramBlocks.find((block) => {
      const record = block as Record<string, unknown>;
      const spec = record?.spec as Record<string, unknown> | undefined;
      const functions = Array.isArray(spec?.functions) ? spec.functions as Array<Record<string, unknown>> : [];
      return record?.diagramType === "function-graph"
        && functions.some((fn) => fn.kind === "inverse-square" || String(fn.latex || "").includes("x^2"));
    });
    if (inverseBlock) {
      const [from, to] = inverseSquareParsed.interval;
      const yAt = (x: number) => {
        const dx = x - inverseSquareParsed.h;
        return Math.abs(dx) > 0.0001 ? inverseSquareParsed.a / (dx * dx) : Number.NaN;
      };
      const yFrom = yAt(from);
      const yTo = yAt(to);
      if (Number.isFinite(yFrom) && Number.isFinite(yTo)) {
        const existingSpec = (inverseBlock as Record<string, unknown>).spec as Record<string, unknown> | undefined;
        const existingFunctions = Array.isArray(existingSpec?.functions) ? existingSpec.functions as Array<Record<string, unknown>> : [];
        const existingShadedRegions = Array.isArray(existingSpec?.shadedRegions) ? existingSpec.shadedRegions : [];
        const hasStructuredShadedRegion = existingShadedRegions.some((region) => {
          const item = region as Record<string, unknown>;
          return Number.isFinite(Number(item.from)) && Number.isFinite(Number(item.to)) && Math.abs(Number(item.from) - Number(item.to)) > 0.0001;
        });
        const existingHasSecant = existingFunctions.some((fn) => {
          if (fn.kind !== "linear") return false;
          const params = fn.params && typeof fn.params === "object" ? fn.params as Record<string, unknown> : {};
          const m = Number(params.m);
          const b = Number(params.b);
          return Number.isFinite(m)
            && Number.isFinite(b)
            && Math.abs((m * from + b) - yFrom) < 0.08
            && Math.abs((m * to + b) - yTo) < 0.08;
        });
        const explicitIntent = typeof existingSpec?.diagramIntent === "string" ? existingSpec.diagramIntent : "";
        const diagramIntent = explicitIntent === "secant-interval" || existingHasSecant
          ? "secant-interval"
          : explicitIntent === "shaded-interval" || hasStructuredShadedRegion
            ? "shaded-interval"
            : structuredIntent || "interval-points";
        const hText = inverseSquareParsed.h === 0 ? "x" : `(x${inverseSquareParsed.h < 0 ? "+" : "-"}${Math.abs(inverseSquareParsed.h)})`;
        const functions: Array<Record<string, unknown>> = [{
          kind: "inverse-square",
          latex: `y=\\frac{${inverseSquareParsed.a}}{${hText}^2}`,
          points: [],
          params: {
            a: inverseSquareParsed.a,
            h: inverseSquareParsed.h,
            k: 0,
            verticalAsymptote: inverseSquareParsed.h,
            horizontalAsymptote: 0,
            p: 2,
          },
          color: "primary",
        }];
        if (diagramIntent === "secant-interval") {
          const m = (yTo - yFrom) / (to - from);
          const b = yFrom - m * from;
          functions.push({ kind: "linear", latex: `y=${Number(m.toFixed(6))}x${b >= 0 ? "+" : ""}${Number(b.toFixed(6))}`, points: [], params: { m, b }, color: "secondary" });
        }
        const repaired = normalizeDiagramBlocks([{
          diagramType: "function-graph",
          spec: {
            ...(existingSpec || {}),
            graphStyle: "reciprocal-interval",
            diagramIntent,
            domain: [from, to],
            range: [0, Math.max(4, Math.ceil(Math.max(yFrom, yTo) + 1))],
            functions,
            featurePoints: [
              { point: [from, yFrom], label: `(${from}, ${Number(yFrom.toFixed(3))})`, color: "primary", closed: diagramIntent === "secant-interval" || inverseSquareParsed.closedStart },
              { point: [to, yTo], label: `(${to}, ${Number(yTo.toFixed(3))})`, color: "primary", closed: diagramIntent === "secant-interval" || inverseSquareParsed.closedEnd },
            ],
            guideLines: [],
            shadedRegions: diagramIntent === "shaded-interval"
              ? hasStructuredShadedRegion ? existingShadedRegions : [{ from, to, baseline: 0, functionIndex: 0, color: "primary" }]
              : [],
          },
        }]);
        if (repaired.length) {
          breakdown.diagramBlocks = repaired;
          if (Array.isArray(breakdown.solutionBlocks)) {
            breakdown.solutionBlocks = breakdown.solutionBlocks.map((block) => ((block as Record<string, unknown>)?.type === "diagram" ? repaired[0] : block));
          }
          logger.info("[session:repair-inverse-square-interval-diagram]", {
            a: inverseSquareParsed.a,
            h: inverseSquareParsed.h,
            interval: inverseSquareParsed.interval,
            diagramIntent,
            featurePoints: [[from, yFrom], [to, yTo]],
          });
          return breakdown;
        }
      }
    }
  }
  const rationalEvenParsed = parseSimpleRationalEvenInterval(source);
  if (rationalEvenParsed) {
    const problemIntent = breakdown.problemIntent && breakdown.problemIntent !== "other"
      ? breakdown.problemIntent
      : problemIntentFromStructuredHint(source) || breakdown.problemIntent;
    if ((!breakdown.problemIntent || breakdown.problemIntent === "other") && problemIntent) breakdown.problemIntent = problemIntent;
    const structuredIntent = graphIntentFromProblemIntent(problemIntent);
    const diagramBlocks = Array.isArray(breakdown.diagramBlocks)
      ? breakdown.diagramBlocks
      : Array.isArray(breakdown.solutionBlocks)
        ? breakdown.solutionBlocks.filter((block) => (block as Record<string, unknown>)?.type === "diagram")
        : [];
    const rationalEvenBlock = diagramBlocks.find((block) => {
      const record = block as Record<string, unknown>;
      const spec = record?.spec as Record<string, unknown> | undefined;
      const functions = Array.isArray(spec?.functions) ? spec.functions as Array<Record<string, unknown>> : [];
      return record?.diagramType === "function-graph"
        && functions.some((fn) => fn.kind === "rational-even" || String(fn.latex || "").includes("x^2"));
    });
    if (rationalEvenBlock) {
      const [from, to] = rationalEvenParsed.interval;
      const yAt = (x: number) => {
        const denominator = (x - rationalEvenParsed.h) * (x - rationalEvenParsed.h) + rationalEvenParsed.b;
        return Math.abs(denominator) > 0.0001 ? rationalEvenParsed.a / denominator : Number.NaN;
      };
      const yFrom = yAt(from);
      const yTo = yAt(to);
      if (Number.isFinite(yFrom) && Number.isFinite(yTo)) {
        const existingSpec = (rationalEvenBlock as Record<string, unknown>).spec as Record<string, unknown> | undefined;
        const existingShadedRegions = Array.isArray(existingSpec?.shadedRegions) ? existingSpec.shadedRegions : [];
        const hasStructuredShadedRegion = existingShadedRegions.some((region) => {
          const item = region as Record<string, unknown>;
          return Number.isFinite(Number(item.from)) && Number.isFinite(Number(item.to)) && Math.abs(Number(item.from) - Number(item.to)) > 0.0001;
        });
        const explicitIntent = typeof existingSpec?.diagramIntent === "string" ? existingSpec.diagramIntent : "";
        const diagramIntent = explicitIntent === "shaded-interval" || hasStructuredShadedRegion
          ? "shaded-interval"
          : structuredIntent || "interval-points";
        const hText = rationalEvenParsed.h === 0 ? "x" : `(x${rationalEvenParsed.h < 0 ? "+" : "-"}${Math.abs(rationalEvenParsed.h)})`;
        const denominatorLatex = `${hText}^2${rationalEvenParsed.b >= 0 ? "+" : ""}${rationalEvenParsed.b}`;
        const repaired = normalizeDiagramBlocks([{
          diagramType: "function-graph",
          spec: {
            ...(existingSpec || {}),
            graphStyle: "reciprocal-interval",
            diagramIntent,
            domain: [Math.min(0, from), Math.max(to, from + 1)],
            range: [0, Math.max(2.5, Math.ceil(Math.max(yFrom, yTo) * 2) / 2 + 0.5)],
            functions: [{
              kind: "rational-even",
              latex: `y=\\frac{${rationalEvenParsed.a}}{${denominatorLatex}}`,
              points: [],
              params: { a: rationalEvenParsed.a, h: rationalEvenParsed.h, b: rationalEvenParsed.b, k: 0 },
              color: "primary",
            }],
            featurePoints: [
              { point: [from, yFrom], label: `(${from}, ${Number(yFrom.toFixed(3))})`, color: "primary", closed: rationalEvenParsed.closedStart },
              { point: [to, yTo], label: `(${to}, ${Number(yTo.toFixed(3))})`, color: "primary", closed: rationalEvenParsed.closedEnd },
            ],
            guideLines: [],
            shadedRegions: diagramIntent === "shaded-interval"
              ? hasStructuredShadedRegion ? existingShadedRegions : [{ from, to, baseline: 0, functionIndex: 0, color: "primary" }]
              : [],
          },
        }]);
        if (repaired.length) {
          breakdown.diagramBlocks = repaired;
          if (Array.isArray(breakdown.solutionBlocks)) {
            breakdown.solutionBlocks = breakdown.solutionBlocks.map((block) => ((block as Record<string, unknown>)?.type === "diagram" ? repaired[0] : block));
          }
          logger.info("[session:repair-rational-even-interval-diagram]", {
            a: rationalEvenParsed.a,
            h: rationalEvenParsed.h,
            b: rationalEvenParsed.b,
            interval: rationalEvenParsed.interval,
            diagramIntent,
            featurePoints: [[from, yFrom], [to, yTo]],
          });
          return breakdown;
        }
      }
    }
  }

  const parsed = parseSimpleReciprocalInterval(source);
  if (!parsed) return breakdown;
  const problemIntent = breakdown.problemIntent && breakdown.problemIntent !== "other"
    ? breakdown.problemIntent
    : problemIntentFromStructuredHint(source) || breakdown.problemIntent;
  if ((!breakdown.problemIntent || breakdown.problemIntent === "other") && problemIntent) breakdown.problemIntent = problemIntent;
  const structuredIntent = graphIntentFromProblemIntent(problemIntent);

  const diagramBlocks = Array.isArray(breakdown.diagramBlocks)
    ? breakdown.diagramBlocks
    : Array.isArray(breakdown.solutionBlocks)
      ? breakdown.solutionBlocks.filter((block) => (block as Record<string, unknown>)?.type === "diagram")
      : [];
  const reciprocalIntervalBlock = diagramBlocks.find((block) => {
    const record = block as Record<string, unknown>;
    const spec = record?.spec as Record<string, unknown> | undefined;
    const functions = Array.isArray(spec?.functions) ? spec.functions as Array<Record<string, unknown>> : [];
    return record?.diagramType === "function-graph"
      && spec?.graphStyle === "reciprocal-interval"
      && functions.some((fn) => fn.kind === "rational-reciprocal");
  });
  if (!reciprocalIntervalBlock) return breakdown;

  const [from, to] = parsed.interval;
  const yFrom = parsed.a / (from - parsed.h);
  const yTo = parsed.a / (to - parsed.h);
  if (!Number.isFinite(yFrom) || !Number.isFinite(yTo)) return breakdown;

  const reciprocalIntervalSpec = (reciprocalIntervalBlock as Record<string, unknown>).spec as Record<string, unknown> | undefined;
  const existingShadedRegions = Array.isArray(reciprocalIntervalSpec?.shadedRegions) ? reciprocalIntervalSpec.shadedRegions : [];
  const hasStructuredShadedRegion = existingShadedRegions.some((region) => {
    const item = region as Record<string, unknown>;
    return Number.isFinite(Number(item.from)) && Number.isFinite(Number(item.to)) && Math.abs(Number(item.from) - Number(item.to)) > 0.0001;
  });
  const shadedRegions = hasStructuredShadedRegion
    ? existingShadedRegions
    : [{ from, to, baseline: 0, functionIndex: 0, color: "primary" }];
  const existingFunctions = Array.isArray(reciprocalIntervalSpec?.functions) ? reciprocalIntervalSpec.functions as Array<Record<string, unknown>> : [];
  const existingHasSecant = existingFunctions.some((fn) => {
    if (fn.kind !== "linear") return false;
    const params = fn.params && typeof fn.params === "object" ? fn.params as Record<string, unknown> : {};
    const m = Number(params.m);
    const b = Number(params.b);
    return Number.isFinite(m)
      && Number.isFinite(b)
      && Math.abs((m * from + b) - yFrom) < 0.08
      && Math.abs((m * to + b) - yTo) < 0.08;
  });
  const explicitIntent = typeof reciprocalIntervalSpec?.diagramIntent === "string" ? reciprocalIntervalSpec.diagramIntent : "";
  const diagramIntent = explicitIntent === "secant-interval" || existingHasSecant
    ? "secant-interval"
    : explicitIntent === "shaded-interval" || hasStructuredShadedRegion
      ? "shaded-interval"
      : structuredIntent || "interval-points";
  const functions: Array<Record<string, unknown>> = [{
    kind: "rational-reciprocal",
    latex: `y=\\frac{${parsed.a}}{x${parsed.h < 0 ? "+" : parsed.h > 0 ? "-" : ""}${parsed.h ? Math.abs(parsed.h) : ""}}`,
    points: [],
    params: { a: parsed.a, h: parsed.h, k: 0, verticalAsymptote: parsed.h, horizontalAsymptote: 0 },
    color: "primary",
  }];
  if (diagramIntent === "secant-interval") {
    const m = (yTo - yFrom) / (to - from);
    const b = yFrom - m * from;
    functions.push({ kind: "linear", latex: `y=${Number(m.toFixed(6))}x${b >= 0 ? "+" : ""}${Number(b.toFixed(6))}`, points: [], params: { m, b }, color: "secondary" });
  }

  const repaired = normalizeDiagramBlocks([{
    diagramType: "function-graph",
    spec: {
      graphStyle: "reciprocal-interval",
      diagramIntent,
      domain: [from, to],
      range: [-1, Math.max(4, Math.ceil(Math.max(yFrom, yTo) + 1))],
      functions,
      featurePoints: [
        { point: [from, yFrom], label: `(${from}, ${Number(yFrom.toFixed(3))})`, color: "primary", closed: true },
        { point: [to, yTo], label: `(${to}, ${Number(yTo.toFixed(3))})`, color: "primary", closed: true },
      ],
      shadedRegions: diagramIntent === "shaded-interval" ? shadedRegions : [],
    },
  }]);
  if (!repaired.length) return breakdown;

  breakdown.diagramBlocks = repaired;
  if (Array.isArray(breakdown.solutionBlocks)) {
    breakdown.solutionBlocks = breakdown.solutionBlocks.map((block) => ((block as Record<string, unknown>)?.type === "diagram" ? repaired[0] : block));
  }
  logger.info("[session:repair-reciprocal-interval-diagram]", {
    a: parsed.a,
    h: parsed.h,
    interval: parsed.interval,
    diagramIntent,
    featurePoints: [[from, yFrom], [to, yTo]],
  });
  return breakdown;
}

function toCanonicalNullableJsonString(value: unknown): string | null {
  if (value == null) return null;
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") {
    try {
      return JSON.stringify(parsed);
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function toCanonicalNullableJsonValue(value: unknown): unknown | null {
  if (value == null) return null;
  const parsed = parseJsonDeep(value);
  if (parsed && typeof parsed === "object") return parsed;
  return null;
}

const CANONICAL_SUBJECTS: CanonicalSubject[] = [
  { slug: "physics", name: "Physics", aliases: ["physics", "physic", "រូបវិទ្យា", "រូប វិទ្យា"] },
  { slug: "mathematics", name: "Math", aliases: ["mathematics", "math", "maths", "គណិតវិទ្យា", "គណិត វិទ្យា"] },
  { slug: "chemistry", name: "Chemistry", aliases: ["chemistry", "គីមីវិទ្យា", "គីមី វិទ្យា"] },
];

function normalizeSubjectKey(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCanonicalSubject(input: string): CanonicalSubject | null {
  const key = normalizeSubjectKey(input);
  if (!key) return null;

  for (const subject of CANONICAL_SUBJECTS) {
    const aliasSet = new Set(subject.aliases.map((alias) => normalizeSubjectKey(alias)));
    if (aliasSet.has(key)) return subject;
  }
  return null;
}

function chooseBestSubjectMatch(candidates: SubjectRow[], canonical: CanonicalSubject | null): SubjectRow | null {
  if (!candidates.length) return null;
  if (!canonical) return candidates[0];

  const canonicalAliasSet = new Set(canonical.aliases.map((alias) => normalizeSubjectKey(alias)));
  let best: SubjectRow | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const normalizedName = normalizeSubjectKey(candidate.name);
    let score = 0;
    if (candidate.slug === canonical.slug) score += 100;
    if (slugify(candidate.name) === canonical.slug) score += 60;
    if (canonicalAliasSet.has(normalizedName)) score += 30;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best ?? candidates[0];
}

/**
 * Resolve a topic_id from the topics table using subject_id + slug.
 * Falls back to a hardcoded pattern map when the DB lookup finds no match,
 * which covers freshly-created sessions where the slug is well-known.
 */
async function resolveTopicId(subjectId: string | null, topicSlug: string | null | undefined): Promise<string | null> {
  if (!topicSlug) return null;
  const slug = String(topicSlug).trim().toLowerCase();
  if (!slug) return null;

  // ── DB lookup first: exact match on subject_id + slug ─────────────────────
  if (subjectId) {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("topics")
      .select("id")
      .eq("subject_id", subjectId)
      .eq("slug", slug)
      .maybeSingle();
    if (data?.id) return String(data.id);

    // Partial slug match (e.g. "probability-stats" contains "probability")
    const { data: allTopics } = await db
      .from("topics")
      .select("id, slug")
      .eq("subject_id", subjectId);
    if (allTopics) {
      const rows = allTopics as Array<{ id: string; slug: string }>;
      const partial = rows.find((r) => slug.includes(r.slug) || r.slug.includes(slug));
      if (partial) return String(partial.id);
    }
  }

  // ── Hardcoded fallback (known canonical IDs from seed_taxonomy) ────────────
  // Only use these IDs when the topics table is seeded; verify existence first.
  const candidateId = (() => {
    if (slug.includes("algebra")) return "topic-math-algebra";
    if (slug.includes("geometry")) return "topic-math-geometry";
    if (slug.includes("calculus")) return "topic-math-calculus";
    if (slug.includes("probability")) return "topic-math-probability-stats";
    if (slug.includes("arithmetic")) return "topic-math-arithmetic";
    if (slug.includes("mechanic")) return "topic-physics-mechanics";
    if (slug.includes("electromagnetism")) return "topic-physics-electromagnetism";
    if (slug.includes("thermodynamics")) return "topic-physics-thermodynamics";
    if (slug.includes("optics")) return "topic-physics-optics-waves";
    if (slug.includes("modern")) return "topic-physics-modern-physics";
    if (slug.includes("organic")) return "topic-chemistry-organic-chemistry";
    if (slug.includes("inorganic")) return "topic-chemistry-inorganic-chemistry";
    if (slug.includes("biochem")) return "topic-chemistry-biochemistry";
    if (slug.includes("physical")) return "topic-chemistry-physical-chemistry";
    if (slug.includes("general")) return "topic-chemistry-general-chemistry";
    return null;
  })();

  if (candidateId) {
    const db = getSupabaseAdmin();
    const { data: exists } = await db.from("topics").select("id").eq("id", candidateId).maybeSingle();
    if (exists?.id) return candidateId;
  }

  return null;
}

const MATH_ID = "a02678fd-382c-48dd-9ad9-cce00a642b7d";
const PHYSICS_ID = "cdeb148b-8345-4166-a4f3-122362f999f7";
const CHEMISTRY_ID = "963a5e0a-7e16-4933-a57a-b0e3f137d44d";
const SESSION_LIST_SELECT = "id,user_id,title,subject_id,topic_id,problem,node_count,duration_seconds,image_url,bookmarked,created_at";

function resolveSubjectNameFromId(subjectId: string | null | undefined): string | null {
  if (!subjectId) return null;
  if (subjectId === MATH_ID) return "Math";
  if (subjectId === PHYSICS_ID) return "Physics";
  if (subjectId === CHEMISTRY_ID) return "Chemistry";
  return null;
}

function resolveTopicSlugFromId(topicId: string): string | null {
  if (topicId.startsWith("topic-math-")) return topicId.replace("topic-math-", "");
  if (topicId.startsWith("topic-physics-")) return topicId.replace("topic-physics-", "");
  if (topicId.startsWith("topic-chemistry-")) return topicId.replace("topic-chemistry-", "");
  return null;
}

function segmentProblemText(text: string): Array<{ type: 'text' | 'math'; value: string }> {
  if (!text) return [];
  const segments: Array<{ type: 'text' | 'math'; value: string }> = [];
  const regex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const matchIndex = match.index;
    if (matchIndex > lastIndex) {
      const plainText = text.slice(lastIndex, matchIndex);
      if (plainText) {
        segments.push({ type: 'text', value: plainText });
      }
    }
    const rawMath = match[0];
    let mathVal = rawMath;
    if (rawMath.startsWith('$$') && rawMath.endsWith('$$')) {
      mathVal = rawMath.slice(2, -2);
    } else if (rawMath.startsWith('$') && rawMath.endsWith('$')) {
      mathVal = rawMath.slice(1, -1);
    }
    segments.push({ type: 'math', value: mathVal.trim() });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex);
    if (plainText) {
      segments.push({ type: 'text', value: plainText });
    }
  }

  return segments;
}

function parseProblemText(problemVal: unknown): string {
  if (typeof problemVal === "string") {
    if (problemVal.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(problemVal);
        return parsed.text || problemVal;
      } catch {
        return problemVal;
      }
    }
    return problemVal;
  }
  if (problemVal && typeof problemVal === "object") {
    return (problemVal as any).text || JSON.stringify(problemVal);
  }
  return "";
}

function normalizeSessionRow(row: Record<string, unknown>): StudySession {
  const subjectId = typeof row.subject_id === "string" ? row.subject_id : null;
  const resolvedSubject = resolveSubjectNameFromId(subjectId) || "General";
  const topicId = typeof row.topic_id === "string" ? row.topic_id : null;
  const topicSlug = typeof row.topic === "string" ? row.topic : (topicId ? resolveTopicSlugFromId(topicId) : null);

  const parsedText = parseProblemText(row.problem);
  let parsedJson: any = null;
  if (row.problem) {
    if (typeof row.problem === "string") {
      if (row.problem.trim().startsWith("{")) {
        try {
          parsedJson = JSON.parse(row.problem);
        } catch {
          parsedJson = { text: row.problem, segments: segmentProblemText(row.problem) };
        }
      } else {
        parsedJson = { text: row.problem, segments: segmentProblemText(row.problem) };
      }
    } else if (typeof row.problem === "object") {
      parsedJson = row.problem;
      if (!parsedJson.segments && parsedJson.text) {
        parsedJson.segments = segmentProblemText(parsedJson.text);
      }
    }
  }

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: String(row.title),
    subject: resolvedSubject,
    subject_id: subjectId,
    topic: topicSlug,
    topic_id: topicId,
    problem: parsedText,
    problem_json: parsedJson,
    node_count: Number(row.node_count ?? 0),
    duration_seconds: typeof row.duration_seconds === "number" ? row.duration_seconds : null,
    breakdown_json: toCanonicalJsonString(row.breakdown_json, {}),
    visual_table_json: toCanonicalNullableJsonString(row.visual_table_json),
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    bookmarked: Boolean(row.bookmarked ?? false),
    created_at: String(row.created_at),
    prompt_tokens:     typeof row.prompt_tokens     === "number" ? row.prompt_tokens     : null,
    completion_tokens: typeof row.completion_tokens === "number" ? row.completion_tokens : null,
    total_tokens:      typeof row.total_tokens      === "number" ? row.total_tokens      : null,
    ai_cost_usd:       typeof row.ai_cost_usd       === "number" ? row.ai_cost_usd       : null,
  };
}

function normalizeSubjectName(subject: string | null | undefined): string {
  const normalized = String(subject ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Map to Physics
  if (
    normalized.includes("physics") ||
    normalized.includes("physic") ||
    normalized.includes("រូបវិទ្យា") ||
    normalized.includes("រូប វិទ្យា")
  ) {
    return "Physics";
  }

  // Map to Chemistry
  if (
    normalized.includes("chemistry") ||
    normalized.includes("chemi") ||
    normalized.includes("គីមីវិទ្យា") ||
    normalized.includes("គីមី វិទ្យា")
  ) {
    return "Chemistry";
  }

  // Everything else maps to Math (Mathematics, Algebra, Calculus, Khmer math terms, sequences, etc.)
  return "Math";
}

function deterministicSlug(text: string): string {
  // Deterministic fallback slug for non-Latin text (e.g. Khmer) where slugify() returns "".
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `subject-${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

export async function resolveOrCreateSubjectId(rawSubject: string): Promise<string> {
  const db = getSupabaseAdmin();
  const subjectName = normalizeSubjectName(rawSubject);
  const canonical = detectCanonicalSubject(subjectName);
  const subjectSlug =
    canonical?.slug ?? (slugify(subjectName) || deterministicSlug(subjectName));
  const subjectDisplayName = canonical?.name ?? subjectName;
  const normalizedInput = normalizeSubjectKey(subjectName);

  const { data: allSubjects, error: listError } = await db
    .from("subjects")
    .select("id, name, slug")
    .limit(1000);
  if (listError) throw new AppError(listError.message, 500);

  const rows = ((allSubjects ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      slug: String(row.slug ?? ""),
    }))
    .filter((row) => row.id && row.name);

  if (subjectSlug) {
    const bySlug = rows.find((row) => row.slug === subjectSlug);
    if (bySlug) return bySlug.id;
  }

  if (canonical) {
    const canonicalAliasSet = new Set(canonical.aliases.map((alias) => normalizeSubjectKey(alias)));
    const aliasMatches = rows.filter((row) => canonicalAliasSet.has(normalizeSubjectKey(row.name)));
    const bestAliasMatch = chooseBestSubjectMatch(aliasMatches, canonical);
    if (bestAliasMatch) return bestAliasMatch.id;
  }

  const exactName = rows.find((row) => normalizeSubjectKey(row.name) === normalizedInput);
  if (exactName) return exactName.id;

  if (subjectSlug) {
    const { data: upsertedSubject, error: upsertError } = await db
      .from("subjects")
      .upsert(
        {
          id: generateId(),
          name: subjectDisplayName,
          slug: subjectSlug,
          created_at: nowISO(),
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();

    if (upsertError) throw new AppError(upsertError.message, 500);
    return String(upsertedSubject.id);
  }

  const { data: existingByName, error: nameLookupError } = await db
    .from("subjects")
    .select("id")
    .eq("name", subjectName)
    .maybeSingle();

  if (nameLookupError) throw new AppError(nameLookupError.message, 500);
  if (existingByName?.id) return String(existingByName.id);

  const { data: insertedSubject, error: insertError } = await db
    .from("subjects")
    .insert({
      id: generateId(),
      name: subjectDisplayName,
      slug: `subject-${generateId().slice(0, 8)}`,
      created_at: nowISO(),
    })
    .select("id")
    .single();

  if (insertError) throw new AppError(insertError.message, 500);
  return String(insertedSubject.id);
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSession(userId: string, dto: CreateSessionDTO): Promise<StudySession> {
  const db = getSupabaseAdmin();
  const subject = normalizeSubjectName(dto.subject);
  const subjectId = dto.subject_id ?? (await resolveOrCreateSubjectId(subject));

  const breakdownVal = dto.breakdown_json as any;
  const topicSlug = dto.topic || breakdownVal?.topic || null;
  const topicId = dto.topic_id || await resolveTopicId(subjectId, topicSlug);
  const repairedBreakdown = repairSessionDiagramPayload(dto.problem, dto.breakdown_json);

  const session: StudySession = {
    id: generateId(),
    user_id: userId,
    title: dto.title,
    subject,
    subject_id: subjectId,
    topic: topicSlug,
    topic_id: topicId,
    problem: dto.problem,
    node_count: dto.node_count,
    duration_seconds: dto.duration_seconds ?? null,
    breakdown_json: toCanonicalJsonString(repairedBreakdown, {}),
    visual_table_json: toCanonicalNullableJsonString(dto.visual_table_json),
    image_url: dto.image_url ?? null,
    created_at: nowISO(),
  };

  // Exclude 'subject' (dropped column) from DB insert; 'topic' is a valid TEXT column and is kept.
  const { subject: _omitS, ...dbPayload } = session;
  const sessionForDb = {
    ...dbPayload,
    problem: toCanonicalJsonValue(
      {
        text: dto.problem,
        segments: segmentProblemText(dto.problem)
      },
      { text: "", segments: [] }
    ),
    breakdown_json: toCanonicalJsonValue(repairedBreakdown, {}),
    visual_table_json: toCanonicalNullableJsonValue(dto.visual_table_json),
  };

  let insertPayload: any = sessionForDb;
  let { data, error } = await db
    .from("study_sessions")
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    // Backward compatibility for environments where topic/topic_id columns do not exist yet.
    if (error.message.includes("column \"topic\" of relation \"study_sessions\" does not exist") || (error.message.includes("topic") && error.message.includes("does not exist"))) {
      const { topic_id: _omitTi, topic: _omitTopic, ...legacySession } = insertPayload;
      const legacyPayload = { ...legacySession };
      const { data: legacyData, error: legacyError } = await db
        .from("study_sessions")
        .insert(legacyPayload)
        .select()
        .single();
      if (legacyError) {
        if (legacyError.message.includes("visual_table_json") && legacyError.message.includes("does not exist")) {
          const { visual_table_json: _omitVt, ...sessionWithoutVt } = legacyPayload;
          const { data: vtData, error: vtError } = await db
            .from("study_sessions")
            .insert(sessionWithoutVt)
            .select()
            .single();
          if (vtError) throw new AppError(vtError.message, 500);
          const normalized = normalizeSessionRow((vtData ?? {}) as Record<string, unknown>);
          return { ...normalized, topic: null, topic_id: null, visual_table_json: session.visual_table_json ?? null };
        }
        throw new AppError(legacyError.message, 500);
      }
      const normalized = normalizeSessionRow((legacyData ?? {}) as Record<string, unknown>);
      return { ...normalized, topic: null, topic_id: null };
    }

    // Backward compatibility for environments where visual_table_json has not been added yet.
    if (error.message.includes("visual_table_json") && error.message.includes("does not exist")) {
      const { visual_table_json: _omitVt, ...sessionWithoutVt } = insertPayload;
      const { data: vtData, error: vtError } = await db
        .from("study_sessions")
        .insert(sessionWithoutVt)
        .select()
        .single();
      if (vtError) throw new AppError(vtError.message, 500);
      const normalized = normalizeSessionRow((vtData ?? {}) as Record<string, unknown>);
      return { ...normalized, visual_table_json: session.visual_table_json ?? null };
    }
    // Backward compatibility for environments where subject_id has not been added yet.
    if (error.message.includes("subject_id") && error.message.includes("does not exist")) {
      const { subject_id: _omit, ...legacySession } = insertPayload;
      const { data: legacyData, error: legacyError } = await db
        .from("study_sessions")
        .insert(legacySession)
        .select()
        .single();
      if (legacyError) throw new AppError(legacyError.message, 500);
      const normalized = normalizeSessionRow((legacyData ?? {}) as Record<string, unknown>);
      return { ...normalized, subject_id: subjectId };
    }

    // FK violation on topic_id: the resolved topic ID doesn't exist in the topics table.
    // Retry with topic_id = null so the session is still created.
    if (error.message.includes("study_sessions_topic_id_fkey") || (error.message.includes("topic_id") && error.message.includes("foreign key"))) {
      const { topic_id: _omitTopicId, ...payloadWithoutTopic } = insertPayload;
      const { data: retryData, error: retryError } = await db
        .from("study_sessions")
        .insert({ ...payloadWithoutTopic, topic_id: null })
        .select()
        .single();
      if (retryError) throw new AppError(retryError.message, 500);
      const normalized = normalizeSessionRow((retryData ?? {}) as Record<string, unknown>);
      return { ...normalized, topic_id: null };
    }

    throw new AppError(error.message, 500);
  }

  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateSession(id: string, userId: string, updates: UpdateSessionDTO): Promise<StudySession> {
  const db = getSupabaseAdmin();

  const canEdit = await canUserEditSession(id, userId);
  if (!canEdit) throw new AppError("Forbidden", 403);

  // Strip 'subject' (dropped DB column); all other fields including 'topic' pass through.
  const { subject: _omitS, ...updatesWithoutSubject } = updates as Record<string, unknown>;
  const normalizedUpdates: Record<string, unknown> = { ...updatesWithoutSubject };
  if (Object.prototype.hasOwnProperty.call(updates, "breakdown_json")) {
    normalizedUpdates.breakdown_json = toCanonicalJsonValue(repairSessionDiagramPayload(updates.problem ?? "", updates.breakdown_json), {});
  }
  if (Object.prototype.hasOwnProperty.call(updates, "visual_table_json")) {
    normalizedUpdates.visual_table_json = toCanonicalNullableJsonValue(updates.visual_table_json);
  }

  const { data, error } = await db
    .from("study_sessions")
    .update(normalizedUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}

export async function getUserSessions(userId: string, limit?: number, offset?: number): Promise<(StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[]> {
  const db = getSupabaseAdmin();
  console.log("[getUserSessions] SUPABASE_URL:", process.env.SUPABASE_URL);
  console.log("[getUserSessions] userId:", userId);

  // Owned sessions
  console.log("[getUserSessions] querying study_sessions...");
  const { data: ownedData, error: ownedError } = await db
    .from("study_sessions")
    .select(SESSION_LIST_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  console.log("[getUserSessions] study_sessions result:", { count: ownedData?.length, error: ownedError?.message });
  if (ownedError) throw new AppError(ownedError.message, 500);

  // Sessions where the user is a member (editor/viewer)
  console.log("[getUserSessions] querying session_members...");
  const { data: memberRows, error: memberError } = await db
    .from("session_members")
    .select("session_id, role")
    .eq("user_id", userId);
  console.log("[getUserSessions] session_members result:", { count: (memberRows as any)?.length, error: memberError?.message });

  let sharedSessions: (StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[] = [];

  if (memberRows && memberRows.length > 0) {
    const sharedIds = (memberRows as Array<{ session_id: string; role: string }>).map((m) => m.session_id);

    const { data: sharedData } = await db
      .from("study_sessions")
      .select(SESSION_LIST_SELECT)
      .in("id", sharedIds)
      .order("created_at", { ascending: false });

    if (sharedData) {
      const roleBySessionId = new Map(
        (memberRows as Array<{ session_id: string; role: string }>).map((m) => [m.session_id, m.role as 'editor' | 'viewer'])
      );
      sharedSessions = (sharedData as Record<string, unknown>[]).map((row) => ({
        ...normalizeSessionRow(row),
        user_role: roleBySessionId.get(String(row.id)) ?? 'viewer',
      }));
    }
  }

  const ownedSessions = ((ownedData ?? []) as Record<string, unknown>[]).map((row) => ({
    ...normalizeSessionRow(row),
    user_role: 'owner' as const,
  }));

  // Merge: owned first, then shared. Deduplicate by session ID.
  const seen = new Set<string>();
  const merged: (StudySession & { user_role: 'owner' | 'editor' | 'viewer' })[] = [];
  for (const s of [...ownedSessions, ...sharedSessions]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  // Sort by created_at descending
  merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  let paginatedMerged = merged;
  if (typeof offset === 'number' || typeof limit === 'number') {
    const start = offset ?? 0;
    const end = typeof limit === 'number' ? start + limit : undefined;
    paginatedMerged = merged.slice(start, end);
  }

  // Batch-fetch chat message counts for all sessions in one query.
  const sessionIds = paginatedMerged.map((s) => s.id);
  console.log("[getUserSessions] chat_count: sessionIds", sessionIds.length, sessionIds.slice(0, 3));
  if (sessionIds.length > 0) {
    const { data: chatRows, error: chatError } = await db
      .from("chat_messages")
      .select("session_id")
      .in("session_id", sessionIds);

    console.log("[getUserSessions] chat_count: chatRows", chatRows?.length ?? 0, "error:", chatError?.message ?? null);
    console.log("[getUserSessions] chat_count: sample rows", (chatRows ?? []).slice(0, 3));

    const chatCountMap = new Map<string, number>();
    for (const row of (chatRows ?? []) as Array<{ session_id: string }>) {
      chatCountMap.set(row.session_id, (chatCountMap.get(row.session_id) ?? 0) + 1);
    }
    console.log("[getUserSessions] chat_count: countMap entries", chatCountMap.size, [...chatCountMap.entries()].slice(0, 3));
    for (const s of paginatedMerged) {
      s.chat_count = chatCountMap.get(s.id) ?? 0;
    }
  }

  return paginatedMerged;
}

export async function deleteSession(id: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();

  const { error } = await db
    .from("study_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new AppError(error.message, 500);
}

export async function getSessionById(id: string, userId: string): Promise<StudySession | null> {
  const db = getSupabaseAdmin();

  const canAccess = await canUserAccessSession(id, userId);
  if (!canAccess) return null;

  const { data, error } = await db
    .from("study_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return normalizeSessionRow((data ?? {}) as Record<string, unknown>);
}
