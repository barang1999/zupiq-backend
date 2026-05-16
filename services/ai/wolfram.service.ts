import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const WOLFRAM_SHORT_ANSWER_URL = "http://api.wolframalpha.com/v1/result";
const WOLFRAM_TIMEOUT_MS = 8000;

/**
 * Strip LaTeX delimiters and commands to produce a plain-text query suitable for Wolfram Alpha.
 */
function toPlainQuery(latex: string): string {
  return (latex ?? "")
    // Strip leading problem numbers/labels: "4.", "(a)", "Q3:", etc.
    .replace(/^\s*(?:\d+\.|\([a-zA-Z]\)|\bQ\d+\b)[:\s]*/i, "")
    // Strip "Solve for x:", "Find:", "Calculate:" prefixes — Wolfram handles equations natively
    .replace(/^\s*(?:solve\s+for\s+\w+|find|calculate|evaluate|simplify|determine)[:\s]+/i, "")
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
