import { Router, Request, Response, NextFunction } from "express";
import {
  chat,
  explainConcept,
  solveProblem,
  giveHint,
  summarizeContent,
  analyzeImage,
  extractProblemFromImage,
  type ProblemOcrStructuredResult,
  breakdownProblem,
  expandNode,
  regenerateBranchNode,
  getNodeInsight,
  requiresVisualTable,
  generateVisualTable,
} from "../../services/ai/gemini.service.js";
import {
  generateEducationalGameProblem,
  type GameProblemSubject,
  type GameProblemMode,
} from "../../services/ai/features/game-problem.service.js";
import { buildAIOptions } from "../../services/ai/personalization.service.js";
import { getUserById } from "../../services/user.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { aiRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ForbiddenError, ValidationError } from "../middlewares/error.middleware.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import { getUploadById } from "../../services/upload.service.js";
import { readUploadAsBase64 } from "../../services/upload.service.js";
import { logger } from "../../utils/logger.js";
import {
  getEffectiveAccessState,
  hasEntitlement,
  resolveEntitlementLimit,
} from "../../billing/subscription-service.js";
import {
  DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
  getTodayUsageSnapshot,
  incrementTodayUsage,
} from "../../billing/usage-service.js";
import { publishUsageUpdate } from "../../billing/usage-stream.js";

const router = Router();
const DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY = "daily_deep_dive_token_limit";
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const GAME_PROBLEM_SUBJECTS: readonly GameProblemSubject[] = ["math", "physics", "logic", "bio"];
const GAME_PROBLEM_MODES: readonly GameProblemMode[] = ["learn", "practice", "challenge"];

router.use(requireAuth);
router.use(aiRateLimit);

async function resolveAIOptions(req: Request, subject?: string) {
  const tokenUser = req.user!;
  const latestUser = await getUserById(tokenUser.sub);

  // Prefer DB profile (source of truth for language/grade), fall back to token.
  if (latestUser) {
    return buildAIOptions(latestUser, { subject });
  }
  return buildAIOptions(
    {
      education_level: tokenUser.education_level,
      language: tokenUser.language,
      grade: null,
    },
    { subject }
  );
}

function clip(text: string, max = 180): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

function getAttachTraceId(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const bodyTrace = typeof body?.attach_trace_id === "string" ? body.attach_trace_id.trim() : "";
  if (bodyTrace) return bodyTrace;
  const header = req.headers["x-attach-trace-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) return header[0].trim();
  return `srv_ai_${generateId().slice(0, 12)}`;
}

function endsWithSentenceTerminator(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return /[.!?។៕]\s*$/.test(t);
}

interface TokenBudget {
  userId: string;
  limit: number | null;
  usedBefore: number;
}

interface MeteredUsage {
  featureKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  consumedTokens: number;
  promptTokens: number | null;
  completionTokens: number | null;
  source: "provider" | "estimate";
}

function estimateTokensFromText(text: string): number {
  const normalized = (text ?? "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN));
}

function estimateTokensFromPayload(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return estimateTokensFromText(value);
  try {
    return estimateTokensFromText(JSON.stringify(value));
  } catch {
    return estimateTokensFromText(String(value));
  }
}

async function reserveTokenBudget(userId: string): Promise<TokenBudget> {
  const access = await getEffectiveAccessState(userId);
  if (!hasEntitlement(access.entitlements, "deep_dive_access")) {
    throw new ForbiddenError("Deep Dive is not available for your current plan.");
  }

  const dailyLimit = resolveEntitlementLimit(
    access.entitlements,
    DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
  );
  const usageBefore = await getTodayUsageSnapshot(
    userId,
    DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
    dailyLimit
  );
  if (dailyLimit !== null && usageBefore.used >= dailyLimit) {
    throw new ForbiddenError(
      `Daily Deep Dive token limit reached (${usageBefore.used}/${dailyLimit} tokens today).`
    );
  }

  return {
    userId,
    limit: dailyLimit,
    usedBefore: usageBefore.used,
  };
}

async function consumeTokenBudget(
  budget: TokenBudget,
  payload: {
    input?: unknown;
    output?: unknown;
    providerTotalTokens?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    source?: "provider" | "estimate";
  }
): Promise<MeteredUsage> {
  const providerTotal = typeof payload.providerTotalTokens === "number" && Number.isFinite(payload.providerTotalTokens)
    ? Math.max(0, Math.floor(payload.providerTotalTokens))
    : null;
  const estimatedInput = estimateTokensFromPayload(payload.input);
  const estimatedOutput = estimateTokensFromPayload(payload.output);
  const estimatedTotal = Math.max(1, estimatedInput + estimatedOutput);
  const consumedTokens = Math.max(1, providerTotal ?? estimatedTotal);

  const nextUsed = await incrementTodayUsage(
    budget.userId,
    DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
    consumedTokens
  );

  const meteredUsage: MeteredUsage = {
    featureKey: DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
    used: nextUsed,
    limit: budget.limit,
    remaining: budget.limit === null ? null : Math.max(0, budget.limit - nextUsed),
    consumedTokens,
    promptTokens:
      typeof payload.promptTokens === "number" && Number.isFinite(payload.promptTokens)
        ? Math.max(0, Math.floor(payload.promptTokens))
        : null,
    completionTokens:
      typeof payload.completionTokens === "number" && Number.isFinite(payload.completionTokens)
        ? Math.max(0, Math.floor(payload.completionTokens))
        : null,
    source: payload.source ?? (providerTotal !== null ? "provider" : "estimate"),
  };

  publishUsageUpdate(budget.userId, {
    ...meteredUsage,
    updatedAt: new Date().toISOString(),
  });

  return meteredUsage;
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post(
  "/chat",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, subject, session_id } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError("messages array is required");
      }

      const userId = req.user!.sub;
      const budget = await reserveTokenBudget(userId);
      const aiOptions = await resolveAIOptions(req, subject);
      const chatResult = await chat(messages, aiOptions);

      // Persist last user message and AI response
      const sid = session_id ?? generateId();
      const lastUserMsg = messages[messages.length - 1];
      const db = getSupabaseAdmin();
      await db.from("chat_messages").insert([
        { id: generateId(), user_id: userId, session_id: sid, role: "user", content: lastUserMsg.content, subject: subject ?? null, created_at: nowISO() },
        { id: generateId(), user_id: userId, session_id: sid, role: "model", content: chatResult.text, subject: subject ?? null, created_at: nowISO() },
      ]);

      const usage = await consumeTokenBudget(budget, {
        input: { messages, subject, session_id: sid },
        output: chatResult.text,
        providerTotalTokens: chatResult.usage.totalTokens,
        promptTokens: chatResult.usage.promptTokens,
        completionTokens: chatResult.usage.completionTokens,
        source: chatResult.usage.source,
      });

      res.json({ response: chatResult.text, session_id: sid, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/explain ─────────────────────────────────────────────────────

router.post(
  "/explain",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { concept, subject } = req.body;
      if (!concept) throw new ValidationError("concept is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const explanation = await explainConcept(concept, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { concept, subject },
        output: explanation,
      });

      res.json({ explanation, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/solve ───────────────────────────────────────────────────────

router.post(
  "/solve",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { problem, subject } = req.body;
      if (!problem) throw new ValidationError("problem is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const solution = await solveProblem(problem, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { problem, subject },
        output: solution,
      });

      res.json({ solution, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/hint ────────────────────────────────────────────────────────

router.post(
  "/hint",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { problem, subject } = req.body;
      if (!problem) throw new ValidationError("problem is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const hint = await giveHint(problem, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { problem, subject },
        output: hint,
      });

      res.json({ hint, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/summarize ───────────────────────────────────────────────────

router.post(
  "/summarize",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { content, subject } = req.body;
      if (!content) throw new ValidationError("content is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const summary = await summarizeContent(content, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { content, subject },
        output: summary,
      });

      res.json({ summary, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/game-problem ───────────────────────────────────────────────

router.post(
  "/game-problem",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawSubject = `${req.body?.subject ?? ""}`.trim().toLowerCase();
      const rawMode = `${req.body?.mode ?? "practice"}`.trim().toLowerCase();
      const rawDifficulty = Number(req.body?.difficulty ?? 1);

      if (!GAME_PROBLEM_SUBJECTS.includes(rawSubject as GameProblemSubject)) {
        throw new ValidationError(`subject must be one of: ${GAME_PROBLEM_SUBJECTS.join(", ")}`);
      }
      if (!GAME_PROBLEM_MODES.includes(rawMode as GameProblemMode)) {
        throw new ValidationError(`mode must be one of: ${GAME_PROBLEM_MODES.join(", ")}`);
      }

      const subject = rawSubject as GameProblemSubject;
      const mode = rawMode as GameProblemMode;
      const difficulty = Number.isFinite(rawDifficulty)
        ? Math.max(1, Math.min(10, Math.floor(rawDifficulty)))
        : 1;

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const problem = await generateEducationalGameProblem(subject, difficulty, mode, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { subject, difficulty, mode },
        output: problem,
      });

      res.json({ problem, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/analyze-image ───────────────────────────────────────────────

router.post(
  "/analyze-image",
  async (req: Request, res: Response, next: NextFunction) => {
    const traceId = getAttachTraceId(req);
    const startedAt = Date.now();
    let stage = "init";
    try {
      const { upload_id, question, subject, mode } = req.body;
      stage = "validate:body";
      if (!upload_id) throw new ValidationError("upload_id is required");

      logger.info("[analyze-image] trace:start", {
        traceId,
        userId: req.user?.sub ?? null,
        uploadId: upload_id,
        mode: mode ?? "default",
        subject: subject ?? null,
        hasQuestion: typeof question === "string" && question.trim().length > 0,
        origin: req.headers.origin ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      });

      stage = "lookup:upload";
      const upload = await getUploadById(upload_id);
      if (!upload) throw new ValidationError("Upload not found");
      if (upload.user_id !== req.user!.sub) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      const budget = await reserveTokenBudget(req.user!.sub);
      logger.info("[analyze-image] trace:upload-found", {
        traceId,
        uploadId: upload_id,
        uploadOriginalName: upload.original_name,
        uploadMimeType: upload.mime_type,
        uploadSizeBytes: upload.size_bytes,
        storedName: upload.stored_name,
      });

      stage = "read:file";
      const imagePartRead = await readUploadAsBase64(upload);
      const imagePart = {
        data: imagePartRead.data,
        mimeType: imagePartRead.mimeType,
      };
      logger.info("[analyze-image] trace:file-read", {
        traceId,
        uploadId: upload_id,
        source: imagePartRead.source,
        storagePath: imagePartRead.storagePath ?? upload.stored_name,
        resolvedMimeType: imagePart.mimeType,
        imageBytesApprox: imagePart.data.length,
      });

      stage = "resolve:ai-options";
      const aiOptions = await resolveAIOptions(req, subject);
      logger.info("[analyze-image] request", {
        traceId,
        userId: req.user!.sub,
        uploadId: upload_id,
        mode: mode ?? "default",
        subject: subject ?? null,
        language: aiOptions.language ?? "en",
        uploadOriginalName: upload.original_name,
        uploadMimeType: upload.mime_type,
        uploadSizeBytes: upload.size_bytes,
      });
      if (mode === "problem_ocr") {
        stage = "ocr:extract";
        const structured = await extractProblemFromImage(imagePart, aiOptions);
        const analysis = structured.text ?? "";
        logger.info("[analyze-image] response", {
          traceId,
          userId: req.user!.sub,
          uploadId: upload_id,
          mode: mode ?? "default",
          analysisContractVersion: 2,
          analysisLength: analysis.length,
          analysisPreview: clip(analysis, 260),
          mathSegments: structured.mathSegments.length,
          warnings: structured.warnings,
          plainTextLength: structured.plainText.length,
          samplePlaceholders: structured.mathSegments.slice(0, 5).map((segment) => segment.placeholder),
          invalidMathSegments: structured.mathSegments
            .filter((segment) => !segment.valid)
            .slice(0, 5)
            .map((segment) => ({
              id: segment.id,
              issues: segment.issues,
              latexRaw: clip(segment.latexRaw, 80),
              latexNormalized: clip(segment.latexNormalized, 80),
            })),
          elapsedMs: Date.now() - startedAt,
        });
        const analysisStructured: ProblemOcrStructuredResult = {
          text: analysis,
          plainText: structured.plainText,
          mathSegments: structured.mathSegments,
          warnings: structured.warnings,
        };
        const usage = await consumeTokenBudget(budget, {
          input: {
            mode: mode ?? "problem_ocr",
            question: question ?? "",
            subject: subject ?? null,
            imageBytesApprox: imagePart.data.length,
            uploadMimeType: imagePart.mimeType,
          },
          output: analysisStructured,
        });
        res.json({
          analysis_contract_version: 2,
          analysis,
          analysis_plain_text: analysisStructured.plainText,
          analysis_math_segments: analysisStructured.mathSegments,
          analysis_structured: {
            text: analysisStructured.text,
            plain_text: analysisStructured.plainText,
            math_segments: analysisStructured.mathSegments,
            warnings: analysisStructured.warnings,
          },
          usage,
        });
        logger.info("[analyze-image] trace:done", {
          traceId,
          stage: "ocr:extract",
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }

      stage = "vision:analyze";
      const analysis = await analyzeImage(imagePart, question ?? "", aiOptions);
      logger.info("[analyze-image] response", {
        traceId,
        userId: req.user!.sub,
        uploadId: upload_id,
        mode: mode ?? "default",
        analysisLength: (analysis ?? "").length,
        analysisPreview: clip(analysis ?? "", 260),
        elapsedMs: Date.now() - startedAt,
      });
      const usage = await consumeTokenBudget(budget, {
        input: {
          mode: mode ?? "default",
          question: question ?? "",
          subject: subject ?? null,
          imageBytesApprox: imagePart.data.length,
          uploadMimeType: imagePart.mimeType,
        },
        output: analysis,
      });
      res.json({ analysis, usage });
      logger.info("[analyze-image] trace:done", {
        traceId,
        stage: "vision:analyze",
        elapsedMs: Date.now() - startedAt,
      });
    } catch (err) {
      logger.error("[analyze-image] trace:error", {
        traceId,
        stage,
        userId: req.user?.sub ?? null,
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
      next(err);
    }
  }
);

// ─── POST /api/ai/breakdown ───────────────────────────────────────────────────

router.post(
  "/breakdown",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { problem, subject, upload_id, sign_table_hint } = req.body;
      if (!problem) throw new ValidationError("problem is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);

      let imagePart: { data: string; mimeType: string } | undefined;
      if (upload_id) {
        const upload = await getUploadById(upload_id);
        if (upload && upload.user_id === req.user!.sub && upload.mime_type.startsWith("image/")) {
          const read = await readUploadAsBase64(upload);
          imagePart = { data: read.data, mimeType: read.mimeType };
        }
      }

      const trimmedProblem = (problem as string).trim();
      const heuristicResult = requiresVisualTable(trimmedProblem);

      logger.info("[breakdown] visual-table detection", {
        userId: req.user!.sub,
        sign_table_hint: sign_table_hint === true,
        heuristic: heuristicResult,
        hasUploadId: !!upload_id,
        hasImagePart: !!imagePart,
        problemLength: trimmedProblem.length,
        problemPreview: trimmedProblem.slice(0, 160),
      });

      const breakdown = await breakdownProblem(trimmedProblem, aiOptions, imagePart);

      // Generate visual table if the frontend detected one in OCR (sign_table_hint),
      // or if the backend heuristic fires on the problem text itself.
      let visualTable = null;
      const needsVisualTable = sign_table_hint === true || heuristicResult;
      if (needsVisualTable) {
        const tableSubject = (breakdown as { subject?: string }).subject ?? subject ?? "General";
        logger.info("[breakdown] visual-table generating", {
          userId: req.user!.sub,
          tableSubject,
          hasImagePart: !!imagePart,
          problemPreview: trimmedProblem.slice(0, 120),
        });
        visualTable = await generateVisualTable(trimmedProblem, tableSubject, aiOptions, imagePart ?? null).catch((err) => {
          logger.error("[breakdown] visual-table generation failed", {
            userId: req.user!.sub,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });
        logger.info("[breakdown] visual-table result", {
          userId: req.user!.sub,
          generated: visualTable !== null,
          type: visualTable?.type ?? null,
          rowCount: visualTable?.rows?.length ?? null,
        });
      }

      const usage = await consumeTokenBudget(budget, {
        input: { problem: trimmedProblem, subject, upload_id: upload_id ?? null },
        output: breakdown,
      });

      res.json({ breakdown, usage, ...(visualTable ? { visualTable } : {}) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/expand ──────────────────────────────────────────────────────

router.post(
  "/expand",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { nodeLabel, nodeMathContent, parentProblem, subject } = req.body;
      if (!nodeLabel || !parentProblem) throw new ValidationError("nodeLabel and parentProblem are required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const nodes = await expandNode(nodeLabel, nodeMathContent ?? nodeLabel, parentProblem, aiOptions);
      const usage = await consumeTokenBudget(budget, {
        input: { nodeLabel, nodeMathContent: nodeMathContent ?? nodeLabel, parentProblem, subject },
        output: nodes,
      });
      res.json({ nodes, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/regenerate-node ────────────────────────────────────────────

router.post(
  "/regenerate-node",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { nodeLabel, nodeDescription, nodeMathContent, nodeType, parentProblem, subject } = req.body;
      if (!nodeLabel || !parentProblem) throw new ValidationError("nodeLabel and parentProblem are required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      const node = await regenerateBranchNode(
        nodeLabel,
        nodeDescription ?? "",
        nodeMathContent ?? nodeLabel,
        typeof nodeType === "string" ? nodeType : "branch",
        parentProblem,
        aiOptions
      );
      const usage = await consumeTokenBudget(budget, {
        input: {
          nodeLabel,
          nodeDescription: nodeDescription ?? "",
          nodeMathContent: nodeMathContent ?? nodeLabel,
          nodeType: typeof nodeType === "string" ? nodeType : "branch",
          parentProblem,
          subject,
        },
        output: node,
      });
      res.json({ node, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/node-insight ────────────────────────────────────────────────

router.post(
  "/node-insight",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { nodeLabel, nodeDescription, nodeMathContent, subject, level } = req.body;
      if (!nodeLabel) throw new ValidationError("nodeLabel is required");

      const budget = await reserveTokenBudget(req.user!.sub);
      const aiOptions = await resolveAIOptions(req, subject);
      logger.info("[node-insight] request", {
        userId: req.user!.sub,
        level: level ?? "standard",
        subject: subject ?? "General",
        language: aiOptions.language ?? "en",
        nodeLabelLength: (nodeLabel ?? "").length,
        nodeDescriptionLength: (nodeDescription ?? "").length,
        nodeMathLength: (nodeMathContent ?? nodeLabel ?? "").length,
        nodeLabelPreview: clip(nodeLabel ?? ""),
      });

      const insight = await getNodeInsight(
        nodeLabel,
        nodeDescription ?? '',
        nodeMathContent ?? nodeLabel,
        subject ?? 'General',
        aiOptions,
        level ?? 'standard'
      );

      logger.info("[node-insight] response", {
        userId: req.user!.sub,
        level: level ?? "standard",
        simpleBreakdownLength: (insight.simpleBreakdown ?? "").length,
        simpleBreakdownCompleteEnding: endsWithSentenceTerminator(insight.simpleBreakdown ?? ""),
        keyFormulaLength: (insight.keyFormula ?? "").length,
        simpleBreakdownPreview: clip(insight.simpleBreakdown ?? ""),
      });
      const usage = await consumeTokenBudget(budget, {
        input: {
          nodeLabel,
          nodeDescription: nodeDescription ?? "",
          nodeMathContent: nodeMathContent ?? nodeLabel,
          subject: subject ?? "General",
          level: level ?? "standard",
        },
        output: insight,
      });
      res.json({ insight, usage });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/ai/history ──────────────────────────────────────────────────────

router.get(
  "/history",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { session_id, limit = "50" } = req.query;
      const db = getSupabaseAdmin();
      const limitNum = parseInt(limit as string);

      let query = db
        .from("chat_messages")
        .select("*")
        .eq("user_id", req.user!.sub)
        .limit(limitNum);

      if (session_id) {
        query = query.eq("session_id", session_id as string).order("created_at", { ascending: true });
      } else {
        query = query.order("created_at", { ascending: false });
      }

      const { data: messages, error } = await query;
      if (error) throw new Error(error.message);

      res.json({ messages });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
