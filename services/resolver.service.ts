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
  try {
    const res = await fetch(`${RESOLVER_URL}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        problem_text: problemText,
        subject: subject ?? undefined,
        language: language ?? "en",
      }),
      signal: controller.signal,
    });
    if (!res.ok) return noMatch();
    return (await res.json()) as ResolveResult;
  } catch {
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
  fetch(`${RESOLVER_URL}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    logger.warn("[resolver] index fire-and-forget failed", { error: String(err?.message ?? err) });
  });
}

function noMatch(): ResolveResult {
  return { matched: false, confidence: 0, mode: "none" };
}
