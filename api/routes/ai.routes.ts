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
  getNodeInsight,
} from "../../services/ai/gemini.service.js";
import { buildAIOptions } from "../../services/ai/personalization.service.js";
import { getUserById } from "../../services/user.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { aiRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import { getUploadById } from "../../services/upload.service.js";
import { readUploadAsBase64 } from "../../services/upload.service.js";
import { logger } from "../../utils/logger.js";

const router = Router();

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

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post(
  "/chat",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, subject, session_id } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError("messages array is required");
      }

      const aiOptions = await resolveAIOptions(req, subject);
      const response = await chat(messages, aiOptions);
      const userId = req.user!.sub;

      // Persist last user message and AI response
      const sid = session_id ?? generateId();
      const lastUserMsg = messages[messages.length - 1];
      const db = getSupabaseAdmin();
      await db.from("chat_messages").insert([
        { id: generateId(), user_id: userId, session_id: sid, role: "user", content: lastUserMsg.content, subject: subject ?? null, created_at: nowISO() },
        { id: generateId(), user_id: userId, session_id: sid, role: "model", content: response, subject: subject ?? null, created_at: nowISO() },
      ]);

      res.json({ response, session_id: sid });
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

      const aiOptions = await resolveAIOptions(req, subject);
      const explanation = await explainConcept(concept, aiOptions);

      res.json({ explanation });
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

      const aiOptions = await resolveAIOptions(req, subject);
      const solution = await solveProblem(problem, aiOptions);

      res.json({ solution });
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

      const aiOptions = await resolveAIOptions(req, subject);
      const hint = await giveHint(problem, aiOptions);

      res.json({ hint });
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

      const aiOptions = await resolveAIOptions(req, subject);
      const summary = await summarizeContent(content, aiOptions);

      res.json({ summary });
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
      res.json({ analysis });
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
      const { problem, subject } = req.body;
      if (!problem) throw new ValidationError("problem is required");

      const aiOptions = await resolveAIOptions(req, subject);
      const breakdown = await breakdownProblem(problem, aiOptions);

      res.json({ breakdown });
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

      const aiOptions = await resolveAIOptions(req, subject);
      const nodes = await expandNode(nodeLabel, nodeMathContent ?? nodeLabel, parentProblem, aiOptions);
      res.json({ nodes });
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
      res.json({ insight });
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
