/**
 * Content Moderation — layered pipeline
 *
 * Layer 1: Keyword blocklist  (free, <1ms, catches ~70% of clear violations)
 * Layer 2: Pattern rules      (free, <1ms, catches spam / off-topic signals)
 * Layer 3: Gemini Simple      (only for borderline content, ~$0.0002/call)
 *
 * Clear violations (L1/L2) → blocked synchronously, reason returned to user
 * Borderline (L3 confidence 0.4–0.6) → published but queued for admin review
 * Safe → published immediately
 */

import { getGeminiClient } from "./ai/core/client.js";
import { getSupabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModerationCategory =
  | "clean"
  | "adult"
  | "hate_speech"
  | "harassment"
  | "violence"
  | "spam"
  | "off_topic";

export interface ModerationResult {
  allowed: boolean;
  category: ModerationCategory;
  reason: string | null;
  /** true when content was queued for human review (borderline AI result) */
  flaggedForReview: boolean;
}

export interface ModerationOptions {
  /**
   * Set this when the post is already anchored to verified learning content,
   * such as an owned Archive collection. Safety and spam checks still apply,
   * but conversational framing is not rejected merely for being off-topic.
   */
  allowOffTopic?: boolean;
}

// ─── Layer 1: Keyword blocklist ───────────────────────────────────────────────

// Normalized to lowercase. Intentionally not exhaustive — catches obvious cases
// without over-blocking legitimate academic content.
const BLOCKED_KEYWORDS: string[] = [
  // Common profanity
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "piss off",
  "dick", "cock", "pussy", "motherfuck", "bullshit", "wtf", "stfu",
  "dumbass", "jackass", "dipshit", "horseshit", "goddamn",
  // Adult / explicit
  "pornography", "porn", "nude", "naked", "sex tape", "onlyfans", "xxx",
  "masturbat", "erotic", "hentai",
  // Hate speech
  "nigger", "faggot", "chink", "spic", "kike", "tranny",
  // Severe harassment
  "kill yourself", "kys", "go die", "i will kill", "i'll kill",
  // Self-harm promotion
  "how to kill myself", "suicide method", "self harm tutorial",
  // Drug promotion
  "buy cocaine", "buy weed", "buy meth", "drug dealer",
];

function layer1Check(text: string): ModerationResult | null {
  const lower = text.toLowerCase();
  for (const kw of BLOCKED_KEYWORDS) {
    if (lower.includes(kw)) {
      const ADULT_KW = ["porn", "nude", "naked", "sex tape", "erotic", "xxx", "hentai", "masturbat", "onlyfans"];
      const VIOLENCE_KW = ["kill", "die", "suicide", "self harm"];
      const SPAM_KW = ["buy cocaine", "buy weed", "buy meth", "drug dealer"];
      const PROFANITY_KW = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt", "piss off", "dick", "cock", "pussy", "motherfuck", "bullshit", "wtf", "stfu", "dumbass", "jackass", "dipshit", "horseshit", "goddamn"];
      const category =
        ADULT_KW.some(k => kw.includes(k)) ? "adult" :
        VIOLENCE_KW.some(k => kw.includes(k)) ? "violence" :
        SPAM_KW.some(k => kw.includes(k)) ? "spam" :
        PROFANITY_KW.some(k => kw.includes(k)) ? "harassment" :
        "hate_speech";
      return {
        allowed: false,
        category,
        reason: "Please keep your language respectful and appropriate for a learning environment.",
        flaggedForReview: false,
      };
    }
  }
  return null;
}

// ─── Layer 2: Pattern rules ───────────────────────────────────────────────────

function layer2Check(text: string): ModerationResult | null {
  const trimmed = text.trim();

  // Spam: excessive repeated characters (e.g. "aaaaaaaaaa", "!!!!!!!!!!!")
  if (/(.)\1{9,}/.test(trimmed)) {
    return { allowed: false, category: "spam", reason: "Your message looks like spam.", flaggedForReview: false };
  }

  // Spam: ALL CAPS on long posts (> 60 chars, > 80% uppercase letters)
  if (trimmed.length > 60) {
    const letters = trimmed.replace(/[^a-zA-Z]/g, "");
    if (letters.length > 20 && (letters.replace(/[^A-Z]/g, "").length / letters.length) > 0.8) {
      return { allowed: false, category: "spam", reason: "Please avoid posting in all caps.", flaggedForReview: false };
    }
  }

  // Spam: more than 3 URLs in one post
  const urlCount = (trimmed.match(/https?:\/\//gi) ?? []).length;
  if (urlCount > 3) {
    return { allowed: false, category: "spam", reason: "Too many links in one post.", flaggedForReview: false };
  }

  // Spam: promotional patterns
  if (/\b(buy now|click here|free money|dm me for|whatsapp me|telegram me|follow for follow|f4f|promo code)\b/i.test(trimmed)) {
    return { allowed: false, category: "spam", reason: "Promotional content is not allowed.", flaggedForReview: false };
  }

  return null;
}

// ─── Layer 3: Gemini Simple classifier ───────────────────────────────────────

interface GeminiModerationResponse {
  safe: boolean;
  confidence: number;
  category: ModerationCategory;
  reason: string | null;
}

async function layer3Check(
  text: string,
  options: ModerationOptions = {}
): Promise<{ result: GeminiModerationResponse } | null> {
  try {
    const client = getGeminiClient();
    const relevancePolicy = options.allowOffTopic
      ? `This text accompanies a verified learning resource. General social framing such as "check this out" is allowed and must not be classified as off_topic. Continue to reject all other unsafe categories.`
      : `Content completely unrelated to studying or education is unsafe.`;
    const prompt = `You are a content moderator for an educational study app used by students of all ages. The app is used globally — content may be written in ANY language including Khmer, Thai, Arabic, Chinese, French, Spanish, and others. You must detect inappropriate content in ALL languages, not just English.

Review the following content and determine if it is appropriate for a school learning platform.

Content: """${text.slice(0, 1000)}"""

Relevance policy: ${relevancePolicy}

A post is UNSAFE if it contains (in ANY language):
- Profanity, swearing, or offensive language
- Adult, sexual, or explicit content
- Hate speech or discrimination based on race, gender, religion, etc.
- Harassment, bullying, or personal attacks
- Violence, threats, or self-harm content
- Spam, advertisements, or promotional material
${options.allowOffTopic ? "" : "- Content completely unrelated to studying or education"}

Academic topics including difficult subjects like history of violence, medical biology, chemistry reactions, etc. are SAFE and should NOT be flagged.

Respond with valid JSON only, no markdown:
{"safe":true|false,"confidence":0.0-1.0,"category":"clean"|"adult"|"hate_speech"|"harassment"|"violence"|"spam"|"off_topic","reason":"short explanation if unsafe, null if safe"}`;

    const response = await client.models.generateContent({
      model: env.GEMINI_SIMPLE_MODEL,
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        maxOutputTokens: 128,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = (response.text ?? "").trim();
    const parsed: GeminiModerationResponse = JSON.parse(raw);
    return { result: parsed };
  } catch (err) {
    logger.warn("[moderation] Gemini L3 check failed, defaulting to allow:", err);
    return null; // fail open — don't block content when AI is unavailable
  }
}

// ─── Admin queue insert ───────────────────────────────────────────────────────

async function enqueueForReview(
  contentId: string,
  contentType: "post" | "comment",
  contentText: string,
  layer: number,
  category: ModerationCategory,
  confidence: number,
  reason: string | null
): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    await db.from("moderation_queue").insert({
      content_id: contentId,
      content_type: contentType,
      content_text: contentText.slice(0, 2000),
      layer,
      category,
      confidence,
      reason,
    });
  } catch (err) {
    logger.warn("[moderation] Failed to enqueue for review:", err);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full moderation pipeline synchronously.
 * Call this before inserting a post or comment.
 *
 * @param text         The content to moderate
 * @param contentType  "post" or "comment" (for queue logging only)
 * @param contentId    The post/comment ID if already known (for queue logging)
 */
export async function moderateContent(
  text: string,
  contentType: "post" | "comment" = "post",
  contentId = "pending",
  options: ModerationOptions = {}
): Promise<ModerationResult> {
  if (!text || text.trim().length === 0) {
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  // Layer 1
  const l1 = layer1Check(text);
  if (l1) return l1;

  // Layer 2
  const l2 = layer2Check(text);
  if (l2) return l2;

  // Layer 3 — call AI for:
  //   • Any non-Latin script content (Khmer, Thai, Arabic, Chinese, etc.) — keywords can't catch these
  //   • Latin content longer than 5 chars (skip only truly trivial inputs like "ok", "hi", "x=2")
  const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF]/.test(text); // outside Basic Latin + Latin Extended
  if (!hasNonLatin && text.trim().length <= 5) {
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  const l3 = await layer3Check(text, options);
  if (!l3) {
    // AI unavailable → fail open
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  const { result } = l3;

  // A verified learning resource makes the post study-related even when its
  // caption is conversational. Never let an off-topic-only AI classification
  // override that structural context; all other safety categories still block.
  if (options.allowOffTopic && result.category === "off_topic") {
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  // Confident violation (> 0.6) → block
  if (!result.safe && result.confidence > 0.6) {
    return {
      allowed: false,
      category: result.category,
      reason: result.reason ?? "This content violates our community guidelines.",
      flaggedForReview: false,
    };
  }

  // Uncertain (0.4–0.6) → allow but queue for human review
  if (!result.safe && result.confidence >= 0.4) {
    // Fire-and-forget queue insert
    enqueueForReview(contentId, contentType, text, 3, result.category, result.confidence, result.reason).catch(() => {});
    return { allowed: true, category: result.category, reason: null, flaggedForReview: true };
  }

  return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
}
