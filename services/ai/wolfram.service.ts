import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

const WOLFRAM_SHORT_ANSWER_URL = "http://api.wolframalpha.com/v1/result";
const WOLFRAM_TIMEOUT_MS = 8000;

/**
 * Strip LaTeX delimiters and commands to produce a plain-text query suitable for Wolfram Alpha.
 *
 * Two cases:
 *  1. Natural-language question with optional inline formula (e.g. "Find P(X=k) given $...$")
 *     → use only the text before the first "$", drop the formula.
 *  2. Pure-formula input (first non-empty line starts with "$", e.g. "$\lim_{x\to0}...$")
 *     → use the whole line and convert LaTeX notation to Wolfram-readable form.
 */
function toPlainQuery(latex: string): string {
  const firstLine = (latex ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? "";

  // Pure-formula input: the entire line IS the formula. Apply LaTeX conversion directly.
  // Natural-language input: strip inline formula appended after the question text.
  const isPureFormula = firstLine.startsWith("$");
  const base = isPureFormula
    ? firstLine
    : (firstLine.replace(/\s*\$[\s\S]*$/, "").trim() || firstLine);

  return base
    // Strip leading problem numbers/labels: "4.", "4)", "(a)", "Q3:", etc.
    .replace(/^\s*(?:\d+[.)]\s*|\([a-zA-Z]\)\s*|\bQ\d+[.:]\s*)/i, "")
    // Strip instruction prefixes up to and including the first colon
    .replace(/^\s*(?:solve|find|calculate|evaluate|simplify|determine|compute|integrate|differentiate|prove|verify|show\s+that)[\s\w,()]*:/i, "")
    // Strip dollar signs
    .replace(/\$\$?/g, "")
    // Expand \sqrt{...} BEFORE \frac so nested braces don't break \frac's [^}]+ capture
    .replace(/\\sqrt\{([^}]+)\}/g, "sqrt($1)")
    .replace(/\\sqrt\s(\S+)/g, "sqrt($1)")
    // Limits: \lim_{x \to a} → "limit as x->a of "
    .replace(/\\lim_\{([^}]*)\}/g, (_, sub) => {
      const norm = sub
        .replace(/\\to\b/g, "->")
        .replace(/\\infty\b/g, "inf")
        .replace(/\s+/g, " ")
        .trim();
      return `limit as ${norm} of `;
    })
    .replace(/\\lim\b/g, "limit")
    .replace(/\\to\b/g, "->")
    .replace(/\\infty\b/g, "inf")
    // \frac now safe: \sqrt{} already resolved to sqrt(...) so no nested } in args
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)")
    .replace(/\\sin\b/g, "sin")
    .replace(/\\cos\b/g, "cos")
    .replace(/\\tan\b/g, "tan")
    .replace(/\\cot\b/g, "cot")
    .replace(/\\sec\b/g, "sec")
    .replace(/\\csc\b/g, "csc")
    .replace(/\\log\b/g, "log")
    .replace(/\\ln\b/g, "ln")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\left|\\right/g, "")
    // Remove remaining LaTeX commands
    .replace(/\\[a-zA-Z]+/g, " ")
    // Subscript braces _{...} → drop (e.g. \lim_{} already handled; stray _{n} are annotation only)
    .replace(/_\{[^}]*\}/g, "")
    // Superscript braces ^{n} → ^n
    .replace(/\^\{([^}]*)\}/g, "^$1")
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
