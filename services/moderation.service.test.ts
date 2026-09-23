import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("./ai/core/client.js", () => ({
  getGeminiClient: () => ({
    models: { generateContent: mocks.generateContent },
  }),
}));

vi.mock("../config/supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  }),
}));

vi.mock("../config/env.js", () => ({
  env: { GEMINI_SIMPLE_MODEL: "test-model" },
}));

vi.mock("../utils/logger.js", () => ({
  logger: { warn: vi.fn() },
}));

import { moderateContent } from "./moderation.service.js";

describe("moderateContent structured learning context", () => {
  beforeEach(() => {
    mocks.generateContent.mockReset();
  });

  it("blocks an off-topic classification for a normal text post", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        safe: false,
        confidence: 0.95,
        category: "off_topic",
        reason: "Not related to studying.",
      }),
    });

    const result = await moderateContent("Check this guy", "post");

    expect(result.allowed).toBe(false);
    expect(result.category).toBe("off_topic");
  });

  it("allows conversational framing around a verified learning resource", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        safe: false,
        confidence: 0.95,
        category: "off_topic",
        reason: "The caption alone is not academic.",
      }),
    });

    const result = await moderateContent("Check this guy Math", "post", "pending", {
      allowOffTopic: true,
    });

    expect(result).toEqual({
      allowed: true,
      category: "clean",
      reason: null,
      flaggedForReview: false,
    });
  });

  it("still blocks unsafe content attached to a verified learning resource", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        safe: false,
        confidence: 0.95,
        category: "harassment",
        reason: "Personal attack.",
      }),
    });

    const result = await moderateContent("You are completely worthless Math", "post", "pending", {
      allowOffTopic: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.category).toBe("harassment");
  });
});
