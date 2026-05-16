import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const WOLFRAM_SHORT_ANSWER_URL = "http://api.wolframalpha.com/v1/result";
const WOLFRAM_TIMEOUT_MS = 8000;

/**
 * Strip LaTeX delimiters and commands to produce a plain-text query suitable for Wolfram Alpha.
 * Only the first (natural-language) line is used — any formula hint lines are dropped,
 * since they turn into gibberish after LaTeX stripping and cause Wolfram 501 errors.
 */
function toPlainQuery(latex: string): string {
  // Use only the first non-empty line — drop formula/context lines after it
  const firstLine = (latex ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";

  // Strip any inline formula appended to the natural-language question, e.g.:
  // "Find the probability... $P(X=k) = \binom{n}{k}...$"  →  "Find the probability..."
  const questionOnly = firstLine.replace(/\s*\$[\s\S]*$/, "").trim() || firstLine;

  return questionOnly
    // Strip leading problem numbers/labels: "4.", "4)", "(a)", "Q3:", etc.
    .replace(/^\s*(?:\d+[.)]\s*|\([a-zA-Z]\)\s*|\bQ\d+[.:]\s*)/i, "")
    // Strip instruction prefixes — everything up to and including the first colon
    // e.g. "Solve the differential equation:", "Find:", "Calculate:", "Evaluate:"
    .replace(/^\s*(?:solve|find|calculate|evaluate|simplify|determine|compute|integrate|differentiate|prove|verify|show\s+that)[\s\w,()]*:/i, "")
    .replace(/\$\$?/g, "")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\\sqrt\s(\S+)/g, "sqrt($1)")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\left|\\right/g, "")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}]/g, "")
    // Convert "given that" / "where" / "with" into comma-separated Wolfram constraints
    .replace(/\s*,?\s*given\s+that\s*/gi, ", ")
    .replace(/\s*,?\s*\bwhere\b\s*/gi, ", ")
    .replace(/\s*,?\s*\bwith\b\s+([a-zA-Z])/gi, ", $1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Query Wolfram Alpha Short Answers API for a canonical answer to a math problem.
 * Returns null if: the app ID is not configured, the query fails, or no valid answer is found.
 *
 * Usage: set WOLFRAM_APP_ID in your environment (get a free key at https://developer.wolframalpha.com).
 */
export async function verifyWithWolfram(problem: string): Promise<string | null> {
  if (!env.WOLFRAM_APP_ID) return null;

  const query = toPlainQuery(problem);
  if (!query || query.length < 3) return null;

  const url = new URL(WOLFRAM_SHORT_ANSWER_URL);
  url.searchParams.set("appid", env.WOLFRAM_APP_ID);
  url.searchParams.set("i", query);
  url.searchParams.set("units", "metric");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WOLFRAM_TIMEOUT_MS);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "text/plain" },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn("[wolfram] non-OK response", {
        status: response.status,
        query: query.slice(0, 80),
      });
      return null;
    }

    const text = (await response.text()).trim();
    if (!text || /wolfram.{0,20}alpha did not understand/i.test(text)) return null;

    logger.info("[wolfram] answer", {
      query: query.slice(0, 80),
      answer: text.slice(0, 120),
    });
    return text;
  } catch (err) {
    const name = (err as any)?.name;
    if (name === "AbortError") {
      logger.warn("[wolfram] timed out", { query: query.slice(0, 80) });
    } else {
      logger.warn("[wolfram] request failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}
