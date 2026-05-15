import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MathpixResult {
  text: string;         // LaTeX-formatted problem text
  confidence: number;   // 0–1, overall OCR confidence
  isUsable: boolean;    // true if confidence meets threshold and text is non-empty
  source: "mathpix";
}

interface MathpixApiResponse {
  text?: string;
  latex_styled?: string;
  confidence?: number;
  confidence_rate?: number;
  error?: string;
  error_info?: { id: string; message: string };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract math/text from an image using Mathpix OCR.
 * Returns null if Mathpix is not configured (missing credentials).
 * Throws on network errors so the caller can decide to fall back.
 */
export async function extractWithMathpix(
  imageBase64: string,
  mimeType = "image/jpeg"
): Promise<MathpixResult | null> {
  if (!env.MATHPIX_APP_ID || !env.MATHPIX_APP_KEY) {
    logger.warn("[mathpix] credentials not configured — skipping");
    return null;
  }

  const startedAt = Date.now();

  const body = {
    src: `data:${mimeType};base64,${imageBase64}`,
    formats: ["text", "latex_styled"],
    data_options: {
      include_latex: true,
    },
    // Ask Mathpix to detect and preserve math inline/display blocks
    include_detected_alphabets: false,
    auto_rotate_confidence_threshold: 0.99,
  };

  const response = await fetch("https://api.mathpix.com/v3/text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "app_id": env.MATHPIX_APP_ID,
      "app_key": env.MATHPIX_APP_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000), // 10s hard cap
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Mathpix HTTP ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as MathpixApiResponse;
  const elapsedMs = Date.now() - startedAt;

  if (data.error) {
    logger.warn("[mathpix] API error", { error: data.error, info: data.error_info, elapsedMs });
    throw new Error(`Mathpix error: ${data.error}`);
  }

  // Prefer latex_styled (cleaner LaTeX) over plain text
  const text = (data.latex_styled || data.text || "").trim();
  // Mathpix returns confidence_rate (0–1) on newer API, confidence on older
  const confidence = data.confidence_rate ?? data.confidence ?? 0;

  logger.info("[mathpix] ocr complete", {
    elapsedMs,
    textLength: text.length,
    confidence,
    textPreview: text.slice(0, 120),
  });

  return {
    text,
    confidence,
    isUsable: text.length > 0 && confidence >= env.MATHPIX_MIN_CONFIDENCE,
    source: "mathpix",
  };
}
