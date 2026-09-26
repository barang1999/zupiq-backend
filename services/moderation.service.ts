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
import { LATIN_KEYWORDS_EXTENDED, UNICODE_KEYWORDS_EXTENDED } from "./moderation-keywords.js";

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
  "dumbass", "jackass", "dipshit", "horseshit", "goddamn", "damn it", "damn you",
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
  // Extended multilingual Latin keywords (Spanish, French, Portuguese, German,
  // Italian, Dutch, Indonesian, Malay, Vietnamese, Polish, Turkish, Tagalog…)
  ...LATIN_KEYWORDS_EXTENDED,
];

// Unicode keyword blocklist — for non-Latin scripts where toLowerCase() is a no-op.
// Matched against the original text (not lowercased).
// Each entry carries its own category so the block reason is accurate.
const BLOCKED_KEYWORDS_UNICODE: { kw: string; category: ModerationCategory }[] = [
  // ── Khmer: profanity / sexual ──────────────────────────────────────────────
  { kw: "ចុយ",     category: "adult" },       // fuck (sexual)
  { kw: "ម្រាយ",   category: "adult" },       // slut / promiscuous woman
  { kw: "អាកាម",   category: "adult" },       // pervert / sexually vulgar
  { kw: "ជាន់",    category: "adult" },       // sexual slang (tread/step)
  { kw: "លិទ្ធ",   category: "adult" },       // sexual slang (lick)
  { kw: "ញាស់",    category: "adult" },       // sexual slang

  // ── Khmer: insults / harassment ────────────────────────────────────────────
  { kw: "ឆ្កួត",   category: "harassment" },  // crazy / idiot (directed insult)
  { kw: "ល្ងង់",   category: "harassment" },  // stupid / dumb
  { kw: "ឆ្កែ",    category: "harassment" },  // dog (used as insult)
  { kw: "ជ្រូក",   category: "harassment" },  // pig (used as insult)
  { kw: "ស្វា",    category: "harassment" },  // monkey (used as insult)
  { kw: "គោ",     category: "harassment" },  // cow (used as insult)
  { kw: "សត្វ",   category: "harassment" },  // animal (used as insult toward person)
  { kw: "អាឆ្កួត", category: "harassment" },  // you crazy one (intensified insult)
  { kw: "អាល្ងង់", category: "harassment" },  // you stupid one
  { kw: "ឆេះមាត់", category: "harassment" },  // shut up (lit. burn your mouth)

  // ── Khmer: violence / self-harm ────────────────────────────────────────────
  { kw: "ទៅស្លាប់",  category: "violence" },  // go die
  { kw: "សម្លាប់ខ្លួន", category: "violence" }, // kill yourself
  { kw: "ចង់ស្លាប់",  category: "violence" },  // want to die (self-harm context)

  // ── Thai: profanity / insults ──────────────────────────────────────────────
  { kw: "เหี้ย",   category: "harassment" },  // monitor lizard (strong insult)
  { kw: "สัตว์",   category: "harassment" },  // animal (used as insult toward person)
  { kw: "ไอ้สัตว์", category: "harassment" }, // you animal
  { kw: "แม่ง",    category: "harassment" },  // fuck / damn (common profanity)
  { kw: "เชี่ย",   category: "harassment" },  // fuck (vulgar)
  { kw: "ควาย",   category: "harassment" },  // buffalo (used as insult: stupid)
  { kw: "อีสัตว์", category: "harassment" },  // female animal (strong insult)
  { kw: "ไปตาย",  category: "violence" },    // go die

  // ── Arabic: profanity / insults ────────────────────────────────────────────
  { kw: "كلب",    category: "harassment" },  // dog (insult)
  { kw: "حمار",   category: "harassment" },  // donkey / idiot
  { kw: "غبي",    category: "harassment" },  // stupid
  { kw: "أحمق",   category: "harassment" },  // idiot / fool
  { kw: "اخرس",   category: "harassment" },  // shut up
  { kw: "يلعن",   category: "harassment" },  // curse/damn (profanity prefix)
  { kw: "كس",     category: "adult" },       // sexual slang

  // ── Chinese (Simplified): profanity / insults ──────────────────────────────
  { kw: "操你",    category: "adult" },       // fuck you
  { kw: "妈的",    category: "harassment" },  // damn / motherfucker
  { kw: "傻逼",    category: "harassment" },  // stupid cunt
  { kw: "混蛋",    category: "harassment" },  // bastard
  { kw: "王八蛋",  category: "harassment" },  // son of a bitch
  { kw: "去死",    category: "violence" },    // go die
  { kw: "滚",     category: "harassment" },  // get lost / fuck off
  { kw: "臭",     category: "harassment" },  // stinky (used as insult prefix — short, keep last)

  // Extended multilingual Unicode keywords (Khmer, Thai, Arabic, Chinese,
  // Japanese, Korean, Russian, Hindi, Burmese…)
  ...UNICODE_KEYWORDS_EXTENDED,
];

function layer1Check(text: string): ModerationResult | null {
  const lower = text.toLowerCase();
  for (const kw of BLOCKED_KEYWORDS) {
    if (lower.includes(kw)) {
      const ADULT_KW = ["porn", "nude", "naked", "sex tape", "erotic", "xxx", "hentai", "masturbat", "onlyfans"];
      const VIOLENCE_KW = ["kill", "die", "suicide", "self harm"];
      const SPAM_KW = ["buy cocaine", "buy weed", "buy meth", "drug dealer"];
      const PROFANITY_KW = ["fuck", "shit", "bitch", "asshole", "bastard", "cunt", "piss off", "dick", "cock", "pussy", "motherfuck", "bullshit", "wtf", "stfu", "dumbass", "jackass", "dipshit", "horseshit", "goddamn", "damn it", "damn you"];
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

  // Unicode blocklist — checked against original text (case is irrelevant for these scripts)
  for (const { kw, category } of BLOCKED_KEYWORDS_UNICODE) {
    if (text.includes(kw)) {
      logger.debug("[moderation] L1 unicode block", { kw, category });
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
): Promise<{ result: GeminiModerationResponse; blocked?: boolean } | null> {
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
  } catch (err: any) {
    const errDetail = {
      name: err?.name,
      status: err?.status,
      message: err?.message,
      errorDetails: err?.errorDetails ?? err?.details ?? undefined,
      stack: err?.stack?.split("\n").slice(0, 3).join(" | "),
    };

    // A 400 from Gemini means its own safety filter refused to process the
    // content — that is itself a strong signal the content is harmful.
    // Fail closed (block) rather than open.
    if (err?.status === 400) {
      logger.warn("[moderation] Gemini L3 refused content with 400 — treating as unsafe", { ...errDetail, preview: text.slice(0, 80) });
      return {
        blocked: true,
        result: { safe: false, confidence: 1.0, category: "harassment", reason: null },
      };
    }
    logger.warn("[moderation] Gemini L3 check failed, defaulting to allow", { ...errDetail, preview: text.slice(0, 80) });
    return null; // fail open only for non-400 errors (network issues, timeouts, etc.)
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
  const preview = text.slice(0, 80).replace(/\n/g, " ");

  if (!text || text.trim().length === 0) {
    logger.debug("[moderation] skip — empty content", { contentType, contentId });
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  // Layer 1
  const l1 = layer1Check(text);
  if (l1) {
    logger.info("[moderation] L1 block", { contentType, contentId, category: l1.category, preview });
    return l1;
  }
  logger.debug("[moderation] L1 pass", { contentType, contentId, preview });

  // Layer 2
  const l2 = layer2Check(text);
  if (l2) {
    logger.info("[moderation] L2 block", { contentType, contentId, category: l2.category, preview });
    return l2;
  }
  logger.debug("[moderation] L2 pass", { contentType, contentId, preview });

  // Layer 3 — call AI for:
  //   • Any non-Latin script content (Khmer, Thai, Arabic, Chinese, etc.) — keywords can't catch these
  //   • Latin content longer than 5 chars (skip only truly trivial inputs like "ok", "hi", "x=2")
  const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF]/.test(text); // outside Basic Latin + Latin Extended
  if (!hasNonLatin && text.trim().length <= 5) {
    logger.debug("[moderation] L3 skip — trivial Latin content", { contentType, contentId, preview });
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  logger.debug("[moderation] L3 calling Gemini", { contentType, contentId, hasNonLatin, preview });
  const l3 = await layer3Check(text, options);
  if (!l3) {
    logger.warn("[moderation] L3 Gemini unavailable", { contentType, contentId, hasNonLatin, preview });
    // AI unavailable — non-Latin scripts can't be checked by keyword rules, so queue for review
    if (hasNonLatin) {
      enqueueForReview(contentId, contentType, text, 3, "clean", 0, "AI unavailable; non-Latin content unverified").catch(() => {});
      return { allowed: true, category: "clean", reason: null, flaggedForReview: true };
    }
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  const { result, blocked } = l3;
  if (blocked) {
    logger.info("[moderation] L3 block — Gemini refused content", { contentType, contentId, preview });
    return {
      allowed: false,
      category: result.category,
      reason: "Please keep your language respectful and appropriate for a learning environment.",
      flaggedForReview: false,
    };
  }
  logger.info("[moderation] L3 Gemini result", {
    contentType,
    contentId,
    safe: result.safe,
    confidence: result.confidence,
    category: result.category,
    reason: result.reason,
    preview,
  });

  // A verified learning resource makes the post study-related even when its
  // caption is conversational. Never let an off-topic-only AI classification
  // override that structural context; all other safety categories still block.
  if (options.allowOffTopic && result.category === "off_topic") {
    logger.debug("[moderation] L3 off_topic suppressed (allowOffTopic)", { contentType, contentId });
    return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
  }

  // Confident violation (> 0.6) → block
  if (!result.safe && result.confidence > 0.6) {
    logger.info("[moderation] L3 block", { contentType, contentId, category: result.category, confidence: result.confidence, preview });
    return {
      allowed: false,
      category: result.category,
      reason: result.reason ?? "This content violates our community guidelines.",
      flaggedForReview: false,
    };
  }

  // Uncertain (0.4–0.6) → allow but queue for human review
  if (!result.safe && result.confidence >= 0.4) {
    logger.info("[moderation] L3 borderline — allowed + queued for review", { contentType, contentId, category: result.category, confidence: result.confidence, preview });
    enqueueForReview(contentId, contentType, text, 3, result.category, result.confidence, result.reason).catch(() => {});
    return { allowed: true, category: result.category, reason: null, flaggedForReview: true };
  }

  logger.debug("[moderation] L3 pass — safe", { contentType, contentId, confidence: result.confidence, preview });
  return { allowed: true, category: "clean", reason: null, flaggedForReview: false };
}
