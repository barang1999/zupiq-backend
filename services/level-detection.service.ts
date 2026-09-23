/**
 * Auto Level Detection
 *
 * Infers a user's education level from the problems they study and post.
 * Uses keyword matching first (free), then Gemini Simple for ambiguous cases.
 * Updates users.detected_level via a rolling-weighted vote so recent activity
 * matters more than old sessions.
 *
 * Called async (fire-and-forget) after:
 *   - A study session is created
 *   - A post with problem/caption text is published
 */

import { getGeminiClient } from "./ai/core/client.js";
import { getSupabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { EducationLevel } from "../models/user.model.js";

// ─── Keyword map ──────────────────────────────────────────────────────────────

// Each level has an array of keyword patterns (lowercase, partial match ok).
// Order matters: more specific patterns first within each level.
const LEVEL_KEYWORDS: Record<EducationLevel, string[]> = {
  elementary: [
    "addition", "subtraction", "multiplication", "division",
    "counting", "number line", "place value", "basic fraction",
    "greater than", "less than", "clock", "calendar math",
    "single digit", "double digit",
  ],
  middle_school: [
    "fraction", "decimal", "percentage", "ratio", "proportion",
    "integer", "negative number", "coordinate", "area", "perimeter",
    "volume", "surface area", "mean median mode", "bar graph",
    "pie chart", "linear expression", "one step equation",
    "two step equation", "exponent", "square root", "pythagorean",
  ],
  high_school: [
    "quadratic", "polynomial", "factoring", "completing the square",
    "trigonometry", "sine cosine tangent", "logarithm", "exponential",
    "arithmetic sequence", "geometric sequence", "binomial theorem",
    "probability", "combination", "permutation", "statistics",
    "normal distribution", "hypothesis", "vector", "matrix",
    "determinant", "system of equations", "conic section",
    "parabola", "ellipse", "hyperbola", "limit",
  ],
  undergraduate: [
    "derivative", "integral", "differentiation", "integration",
    "chain rule", "product rule", "quotient rule",
    "definite integral", "indefinite integral", "antiderivative",
    "differential equation", "partial derivative", "gradient",
    "divergence", "curl", "laplace", "fourier transform",
    "linear algebra", "eigenvalue", "eigenvector", "null space",
    "row reduction", "span", "basis", "orthogonal",
    "real analysis", "complex number", "residue theorem",
    "group theory", "ring", "field", "abstract algebra",
  ],
  graduate: [
    "topology", "manifold", "homeomorphism", "diffeomorphism",
    "tensor", "riemannian", "lie group", "lie algebra",
    "measure theory", "lebesgue integral", "sigma algebra",
    "stochastic process", "martingale", "brownian motion",
    "convex optimization", "lagrangian duality", "kkt conditions",
    "algebraic geometry", "scheme", "cohomology", "homology",
    "category theory", "functor", "natural transformation",
  ],
  // Keep remaining EducationLevel values mapped (may not get much signal)
  professional: [
    "actuarial", "board exam", "licensure", "certification exam",
    "professional development", "continuing education",
  ],
};

// ─── Keyword scoring ──────────────────────────────────────────────────────────

interface KeywordScoreResult {
  level: EducationLevel;
  confidence: number;
}

function scoreByKeywords(text: string): KeywordScoreResult {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [level, keywords] of Object.entries(LEVEL_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > 0) scores[level] = score;
  }

  const levels = Object.keys(scores);
  if (levels.length === 0) return { level: "high_school", confidence: 0.1 }; // default fallback

  // Sort by score descending
  levels.sort((a, b) => scores[b] - scores[a]);
  const topLevel = levels[0] as EducationLevel;
  const topScore = scores[topLevel];
  const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);
  const confidence = totalScore > 0 ? topScore / totalScore : 0;

  return { level: topLevel, confidence };
}

// ─── Gemini Simple classifier ─────────────────────────────────────────────────

async function classifyWithAI(text: string): Promise<KeywordScoreResult | null> {
  try {
    const client = getGeminiClient();
    const prompt = `You are classifying the academic difficulty level of a student's problem or study content.

Content: """${text.slice(0, 800)}"""

Choose the best level:
- "elementary": basic arithmetic, shapes, simple word problems (age 6-11)
- "middle_school": fractions, basic algebra, geometry basics (age 11-14)
- "high_school": algebra 2, trigonometry, pre-calculus, statistics (age 14-18)
- "undergraduate": calculus, linear algebra, differential equations, real analysis
- "graduate": topology, abstract algebra, measure theory, advanced research topics
- "professional": professional certifications, board exams, continuing education

Respond with valid JSON only, no markdown:
{"level":"elementary"|"middle_school"|"high_school"|"undergraduate"|"graduate"|"professional","confidence":0.0-1.0}`;

    const response = await client.models.generateContent({
      model: env.GEMINI_SIMPLE_MODEL,
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 64,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = (response.text ?? "").trim();
    const parsed = JSON.parse(raw) as { level: EducationLevel; confidence: number };
    return { level: parsed.level, confidence: parsed.confidence };
  } catch (err) {
    logger.warn("[level-detection] Gemini classifier failed:", err);
    return null;
  }
}

// ─── Rolling vote update ──────────────────────────────────────────────────────

/**
 * Bayesian-style rolling update.
 * New observation decays existing weights by 0.85 and adds new signal × 0.15.
 * This way recent sessions gradually shift the detected level without sharp jumps.
 */
function applyVote(
  existingVotes: Record<string, number>,
  newLevel: EducationLevel,
  newConfidence: number
): { votes: Record<string, number>; topLevel: EducationLevel; topConfidence: number } {
  // Decay all existing votes
  const votes: Record<string, number> = {};
  for (const [lvl, weight] of Object.entries(existingVotes)) {
    votes[lvl] = weight * 0.85;
  }

  // Add new observation
  votes[newLevel] = (votes[newLevel] ?? 0) + newConfidence * 0.15;

  // Normalize
  const total = Object.values(votes).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const lvl of Object.keys(votes)) votes[lvl] /= total;
  }

  // Find winner
  const sorted = Object.entries(votes).sort(([, a], [, b]) => b - a);
  const topLevel = sorted[0][0] as EducationLevel;
  const topConfidence = sorted[0][1];

  return { votes, topLevel, topConfidence };
}

// ─── Main: detect and persist ─────────────────────────────────────────────────

/**
 * Detect level from text and update users.detected_level.
 * Safe to call fire-and-forget — all errors are caught internally.
 */
export async function detectAndUpdateLevel(userId: string, text: string): Promise<void> {
  if (!text || text.trim().length < 15) return; // too short to be meaningful

  try {
    // Step 1: keyword scoring
    const kwResult = scoreByKeywords(text);

    // Step 2: AI only when keyword confidence is low
    let finalResult = kwResult;
    if (kwResult.confidence < 0.6) {
      const aiResult = await classifyWithAI(text);
      if (aiResult) {
        // Blend: AI weighted 0.7, keywords 0.3 when keywords are weak
        finalResult = kwResult.confidence < 0.3
          ? aiResult
          : { level: aiResult.confidence > kwResult.confidence ? aiResult.level : kwResult.level,
              confidence: Math.max(aiResult.confidence, kwResult.confidence) };
      }
    }

    // Step 3: fetch current votes and apply rolling update
    const db = getSupabaseAdmin();
    const { data: user } = await db
      .from("users")
      .select("level_votes")
      .eq("id", userId)
      .single();

    const existingVotes: Record<string, number> = (user?.level_votes as Record<string, number>) ?? {};
    const { votes, topLevel, topConfidence } = applyVote(existingVotes, finalResult.level, finalResult.confidence);

    await db.from("users").update({
      detected_level: topLevel,
      level_confidence: topConfidence,
      level_votes: votes,
    }).eq("id", userId);

    logger.info(`[level-detection] user=${userId} → ${topLevel} (conf=${topConfidence.toFixed(2)})`);
  } catch (err) {
    logger.warn("[level-detection] Failed to update level:", err);
  }
}
