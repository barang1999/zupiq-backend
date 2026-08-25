/**
 * Thin client that talks to the Python resolver service.
 * All calls are best-effort — failures never block the AI path.
 */
import { logger } from "../utils/logger.js";

const RESOLVER_URL = (process.env.RESOLVER_SERVICE_URL ?? "http://localhost:8001").replace(/\/$/, "");
const RESOLVE_TIMEOUT_MS = 1500;           // pre-AI check: tight budget, on critical path
export const RESOLVE_TIMEOUT_POST_OCR_MS = 5000; // post-OCR check: AI already ran, can wait longer

export interface ResolveResult {
  matched: boolean;
  confidence: number;
  mode: "instant" | "hint" | "none";
  session_id?: string;
  final_answer?: string;
  solution_text?: string;
  breakdown_json?: unknown;
}

/** Check the semantic cache. Times out after 1.5 s (pre-AI) or 5 s (post-OCR). */
export async function resolveFromCache(
  problemText: string,
  subject?: string | null,
  language?: string | null,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<ResolveResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const resolvedLanguage = language ?? "en";
  try {
    logger.info("[resolver] resolve request", {
      subject: subject ?? null,
      language: resolvedLanguage,
      timeoutMs,
      problemPreview: problemText.slice(0, 160),
    });
    const res = await fetch(`${RESOLVER_URL}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        problem_text: problemText,
        subject: subject ?? undefined,
        language: resolvedLanguage,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn("[resolver] resolve non-OK response", {
        status: res.status,
        elapsedMs: Date.now() - startedAt,
      });
      return noMatch();
    }
    const payload = (await res.json()) as ResolveResult;
    logger.info("[resolver] resolve response", {
      mode: payload.mode,
      matched: payload.matched,
      confidence: payload.confidence,
      sessionId: payload.session_id ?? null,
      elapsedMs: Date.now() - startedAt,
    });
    return payload;
  } catch (err) {
    logger.warn("[resolver] resolve failed", {
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - startedAt,
    });
    return noMatch();
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget: index a positively-rated session into the embedding store. */
export function indexSession(payload: {
  session_id: string;
  user_id: string;
  problem_text: string;
  subject?: string | null;
  topic?: string | null;
  language?: string | null;
  final_answer?: string | null;
  solution_text?: string | null;
  breakdown_json?: unknown;
}): void {
  logger.info("[resolver] index request", {
    sessionId: payload.session_id,
    subject: payload.subject ?? null,
    topic: payload.topic ?? null,
    language: payload.language ?? "en",
    problemPreview: payload.problem_text.slice(0, 160),
  });
  fetch(`${RESOLVER_URL}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.warn("[resolver] index non-OK response", {
          sessionId: payload.session_id,
          status: res.status,
          body: body.slice(0, 300),
        });
        return;
      }
      logger.info("[resolver] index accepted", {
        sessionId: payload.session_id,
        status: res.status,
      });
    })
    .catch((err) => {
      logger.warn("[resolver] index fire-and-forget failed", {
        sessionId: payload.session_id,
        error: String(err?.message ?? err),
      });
    });
}

function noMatch(): ResolveResult {
  return { matched: false, confidence: 0, mode: "none" };
}
