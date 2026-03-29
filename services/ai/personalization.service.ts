import { PublicUser, SUPPORTED_LANGUAGES, UserPreferences } from "../../models/user.model.js";
import type { AIRequestOptions } from "./core/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonalizationContext {
  aiOptions: AIRequestOptions;
  systemHints: string[];
  suggestedDifficulty: "easy" | "medium" | "hard";
  preferredFormat: "concise" | "detailed" | "socratic";
}

// ─── Build AI options from user profile ───────────────────────────────────────

type AIUserProfile = {
  education_level?: string;
  language?: string;
  grade?: string | null;
};

function normalizeLanguage(language?: string): string {
  const normalized = (language ?? "").toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(normalized) ? normalized : "en";
}

export function buildAIOptions(
  user: AIUserProfile,
  overrides: Partial<AIRequestOptions> = {}
): AIRequestOptions {
  return {
    educationLevel: user.education_level ?? "high_school",
    language: normalizeLanguage(user.language),
    grade: user.grade ?? undefined,
    ...overrides,
  };
}

// ─── Full personalization context ────────────────────────────────────────────

export function buildPersonalizationContext(
  user: PublicUser,
  subject?: string
): PersonalizationContext {
  const prefs = user.preferences as UserPreferences;

  const aiOptions: AIRequestOptions = buildAIOptions(user, { subject });

  const systemHints: string[] = [];

  // Learning style hints
  if (prefs?.learning_style === "visual") {
    systemHints.push("Use diagrams, graphs, and visual analogies when possible.");
  } else if (prefs?.learning_style === "kinesthetic") {
    systemHints.push("Use hands-on examples and real-world applications.");
  } else if (prefs?.learning_style === "auditory") {
    systemHints.push("Use narrative flow and step-by-step verbal explanations.");
  }

  // Explanation style
  if (prefs?.ai_explanation_style === "simple") {
    systemHints.push("Keep explanations as simple as possible using plain language.");
  } else if (prefs?.ai_explanation_style === "socratic") {
    systemHints.push("Use the Socratic method: guide with questions rather than direct answers.");
  }

  // Map education level to difficulty
  const levelToDifficulty: Record<string, "easy" | "medium" | "hard"> = {
    elementary: "easy",
    middle_school: "easy",
    high_school: "medium",
    undergraduate: "medium",
    graduate: "hard",
    professional: "hard",
  };

  const suggestedDifficulty = levelToDifficulty[user.education_level] ?? "medium";

  const preferredFormat = prefs?.ai_explanation_style === "socratic"
    ? "socratic"
    : prefs?.ai_explanation_style === "simple"
    ? "concise"
    : "detailed";

  return {
    aiOptions,
    systemHints,
    suggestedDifficulty,
    preferredFormat,
  };
}

// ─── Adapt AI prompt based on personalization ─────────────────────────────────

export function adaptPromptForUser(
  basePrompt: string,
  context: PersonalizationContext
): string {
  if (context.systemHints.length === 0) return basePrompt;

  const hintsText = context.systemHints.join(" ");
  return `${basePrompt}\n\nAdditional instructions: ${hintsText}`;
}

// ─── Suggest next topics based on profile ────────────────────────────────────

export function suggestNextSubjects(user: PublicUser): string[] {
  const prefs = user.preferences as UserPreferences;
  const preferred = prefs?.preferred_subjects ?? [];

  // Default suggestions based on education level
  const byLevel: Record<string, string[]> = {
    elementary: ["Basic Math", "Basic Science"],
    middle_school: ["Pre-Algebra", "General Science", "Earth Science"],
    high_school: ["Algebra", "Geometry", "Physics", "Chemistry", "Biology"],
    undergraduate: ["Calculus", "Linear Algebra", "Organic Chemistry", "Thermodynamics"],
    graduate: ["Advanced Mathematics", "Quantum Mechanics", "Advanced Chemistry"],
    professional: ["Research Methods", "Advanced Topics"],
  };

  const levelSuggestions = byLevel[user.education_level] ?? [];
  const combined = [...new Set([...preferred, ...levelSuggestions])];
  return combined.slice(0, 5);
}

// ─── Score difficulty appropriateness ────────────────────────────────────────

export function isContentAppropriate(
  contentDifficulty: "beginner" | "intermediate" | "advanced" | "expert",
  user: PublicUser
): boolean {
  const levelMap: Record<string, number> = {
    elementary: 0,
    middle_school: 1,
    high_school: 2,
    undergraduate: 3,
    graduate: 4,
    professional: 5,
  };

  const difficultyMap: Record<string, number> = {
    beginner: 0,
    intermediate: 2,
    advanced: 3,
    expert: 5,
  };

  const userScore = levelMap[user.education_level] ?? 2;
  const contentScore = difficultyMap[contentDifficulty] ?? 2;

  // Allow 1 level above or below
  return Math.abs(userScore - contentScore) <= 1;
}
