import { env } from "../../../config/env.js";
import { logger } from "../../../utils/logger.js";
import { getGeminiClient } from "../core/client.js";
import { buildSystemInstruction } from "../core/system-instruction.js";
import type { AIRequestOptions } from "../core/types.js";

export type GameProblemSubject = "math" | "physics" | "logic" | "bio";
export type GameProblemMode = "learn" | "practice" | "challenge";

export interface GameProblemStep {
  prompt: string;
  options: string[];
  correct: string;
  hint: string;
}

export interface EducationalGameProblem {
  subject: GameProblemSubject;
  difficulty: number;
  mode: GameProblemMode;
  question: string;
  steps: GameProblemStep[];
  explanation: string;
}

interface RawEducationalGameProblem {
  question?: string;
  steps?: RawEducationalGameProblemStep[];
  explanation?: string;
}

interface RawEducationalGameProblemStep {
  prompt?: string;
  options?: string[];
  correct?: string;
  hint?: string;
}

interface JsonGenerationConfig<T> {
  prompt: string;
  options: AIRequestOptions;
  temperature: number;
  maxOutputTokens: number;
  taskName: string;
  maxAttempts?: number;
}

function clampDifficulty(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(10, Math.floor(value)));
}

function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const option of options) {
    const key = option.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(option.trim());
  }
  return deduped;
}

function normalizeGameProblemStep(
  raw: RawEducationalGameProblemStep | undefined,
  language?: string
): GameProblemStep | null {
  const prompt = `${raw?.prompt ?? ""}`.trim();
  const correctRaw = `${raw?.correct ?? ""}`.trim();
  const hintFallback = (language ?? "").toLowerCase() === "km"
    ? "ពិនិត្យទំនាក់ទំនងសំខាន់ម្តងទៀត។"
    : "Re-check the key relationship first.";
  const hint = `${raw?.hint ?? ""}`.trim() || hintFallback;

  const rawOptions = Array.isArray(raw?.options)
    ? raw.options.map((option) => `${option ?? ""}`.trim()).filter(Boolean)
    : [];

  if (!prompt) return null;
  if (!correctRaw) return null;

  let options = dedupeOptions(rawOptions);
  if (!options.some((option) => option.trim().toLowerCase() === correctRaw.toLowerCase())) {
    options = [correctRaw, ...options];
  }
  options = dedupeOptions(options).slice(0, 4);

  if (options.length < 2) return null;
  const correct = options.find((option) => option.trim().toLowerCase() === correctRaw.toLowerCase()) ?? options[0];
  return { prompt, options, correct, hint };
}

function buildFallbackEducationalGameProblem(
  subject: GameProblemSubject,
  difficulty: number,
  mode: GameProblemMode,
  language?: string
): EducationalGameProblem {
  const level = clampDifficulty(difficulty);
  const isKhmer = (language ?? "").toLowerCase() === "km";

  if (subject === "math") {
    return isKhmer
      ? {
          subject,
          difficulty: level,
          mode,
          question: "ដោះស្រាយ៖ 2x + 4 = 12",
          steps: [
            {
              prompt: "ជំហានដំបូងត្រូវធ្វើអ្វីដើម្បីបំបែក x?",
              options: ["ដក 4 ពីភាគីទាំងពីរ", "បូក 4 ទៅភាគីទាំងពីរ", "ចែកដោយ 2 ទាំងអស់", "គុណដោយ 2 ទាំងអស់"],
              correct: "ដក 4 ពីភាគីទាំងពីរ",
              hint: "ប្រើប្រតិបត្តិការផ្ទុយជាមុនសិន។",
            },
            {
              prompt: "បន្ទាប់ពីដក 4 ពីភាគីទាំងពីរ តម្លៃ x ស្មើប៉ុន្មាន?",
              options: ["x = 4", "x = 8", "x = 6", "x = 3"],
              correct: "x = 4",
              hint: "2x = 8 រួចចែកដោយ 2។",
            },
          ],
          explanation: "ដក 4 ពីភាគីទាំងពីរ បាន 2x = 8 ហើយចែកដោយ 2 ដើម្បីបាន x = 4។",
        }
      : {
          subject,
          difficulty: level,
          mode,
          question: "Solve: 2x + 4 = 12.",
          steps: [
            {
              prompt: "What is the first inverse operation to isolate x?",
              options: ["Subtract 4 from both sides", "Add 4 to both sides", "Divide everything by 2", "Multiply everything by 2"],
              correct: "Subtract 4 from both sides",
              hint: "Use inverse operations before dividing.",
            },
            {
              prompt: "After subtracting 4 from both sides, what is x?",
              options: ["x = 4", "x = 8", "x = 6", "x = 3"],
              correct: "x = 4",
              hint: "2x = 8, then divide by 2.",
            },
          ],
          explanation: "Subtract 4 from both sides to get 2x = 8, then divide by 2.",
        };
  }

  if (subject === "physics") {
    return isKhmer
      ? {
          subject,
          difficulty: level,
          mode,
          question: "វត្ថុមួយមានម៉ាស 2 kg ទទួលកម្លាំង 10 N។ រកអុចសេលេរេស្យុង។",
          steps: [
            {
              prompt: "ត្រូវប្រើច្បាប់ណា?",
              options: ["F = ma", "V = IR", "P = W/t", "p = mv"],
              correct: "F = ma",
              hint: "ច្បាប់នេះភ្ជាប់កម្លាំង ម៉ាស និងអុចសេលេរេស្យុង។",
            },
            {
              prompt: "គណនា a = F/m បានប៉ុន្មាន?",
              options: ["5 m/s^2", "20 m/s^2", "8 m/s^2", "2 m/s^2"],
              correct: "5 m/s^2",
              hint: "10 ចែក 2។",
            },
          ],
          explanation: "ប្រើ F = ma បម្លែងទៅ a = F/m ហើយគណនា 10/2 = 5 m/s^2។",
        }
      : {
          subject,
          difficulty: level,
          mode,
          question: "An object with mass 2 kg experiences force 10 N. Find acceleration.",
          steps: [
            {
              prompt: "Which relation applies?",
              options: ["F = ma", "V = IR", "P = W/t", "p = mv"],
              correct: "F = ma",
              hint: "Use Newton's second law.",
            },
            {
              prompt: "Compute a = F/m.",
              options: ["5 m/s^2", "20 m/s^2", "8 m/s^2", "2 m/s^2"],
              correct: "5 m/s^2",
              hint: "10 divided by 2.",
            },
          ],
          explanation: "From F = ma, rearrange to a = F/m and compute 10/2.",
        };
  }

  if (subject === "logic") {
    return isKhmer
      ? {
          subject,
          difficulty: level,
          mode,
          question: "បើ A ទាំងអស់ជា B ហើយ B ទាំងអស់ជា C តើយើងសន្និដ្ឋានអ្វី?",
          steps: [
            {
              prompt: "សន្និដ្ឋានត្រឹមត្រូវមួយណា?",
              options: ["A ទាំងអស់ជា C", "C ទាំងអស់ជា A", "B ខ្លះមិនមែនជា C", "មិនអាចសន្និដ្ឋានបាន"],
              correct: "A ទាំងអស់ជា C",
              hint: "គិតពីទំនាក់ទំនងបន្តបន្ទាប់ (transitive)।",
            },
            {
              prompt: "នេះជាទម្រង់អាគុយម៉ង់អ្វី?",
              options: ["Syllogism", "Strawman", "False dilemma", "Ad hominem"],
              correct: "Syllogism",
              hint: "ជាការទាញសន្និដ្ឋានពីមូលដ្ឋានពីរ។",
            },
          ],
          explanation: "នេះជាស៊ីឡូហ្ស៊ីមត្រឹមត្រូវ ដែលប្រើទំនាក់ទំនងបន្តបន្ទាប់។",
        }
      : {
          subject,
          difficulty: level,
          mode,
          question: "If all A are B and all B are C, what follows?",
          steps: [
            {
              prompt: "Choose the valid deduction.",
              options: ["All A are C", "All C are A", "Some B are not C", "No conclusion"],
              correct: "All A are C",
              hint: "Apply transitive reasoning.",
            },
            {
              prompt: "What argument form is this?",
              options: ["Syllogism", "Strawman", "False dilemma", "Ad hominem"],
              correct: "Syllogism",
              hint: "Two premises imply a conclusion.",
            },
          ],
          explanation: "This is a valid syllogism based on transitivity.",
        };
  }

  return isKhmer
    ? {
        subject,
        difficulty: level,
        mode,
        question: "DNA ទៅ RNA ទៅ Protein ពិពណ៌នាគំនិតអ្វី?",
        steps: [
          {
            prompt: "លំហូរព័ត៌មាននេះហៅថា?",
            options: ["Central dogma", "Homeostasis", "Diffusion", "Natural selection"],
            correct: "Central dogma",
            hint: "ជាគោលការណ៍មូលដ្ឋាននៃជីវវិទ្យាម៉ូលេគុល។",
          },
          {
            prompt: "ជំហានណាបម្លែង RNA ទៅជា protein?",
            options: ["Translation", "Replication", "Transcription", "Mutation"],
            correct: "Translation",
            hint: "កើតឡើងលើ ribosome។",
          },
        ],
        explanation: "Central dogma គឺ DNA -> RNA -> Protein តាមរយៈ transcription និង translation។",
      }
    : {
        subject,
        difficulty: level,
        mode,
        question: "DNA to RNA to Protein describes which concept?",
        steps: [
          {
            prompt: "What is this information flow called?",
            options: ["Central dogma", "Homeostasis", "Diffusion", "Natural selection"],
            correct: "Central dogma",
            hint: "It's a core molecular biology framework.",
          },
          {
            prompt: "Which step converts RNA into protein?",
            options: ["Translation", "Replication", "Transcription", "Mutation"],
            correct: "Translation",
            hint: "This happens on ribosomes.",
          },
        ],
        explanation: "Central dogma is DNA -> RNA -> Protein via transcription and translation.",
      };
}

function normalizeEducationalGameProblem(
  raw: RawEducationalGameProblem | null | undefined,
  subject: GameProblemSubject,
  difficulty: number,
  mode: GameProblemMode,
  language?: string
): EducationalGameProblem | null {
  if (!raw) return null;
  const question = `${raw.question ?? ""}`.trim();
  if (!question) return null;

  const stepsRaw = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = stepsRaw
    .slice(0, 4)
    .map((step) => normalizeGameProblemStep(step, language))
    .filter((step): step is GameProblemStep => Boolean(step));
  if (steps.length === 0) return null;

  const explanation = `${raw.explanation ?? ""}`.trim();
  const explanationFallback = (language ?? "").toLowerCase() === "km"
    ? "ដោះស្រាយតាមជំហាន៖ ជ្រើសទំនាក់ទំនងត្រឹមត្រូវ រួចគណនាដល់លទ្ធផលចុងក្រោយ។"
    : "Solve it step-by-step: choose the right relationship and compute carefully.";

  return {
    subject,
    difficulty: clampDifficulty(difficulty),
    mode,
    question,
    steps,
    explanation: explanation || explanationFallback,
  };
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
        stack.pop();
        if (stack.length === 0) return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function escapeInvalidBackslashesInsideJsonStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      const next = input[i + 1];
      const validEscape =
        next === "\"" ||
        next === "\\" ||
        next === "/" ||
        next === "b" ||
        next === "f" ||
        next === "n" ||
        next === "r" ||
        next === "t" ||
        next === "u";

      if (validEscape) {
        out += ch;
        escaped = true;
      } else {
        out += "\\\\";
      }
      continue;
    }

    out += ch;
    if (ch === "\"") inString = false;
  }

  return out;
}

function parseJsonLoose<T>(raw: string): T | null {
  const stripped = stripCodeFence(raw).replace(/\u0000/g, "").trim();
  if (!stripped) return null;

  const extracted = extractFirstJsonValue(stripped);
  const candidates = [stripped, extracted]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/,\s*([}\]])/g, "$1").replace(/\u2028|\u2029/g, " "));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const repaired = escapeInvalidBackslashesInsideJsonStrings(
        candidate.replace(/[\u0000-\u001F]/g, (ch) => {
          if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
          return " ";
        })
      );
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

async function generateStructuredJson<T>(
  config: JsonGenerationConfig<T>
): Promise<{ data: T | null; raw: string }> {
  const client = getGeminiClient();
  const attempts = Math.max(1, config.maxAttempts ?? 2);
  let lastRaw = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const retrySuffix = attempt === 1
      ? ""
      : `\n\nIMPORTANT: Your previous response was invalid JSON. Regenerate and return complete valid JSON only.`;

    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        systemInstruction: buildSystemInstruction(config.options),
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        responseMimeType: "application/json",
      },
      contents: [{ role: "user", parts: [{ text: `${config.prompt}${retrySuffix}` }] }],
    });

    const raw = response.text ?? "";
    lastRaw = raw;
    const parsed = parseJsonLoose<T>(raw);
    if (parsed !== null) return { data: parsed, raw };

    if (attempt < attempts) {
      logger.warn(
        `${config.taskName} JSON parse failed (attempt ${attempt}/${attempts}) — retrying. Length:`,
        raw.length
      );
    } else {
      logger.error(
        `${config.taskName} JSON parse failed (attempt ${attempt}/${attempts}). Length:`,
        raw.length,
        "Raw:",
        raw.slice(0, 500)
      );
    }
  }

  return { data: null, raw: lastRaw };
}

export async function generateEducationalGameProblem(
  subject: GameProblemSubject,
  difficulty: number,
  mode: GameProblemMode,
  options: AIRequestOptions = {}
): Promise<EducationalGameProblem> {
  const level = clampDifficulty(difficulty);

  const prompt = `Generate one educational tower-defense game problem.

Context:
- Subject: ${subject}
- Difficulty (1-10): ${level}
- Mode: ${mode}

Return ONLY valid JSON with this exact shape:
{
  "question": "single clear question for the enemy payload",
  "steps": [
    {
      "prompt": "step prompt",
      "options": ["option A", "option B", "option C", "option D"],
      "correct": "one option exactly as written",
      "hint": "short coaching hint"
    }
  ],
  "explanation": "1-2 sentence explanation of the full reasoning"
}

Rules:
- Output language MUST follow the student's language from system instruction.
- Provide 2-3 steps.
- Each step must include exactly 4 concise options.
- "correct" must match one option exactly.
- Options should be plausible and distinct.
- Keep wording concise and classroom-appropriate.
- Use standard math/science notation where needed.
- No markdown, no extra keys, no prose outside JSON.`;

  const { data } = await generateStructuredJson<RawEducationalGameProblem>({
    prompt,
    options: {
      ...options,
      subject,
    },
    temperature: mode === "learn" ? 0.45 : 0.35,
    maxOutputTokens: 1600,
    taskName: "generateEducationalGameProblem",
    maxAttempts: 3,
  });

  const normalized = normalizeEducationalGameProblem(
    data,
    subject,
    level,
    mode,
    options.language
  );
  if (normalized) return normalized;

  return buildFallbackEducationalGameProblem(subject, level, mode, options.language);
}

