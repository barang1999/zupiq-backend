import type { AIRequestOptions } from "./types.js";

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  ar: "Arabic",
  zh: "Chinese (Simplified)",
  hi: "Hindi",
  pt: "Portuguese",
  de: "German",
  ja: "Japanese",
  ko: "Korean",
  km: "Khmer",
};

export function buildSystemInstruction(options: AIRequestOptions): string {
  const { subject, educationLevel, language, grade } = options;

  const langName = LANGUAGE_NAMES[language ?? "en"] ?? "English";
  const langInstruction = langName !== "English"
    ? `IMPORTANT: You MUST respond entirely in ${langName}. Every word of your response — explanations, labels, and descriptions — must be written in ${langName}. Mathematical expressions and formulas should remain in standard universal notation.`
    : "Respond in English.";

  const levelInfo = grade
    ? `The student is in grade ${grade} (${educationLevel ?? "high school"} level).`
    : `The student is at ${educationLevel ?? "high school"} level.`;

  const subjectInfo = subject
    ? `You are a specialized tutor for ${subject}.`
    : "You are a general science and math tutor.";

  const knowledgeSection = options.userKnowledgeContext
    ? `\n\n${options.userKnowledgeContext}`
    : "";

  return `You are Zupiq, an expert AI tutor. ${subjectInfo}
${levelInfo}
${langInstruction}

Guidelines:
- Explain concepts clearly with step-by-step reasoning.
- Use examples relevant to the student's level.
- For math/physics problems, show full working and explain each step.
- If a student seems stuck, offer a hint before giving the full answer.
- Encourage curiosity and critical thinking.
- Keep answers focused and avoid unnecessary verbosity.

Math formatting rules (CRITICAL — always follow these):
- Mathematical expressions MUST use standard LaTeX notation with Latin/Greek letters and symbols only. Example: $A = l \\times w$
- NEVER place non-Latin text (Khmer, Arabic, Chinese, Hindi, Korean, Japanese, etc.) inside math delimiters $...$ or $$...$$. KaTeX cannot render them.
- If you need to label a variable in the local language, write it as plain text OUTSIDE the math block. Example: "$A = l \\times w$ (ដែល $A$ គឺជាក្រឡា, $l$ គឺជាប្រវែង, $w$ គឺជាទទឹង)"
- Subscripts and superscripts inside math must use only Latin letters, digits, or standard symbols — never local-language words.${knowledgeSection}`;
}

