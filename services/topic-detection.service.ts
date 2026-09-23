/**
 * Auto Topic Tagging
 *
 * Detects the academic subject/topic of a post from its text content.
 * Uses keyword matching against the subject taxonomy first (free),
 * then falls back to Gemini Simple for ambiguous content.
 *
 * Called async after post publish when post.topic is null.
 * Updates posts.topic in place.
 */

import { getGeminiClient } from "./ai/core/client.js";
import { getSupabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─── Topic keyword map ────────────────────────────────────────────────────────

// Keys must match valid topic values stored in posts.topic
const TOPIC_KEYWORDS: Record<string, string[]> = {
  // Mathematics
  "math": [
    "math", "mathematics", "mathematical", "arithmetic", "number", "numbers",
    "formula", "solve", "solution", "problem",
  ],
  "algebra": [
    "algebra", "equation", "variable", "polynomial", "factor", "quadratic",
    "linear equation", "system of equations", "inequality", "expression",
  ],
  "calculus": [
    "calculus", "derivative", "integral", "differentiation", "integration",
    "limit", "chain rule", "antiderivative", "definite integral", "riemann",
    "differential", "gradient", "divergence", "curl",
  ],
  "geometry": [
    "geometry", "triangle", "circle", "angle", "polygon", "congruent",
    "similar", "proof", "area", "perimeter", "volume", "surface area",
    "coordinate geometry", "transformation", "reflection", "rotation",
  ],
  "trigonometry": [
    "trigonometry", "sine", "cosine", "tangent", "trig", "radian",
    "unit circle", "identity", "secant", "cosecant", "cotangent",
    "law of sines", "law of cosines",
  ],
  "statistics": [
    "statistics", "probability", "mean", "median", "mode", "standard deviation",
    "variance", "distribution", "hypothesis test", "p-value", "regression",
    "correlation", "confidence interval", "sample", "population",
  ],
  "linear-algebra": [
    "linear algebra", "matrix", "vector", "eigenvalue", "eigenvector",
    "determinant", "null space", "basis", "orthogonal", "span",
    "row reduction", "gaussian elimination",
  ],

  // Sciences
  "physics": [
    "physics", "force", "velocity", "acceleration", "momentum", "energy",
    "work", "power", "gravity", "friction", "newton", "kinematics",
    "dynamics", "thermodynamics", "heat", "wave", "optics",
  ],
  "chemistry": [
    "chemistry", "element", "compound", "reaction", "molecule", "atom",
    "bond", "mole", "stoichiometry", "acid", "base", "pH", "oxidation",
    "reduction", "periodic table", "electron", "orbital",
  ],
  "biology": [
    "biology", "cell", "dna", "rna", "protein", "evolution", "organism",
    "photosynthesis", "respiration", "genetics", "chromosome", "enzyme",
    "mitosis", "meiosis", "ecosystem", "natural selection",
  ],

  // Humanities
  "history": [
    "history", "war", "revolution", "empire", "civilization", "dynasty",
    "century", "historical", "ancient", "medieval", "colonialism",
    "independence", "treaty", "monarchy",
  ],
  "literature": [
    "literature", "poem", "poetry", "novel", "author", "theme", "character",
    "metaphor", "simile", "irony", "symbolism", "narrative", "plot",
    "protagonist", "antagonist", "shakespeare", "essay",
  ],
  "economics": [
    "economics", "supply", "demand", "market", "gdp", "inflation", "trade",
    "microeconomics", "macroeconomics", "fiscal", "monetary", "elasticity",
  ],

  // Languages
  "english": [
    "grammar", "punctuation", "sentence structure", "paragraph", "thesis",
    "essay writing", "vocabulary", "reading comprehension", "tense",
  ],
};

// ─── Keyword scoring ──────────────────────────────────────────────────────────

function detectTopicByKeywords(text: string): { topic: string; confidence: number } | null {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > 0) scores[topic] = score;
  }

  const topics = Object.keys(scores);
  if (topics.length === 0) return null;

  topics.sort((a, b) => scores[b] - scores[a]);
  const top = topics[0];
  const topScore = scores[top];
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  const confidence = total > 0 ? topScore / total : 0;

  return { topic: top, confidence };
}

// ─── Gemini Simple fallback ───────────────────────────────────────────────────

async function detectTopicWithAI(text: string): Promise<{ topic: string; confidence: number } | null> {
  try {
    const availableTopics = Object.keys(TOPIC_KEYWORDS);
    const client = getGeminiClient();
    const prompt = `You are classifying the academic subject of a student's post or problem.

Content: """${text.slice(0, 600)}"""

Choose the single best topic from this list:
${availableTopics.join(", ")}

If none fit, respond with "other".

Respond with valid JSON only, no markdown:
{"topic":"<topic name>","confidence":0.0-1.0}`;

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
    const parsed = JSON.parse(raw) as { topic: string; confidence: number };
    if (!parsed.topic || parsed.topic === "other") return null;
    return parsed;
  } catch (err) {
    logger.warn("[topic-detection] Gemini classifier failed:", err);
    return null;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// ─── Shared detection logic ───────────────────────────────────────────────────

async function resolveTopic(text: string): Promise<string | null> {
  const kwResult = detectTopicByKeywords(text);

  if (kwResult && kwResult.confidence >= 0.5) {
    return kwResult.topic;
  }

  // Weak or no keyword match → ask AI
  const aiResult = await detectTopicWithAI(text);
  if (aiResult && aiResult.confidence >= 0.5) {
    return aiResult.topic;
  }

  // Fall back to keyword even if weak
  return kwResult?.topic ?? null;
}

// ─── Post topic tagging ────────────────────────────────────────────────────────

/**
 * Detect topic from post text and update posts.topic if currently null.
 * Safe to call fire-and-forget — all errors caught internally.
 */
export async function detectAndTagTopic(postId: string, text: string): Promise<void> {
  if (!text || text.trim().length < 10) {
    logger.debug("[topic-detection] skipped post topic tagging: text too short", {
      postId,
      textLength: text?.trim().length ?? 0,
    });
    return;
  }

  try {
    logger.debug("[topic-detection] resolving post topic", {
      postId,
      preview: text.slice(0, 120),
    });
    const finalTopic = await resolveTopic(text);
    if (!finalTopic) {
      logger.info("[topic-detection] no post topic detected", {
        postId,
        preview: text.slice(0, 120),
      });
      return;
    }

    const db = getSupabaseAdmin();
    const { data, error } = await db
      .from("posts")
      .update({ topic: finalTopic })
      .eq("id", postId)
      .is("topic", null) // only update if still null (don't overwrite user's choice)
      .select("id, topic")
      .maybeSingle();

    if (error) {
      logger.warn("[topic-detection] Failed to update post topic:", error);
      return;
    }

    if (!data) {
      logger.debug("[topic-detection] post topic not updated because it was already set or missing", {
        postId,
        finalTopic,
      });
      return;
    }

    logger.info(`[topic-detection] post=${postId} → ${finalTopic}`);
  } catch (err) {
    logger.warn("[topic-detection] Failed to tag post topic:", err);
  }
}

// ─── Session topic tagging ────────────────────────────────────────────────────

/**
 * Detect topic from session problem text and update study_sessions.topic if null.
 * Safe to call fire-and-forget — all errors caught internally.
 */
export async function detectAndTagSessionTopic(sessionId: string, text: string): Promise<void> {
  if (!text || text.trim().length < 10) return;

  try {
    const finalTopic = await resolveTopic(text);
    if (!finalTopic) return;

    const db = getSupabaseAdmin();
    await db
      .from("study_sessions")
      .update({ topic: finalTopic })
      .eq("id", sessionId)
      .is("topic", null); // only backfill if still null

    logger.info(`[topic-detection] session=${sessionId} → ${finalTopic}`);
  } catch (err) {
    logger.warn("[topic-detection] Failed to tag session topic:", err);
  }
}
