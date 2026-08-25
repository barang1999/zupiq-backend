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
  solveProblemSolutionFirst,
  solveFromImageDirect,
  instantBreakdown,
  expandNode,
  regenerateBranchNode,
  getNodeInsight,
  requiresVisualTable,
  generateVisualTable,
  type AIRequestOptions,
} from "../../services/ai/gemini.service.js";
import { segmentMathContent } from "../../utils/math-segmenter.js";
import { normalizeDiagramBlocks } from "../../utils/diagram-blocks.js";
import { buildRenderBlocks, enrichRenderBlocks } from "../../utils/render-blocks.js";
import {
  generateEducationalGameProblem,
  type GameProblemSubject,
  type GameProblemMode,
} from "../../services/ai/features/game-problem.service.js";
import { buildAIOptions } from "../../services/ai/personalization.service.js";
import { getUserById } from "../../services/user.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { aiRateLimit } from "../middlewares/rateLimit.middleware.js";
import { BillingUsageLimitError, ForbiddenError, ValidationError } from "../middlewares/error.middleware.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import { getUploadById } from "../../services/upload.service.js";
import { buildUserKnowledgeContext } from "../../services/knowledge.service.js";
import { buildReferenceContext } from "../../services/reference-corpus.service.js";
import { extractWithMathpix } from "../../services/ai/mathpix.service.js";
import { readUploadAsBase64 } from "../../services/upload.service.js";
import { logger } from "../../utils/logger.js";
import { createSession, getSessionById, updateSession } from "../../services/session.service.js";
import { logActivity } from "../../services/activity-log.service.js";
import { registerProgressClient, emitProgress } from "../../services/progress.service.js";
import { verifyWithWolfram } from "../../services/ai/wolfram.service.js";
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
import { resolveFromCache, RESOLVE_TIMEOUT_POST_OCR_MS } from "../../services/resolver.service.js";

const router = Router();
const DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY = "daily_deep_dive_token_limit";

const FALLBACK_SESSION_PATTERNS = [
  /problem could not be read/i,
  /could not solve/i,
  /^see solution$/i,
  /^n\/a$/i,
  /unable to (solve|determine|read)/i,
  /cannot be determined/i,
  /image could not be/i,
];

function isFallbackSession(
  solution: { title?: string; finalAnswer?: string },
  problemText: string
): boolean {
  const answer = (solution.finalAnswer ?? "").trim();
  const title = (solution.title ?? "").trim();
  const problem = (problemText ?? "").trim();
  if (!problem || problem.length < 3) return true;
  return (
    FALLBACK_SESSION_PATTERNS.some((p) => p.test(answer)) ||
    FALLBACK_SESSION_PATTERNS.some((p) => p.test(title)) ||
    FALLBACK_SESSION_PATTERNS.some((p) => p.test(problem))
  );
}

// ─── PING TEST ───────────────────────────────────────────────────────────────
router.get("/ping", (req, res) => {
  res.json({ status: "ok", message: "AI routes are live", timestamp: new Date().toISOString() });
});

// ─── PROGRESS STREAM ─────────────────────────────────────────────────────────
router.get("/progress/:traceId", (req, res) => {
  registerProgressClient(req.params.traceId, res);
});

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const GAME_PROBLEM_SUBJECTS: readonly GameProblemSubject[] = ["math", "physics", "logic", "bio"];
const GAME_PROBLEM_MODES: readonly GameProblemMode[] = ["learn", "practice", "challenge"];

router.use(requireAuth);
router.use(aiRateLimit);

interface ResolveAIOptionsOptions {
  subject?: string | null;
  session_id?: string;
  step_id?: string;
}

interface ContextualAIOptionsOptions extends ResolveAIOptionsOptions {
  referenceQuery?: string;
}

async function resolveAIOptions(
  req: Request,
  options: ResolveAIOptionsOptions | string = {}
): Promise<AIRequestOptions> {
  const normalizedOptions = typeof options === "string" ? { subject: options } : options;
  const { session_id, step_id } = normalizedOptions;
  const subject = normalizedOptions.subject ?? undefined;
  const tokenUser = req.user!;
  const latestUser = await getUserById(tokenUser.sub);

  // Prefer DB profile (source of truth for language/grade), fall back to token.
  const resolvedLanguage = latestUser?.language ?? tokenUser.language ?? "en";
  logger.info(`[ai-options] language resolution: jwt=${tokenUser.language ?? "n/a"} db=${latestUser?.language ?? "n/a"} → using=${resolvedLanguage} userId=${tokenUser.sub}`);

  let aiOptions = latestUser
    ? buildAIOptions(latestUser, { subject })
    : buildAIOptions(
        {
          education_level: tokenUser.education_level,
          language: tokenUser.language,
          grade: null,
        },
        { subject }
      );

  // Inject Step Context if available
  if (session_id && step_id) {
    try {
      const session = await getSessionById(session_id, tokenUser.sub);
      console.log(`[DEBUG] AI Context Lookup - session_id: ${session_id}, step_id: ${step_id}`);
      
      if (session) {
        const breakdown = parseJsonDeep(session.breakdown_json) as any;
        const nodes = collectExplanationNodes(breakdown);
        
        console.log(`[DEBUG] Session Breakdown nodes count: ${nodes.length}`);

        if (nodes.length > 0) {
          const node = nodes.find((n: any) => String(n.id) === String(step_id));
          
          if (node) {
            console.log(`[DEBUG] Found matching node: ${node.label || node.title}`);
            aiOptions.stepContext = `CRITICAL TUTORING CONTEXT:
The student is currently working on this overall problem:
"${session.problem}"

FULL SOLUTION REFERENCE:
${(session as any).solution_text || "Not available"}

FINAL ANSWER:
${(session as any).final_answer || "Not available"}

CURRENT FOCUS AREA (The student is specifically asking about this part):
STEP TITLE: ${node.label || node.title || "Untitled Step"}
SPECIFIC FORMULA/MATH: ${node.mathContent || "None"}
STEP DESCRIPTION: ${node.description || "No description available."}

INSTRUCTION: 
1. Your primary focus is to explain the "CURRENT FOCUS AREA" while staying consistent with the "FULL SOLUTION REFERENCE".
2. If the student refers to "this step", "the formula", or "this part", they are strictly talking about the math shown in the FOCUS AREA above.
3. Use the FULL SOLUTION context to explain WHY this step exists and HOW it leads to the FINAL ANSWER.
4. DO NOT tell the student you don't know the problem or solution. You have everything you need above.`;
          } else {
            console.log(`[DEBUG] No node found matching id: ${step_id}. Available IDs: ${nodes.map((n: any) => n.id).join(', ')}`);
          }
        }
      } else {
        console.log(`[DEBUG] Session not found for id: ${session_id}`);
      }
    } catch (err) {
      logger.error("Failed to fetch step context for AI options", err);
    }
  }

  return aiOptions;
}

async function buildContextualAIOptions(
  req: Request,
  options: ContextualAIOptionsOptions = {}
): Promise<AIRequestOptions> {
  let aiOptions = await resolveAIOptions(req, options);
  const subject = options.subject;
  const query = [
    options.referenceQuery,
    subject,
    aiOptions.grade ? `grade ${aiOptions.grade}` : "",
  ].filter(Boolean).join("\n");

  const [knowledgeCtx, referenceCtx] = await Promise.all([
    buildUserKnowledgeContext(req.user!.sub, subject).catch((err) => {
      logger.error("Failed to build user knowledge context", err);
      return null;
    }),
    buildReferenceContext({
      subject,
      grade: aiOptions.grade,
      language: aiOptions.language,
      query,
    }).catch((err) => {
      logger.error("Failed to build reference context", err);
      return null;
    }),
  ]);

  if (knowledgeCtx) aiOptions = { ...aiOptions, userKnowledgeContext: knowledgeCtx };
  if (referenceCtx) aiOptions = { ...aiOptions, referenceContext: referenceCtx };
  return aiOptions;
}

function clip(text: string, max = 180): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}...`;
}

function collectExplanationNodes(payload: any): any[] {
  const directNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const explanationNodes = Array.isArray(payload?.explanation?.nodes) ? payload.explanation.nodes : [];
  const nodes = explanationNodes.length > 0 ? explanationNodes : directNodes;
  const collected: any[] = [];

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    collected.push(node);
    if (Array.isArray(node.subSteps)) node.subSteps.forEach(visit);
  };

  nodes.forEach(visit);
  return collected;
}

function isSolutionFirstPayload(payload: any): boolean {
  return payload?.mode === "solution-first";
}

function attachRenderBlocksToNode(node: any): any {
  if (!node || typeof node !== "object") return node;

  const label = String(node.label || node.title || "").trim();
  const description = String(node.description || node.why || "").trim();
  const mathContent = String(node.mathContent || node.math || node.keyFormula || "").trim();

  if (label && !Array.isArray(node.labelBlocks)) node.labelBlocks = buildRenderBlocks(label);
  else if (Array.isArray(node.labelBlocks)) node.labelBlocks = enrichRenderBlocks(node.labelBlocks);
  if (description && !Array.isArray(node.descriptionBlocks)) node.descriptionBlocks = buildRenderBlocks(description);
  else if (Array.isArray(node.descriptionBlocks)) node.descriptionBlocks = enrichRenderBlocks(node.descriptionBlocks);
  // Use buildRenderBlocks so mixed prose+math mathContent keeps its text blocks.
  if (mathContent && !Array.isArray(node.mathBlocks)) node.mathBlocks = buildRenderBlocks(mathContent, { defaultDisplay: true });
  else if (Array.isArray(node.mathBlocks)) node.mathBlocks = enrichRenderBlocks(node.mathBlocks);
  if (Array.isArray(node.subSteps)) node.subSteps = node.subSteps.map(attachRenderBlocksToNode);

  return node;
}

function attachRenderBlocksToPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;

  if (isSolutionFirstPayload(payload)) {
    payload.version = 3;
    if (payload.solutionText && !Array.isArray(payload.solutionBlocks)) {
      payload.solutionBlocks = buildRenderBlocks(String(payload.solutionText));
    } else if (Array.isArray(payload.solutionBlocks)) {
      payload.solutionBlocks = enrichRenderBlocks(payload.solutionBlocks);
    }
    if (payload.finalAnswer) {
      payload.finalAnswerBlocks = buildRenderBlocks(String(payload.finalAnswer), { defaultDisplay: false });
    } else if (Array.isArray(payload.finalAnswerBlocks)) {
      payload.finalAnswerBlocks = enrichRenderBlocks(payload.finalAnswerBlocks);
    }
    if (Array.isArray(payload.diagramBlocks)) {
      payload.diagramBlocks = normalizeDiagramBlocks(payload.diagramBlocks);
    }
    if (Array.isArray(payload.explanation?.nodes)) {
      payload.explanation.nodes = payload.explanation.nodes.map(attachRenderBlocksToNode);
    }
    return payload;
  }

  if (Array.isArray(payload.nodes)) {
    payload.nodes = payload.nodes.map(attachRenderBlocksToNode);
  }
  return payload;
}

function getMutableExplanationNodes(payload: any): any[] {
  if (isSolutionFirstPayload(payload)) {
    if (!payload.explanation || typeof payload.explanation !== "object") {
      payload.explanation = {};
    }
    if (!Array.isArray(payload.explanation.nodes)) {
      payload.explanation.nodes = [];
    }
    return payload.explanation.nodes;
  }

  if (!Array.isArray(payload.nodes)) payload.nodes = [];
  return payload.nodes;
}

function findNodeById(nodes: any[], nodeId: string): any | null {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (String(node.id) === String(nodeId)) return node;
    const child = Array.isArray(node.subSteps) ? findNodeById(node.subSteps, nodeId) : null;
    if (child) return child;
  }
  return null;
}

function summarizeNodeForExpansion(node: any): string {
  if (!node || typeof node !== "object") return "";
  return [
    String(node.label || node.title || "").trim(),
    String(node.description || "").trim(),
    String(node.mathContent || node.math || "").trim(),
  ].filter(Boolean).join(" | ");
}

function buildExpansionSolutionReference(payload: Record<string, any>, nodes: any[]): string {
  const solutionText = String(payload.solutionText || "").trim();
  if (solutionText) return solutionText;

  return nodes
    .map((node, index) => {
      const summary = summarizeNodeForExpansion(node);
      return summary ? `${index + 1}. ${summary}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeExpansionMath(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\$\$?/g, "")
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function hasUsefulCachedSubSteps(targetNode: any): boolean {
  const subSteps = Array.isArray(targetNode?.subSteps) ? targetNode.subSteps : [];
  if (subSteps.length < 3) return false;

  const parentMath = normalizeExpansionMath(targetNode?.mathContent || targetNode?.math || targetNode?.label);
  if (!parentMath) return true;

  const distinctIntermediateCount = subSteps.filter((step: any, index: number) => {
    const math = normalizeExpansionMath(step?.mathContent || step?.math || step?.label);
    if (!math) return false;
    const isFinal = index === subSteps.length - 1;
    return !isFinal && math !== parentMath;
  }).length;

  return distinctIntermediateCount >= Math.ceil(subSteps.length / 2);
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

function looksLikeImagePlaceholder(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (/^\[?\s*image(\s*#?\d+)?\s*\]?$/i.test(t)) return true;
  if (/^<image[^>]*>$/i.test(t)) return true;
  if (/^!\[.*\]\(.*\)$/.test(t)) return true;
  return false;
}

function parseJsonDeep(value: unknown, maxDepth = 3): unknown {
  let current: unknown = value;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== "string") return current;
    const trimmed = current.trim();
    if (!trimmed || !/^[{\["]/.test(trimmed)) return current;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }
  return current;
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
  ai_cost_usd: number;
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

const DEV_BYPASS_LIMITS = process.env.DEV_BYPASS_LIMITS === "true";

async function reserveTokenBudget(userId: string): Promise<TokenBudget> {
  if (DEV_BYPASS_LIMITS) {
    return { userId, limit: null, usedBefore: 0 };
  }

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
    throw new BillingUsageLimitError(
      `Daily free usage limit reached (${usageBefore.used}/${dailyLimit} tokens today).`,
      {
        featureKey: DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        used: usageBefore.used,
        limit: dailyLimit,
        remaining: 0,
      }
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

  const meteredUsage: Omit<MeteredUsage, "ai_cost_usd"> = {
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

  // Cost estimate using Gemini 2.5 Flash pricing
  const INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;  // $0.075 per 1M input tokens
  const OUTPUT_COST_PER_TOKEN = 0.300 / 1_000_000;  // $0.300 per 1M output tokens
  const inputTokens  = meteredUsage.promptTokens     ?? estimatedInput;
  const outputTokens = meteredUsage.completionTokens ?? estimatedOutput;
  const ai_cost_usd  = +((inputTokens * INPUT_COST_PER_TOKEN) + (outputTokens * OUTPUT_COST_PER_TOKEN)).toFixed(6);

  const finalUsage: MeteredUsage = { ...meteredUsage, ai_cost_usd };

  logger.info("[token-usage] consumed", {
    userId: budget.userId,
    source: finalUsage.source,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens: consumedTokens,
    estimatedCostUsd: ai_cost_usd,
    dailyUsed: nextUsed,
    dailyLimit: budget.limit,
  });

  publishUsageUpdate(budget.userId, {
    ...finalUsage,
    updatedAt: new Date().toISOString(),
  });

  return finalUsage;
}

// ─── POST /api/ai/chat ────────────────────────────────────────────────────────

router.post(
  "/chat",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, subject, session_id, upload_id, step_id } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new ValidationError("messages array is required");
      }

      const userId = req.user!.sub;
      const budget = await reserveTokenBudget(userId);
      const lastUserMessage = messages[messages.length - 1];
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        session_id,
        step_id,
        referenceQuery: typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "",
      });

      let imagePart: { data: string; mimeType: string } | undefined;
      if (upload_id) {
        const upload = await getUploadById(upload_id);
        if (upload && upload.user_id === userId && upload.mime_type.startsWith("image/")) {
          const read = await readUploadAsBase64(upload);
          imagePart = { data: read.data, mimeType: read.mimeType };
        }
      }

      const chatResult = await chat(messages, aiOptions, imagePart);
      const aiSegments = segmentMathContent(chatResult.text);

      // Persist last user message and AI response
      const sid = session_id ?? generateId();
      const lastUserMsg = lastUserMessage;
      const db = getSupabaseAdmin();
      await db.from("chat_messages").insert([
        { 
          id: generateId(), 
          user_id: userId, 
          session_id: sid, 
          step_id: step_id ?? null,
          role: "user", 
          content: { text: lastUserMsg.content, segments: segmentMathContent(lastUserMsg.content) },
          subject: subject ?? null, 
          created_at: nowISO() 
        },
        { 
          id: generateId(), 
          user_id: userId, 
          session_id: sid, 
          step_id: step_id ?? null,
          role: "model", 
          content: { text: chatResult.text, segments: aiSegments },
          subject: subject ?? null, 
          created_at: nowISO(),
          metadata: {
            visualTable: chatResult.visualTable ?? null
          }
        },
      ]);

      const usage = await consumeTokenBudget(budget, {
        input: { messages, subject, session_id: sid, upload_id: upload_id ?? null },
        output: chatResult.text,
        providerTotalTokens: chatResult.usage.totalTokens,
        promptTokens: chatResult.usage.promptTokens,
        completionTokens: chatResult.usage.completionTokens,
        source: chatResult.usage.source,
      });

      res.json({
        response: chatResult.text,
        session_id: sid,
        usage,
        finish_reason: chatResult.finishReason,
        visualTable: chatResult.visualTable,
      });
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
      const aiOptions = await buildContextualAIOptions(req, { subject, referenceQuery: concept });
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
      const aiOptions = await buildContextualAIOptions(req, { subject, referenceQuery: problem });
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
      const aiOptions = await buildContextualAIOptions(req, { subject, referenceQuery: problem });
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
      const aiOptions = await buildContextualAIOptions(req, { subject, referenceQuery: content });
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
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: `${subject} ${mode} difficulty ${difficulty}`,
      });
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
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: `${subject ?? ""} ${mode ?? ""} ${upload.original_name ?? ""}`,
      });
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
      const aiOptions = await buildContextualAIOptions(req, { subject, referenceQuery: problem });

      let imagePart: { data: string; mimeType: string } | undefined;
      if (upload_id) {
        const upload = await getUploadById(upload_id);
        if (upload && upload.user_id === req.user!.sub && upload.mime_type.startsWith("image/")) {
          const read = await readUploadAsBase64(upload);
          imagePart = { data: read.data, mimeType: read.mimeType };
        }
      }

      const trimmedProblem = (problem as string).trim();
      if (looksLikeImagePlaceholder(trimmedProblem)) {
        throw new ValidationError("The uploaded image could not be read clearly. Please retake the photo.");
      }
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

// ─── POST /api/ai/explain-session ────────────────────────────────────────────

router.post(
  "/explain-session",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { session_id } = req.body;
      if (typeof session_id !== "string" || !session_id.trim()) {
        throw new ValidationError("session_id is required");
      }

      const userId = req.user!.sub;
      const session = await getSessionById(session_id.trim(), userId);
      if (!session) {
        throw new ForbiddenError("Session is not available.");
      }

      const payload = parseJsonDeep(session.breakdown_json);
      if (!payload || typeof payload !== "object") {
        throw new ValidationError("Session solution data is not available.");
      }

      const solutionPayload = attachRenderBlocksToPayload(payload as Record<string, any>);
      const existingNodes = isSolutionFirstPayload(solutionPayload)
        ? solutionPayload.explanation?.nodes
        : solutionPayload.nodes;

      if (Array.isArray(existingNodes) && existingNodes.length > 0) {
        await updateSession(session.id, userId, {
          breakdown_json: solutionPayload,
          node_count: existingNodes.length,
        }).catch(() => null);
        res.json({
          session,
          explanation: { nodes: existingNodes },
          cached: true,
        });
        return;
      }

      const budget = await reserveTokenBudget(userId);
      const aiOptions = await buildContextualAIOptions(req, {
        subject: session.subject,
        referenceQuery: session.problem,
      });

      const explanation = await breakdownProblem(
        session.problem, 
        aiOptions, 
        undefined, 
        solutionPayload.solutionText || undefined
      );
      const explanationNodes = Array.isArray(explanation.nodes)
        ? explanation.nodes.map(attachRenderBlocksToNode)
        : [];
      const nextPayload = isSolutionFirstPayload(solutionPayload)
        ? {
            ...solutionPayload,
            version: 3,
            explanationStatus: "generated",
            explanation: { nodes: explanationNodes },
            insights: explanation.insights ?? solutionPayload.insights ?? {},
          }
        : attachRenderBlocksToPayload({ ...explanation, nodes: explanationNodes });

      const updatedSession = await updateSession(session.id, userId, {
        breakdown_json: nextPayload,
        node_count: explanationNodes.length,
      });

      const usage = await consumeTokenBudget(budget, {
        input: { session_id: session.id, problem: session.problem, subject: session.subject },
        output: explanation,
      });

      res.json({
        session: updatedSession,
        explanation: { nodes: explanationNodes },
        usage,
        cached: false,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/ai/instant-session ─────────────────────────────────────────────

router.post(
  "/instant-session",
  async (req: Request, res: Response, next: NextFunction) => {
    logger.info("[instant-session] request received", { userId: req.user?.sub, hasImageBase64: !!req.body.image_base64, hasUploadId: !!req.body.upload_id });
    const traceId = getAttachTraceId(req);
    const startedAt = Date.now();
    let stage = "init";
    try {
      const { upload_id, subject, image_base64, image_mime_type, problem_text } = req.body;
      const userId = req.user!.sub;

      emitProgress(traceId, { stage: "VALIDATING", progress: 5, message: "Validating..." });

      stage = "validate:body";
      if (!problem_text && !image_base64 && !upload_id) {
        throw new ValidationError("problem_text, image_base64, or upload_id is required");
      }

      const budget = await reserveTokenBudget(userId);
      let aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: typeof problem_text === "string" ? problem_text : subject,
      });

      let problemText: string;
      let solution: import("../../services/ai/gemini.service.js").ProblemSolutionFirst;
      let ocrSource: "on-device" | "gemini-vision" = "gemini-vision";
      let imagePart: { data: string; mimeType: string } | undefined;
      let uploadRecord: any = null;

      if (problem_text) {
        // ── Fast path: on-device OCR (ML Kit) already extracted the text ──────
        // Skip all image handling and OCR — go straight to solve.
        const text = (problem_text as string).trim();
        if (!text || looksLikeImagePlaceholder(text)) {
          throw new ValidationError("Could not read the problem from this image. Please try a clearer photo.");
        }

        ocrSource = "on-device";

        // ── Semantic cache check ──────────────────────────────────────────────
        // Check if we have a highly similar past problem before calling AI.
        stage = "resolver:check";
        const cached = await resolveFromCache(text, subject, req.user!.language);
        logger.info(`[instant-session] ⚡ RESOLVER: mode=${cached.mode} confidence=${cached.confidence.toFixed(3)} language=${req.user!.language ?? "en"}`, { traceId });

        if (cached.mode === "instant" && cached.breakdown_json) {
          // Similarity ≥ 0.92 — serve directly from cache, skip AI entirely.
          emitProgress(traceId, { stage: "BUILDING", progress: 85, message: "Found cached solution..." });
          const cachedPayload = attachRenderBlocksToPayload(cached.breakdown_json as any);
          const cachedSession = await createSession(userId, {
            title: ((cachedPayload as any).title || "New Session").trim(),
            subject: (subject || (cachedPayload as any).subject || "General").trim(),
            topic: (cachedPayload as any).topic || null,
            problem: text,
            node_count: 0,
            breakdown_json: cachedPayload,
            visual_table_json: null,
            image_url: null,
          });
          emitProgress(traceId, { stage: "DONE", progress: 100, message: "Redirecting..." });
          res.status(201).json({
            session: cachedSession,
            ocr: { text, source: ocrSource, warnings: [] },
            cached: true,
            resolver_confidence: cached.confidence,
          });
          logger.info("[instant-session] served from cache", {
            traceId, confidence: cached.confidence, cachedSessionId: cached.session_id,
          });
          return;
        }

        // mode='hint': inject cached solution as few-shot context into AI options
        if (cached.mode === "hint" && cached.solution_text) {
          aiOptions = {
            ...aiOptions,
            referenceContext: [
              aiOptions.referenceContext,
              `SIMILAR SOLVED PROBLEM (use as a guide, do not copy directly):\n${cached.solution_text}`,
            ].filter(Boolean).join("\n\n"),
          };
        }

        emitProgress(traceId, { stage: "SOLVING", progress: 30, message: "Solving problem..." });

        stage = "ai:solve-text";
        solution = await solveProblemSolutionFirst(text, aiOptions);
        problemText = text;

        logger.info("[instant-session] on-device-ocr+solve complete", {
          traceId, ocrSource, problemTextLength: problemText.length,
          elapsedMs: Date.now() - startedAt,
        });
      } else {
        // ── Image path: resolve bytes then run Gemini vision ──────────────────
        let imagePart: { data: string; mimeType: string };

        if (image_base64) {
          stage = "image:inline";
          imagePart = {
            data: image_base64 as string,
            mimeType: (image_mime_type as string | undefined) ?? "image/jpeg",
          } as { data: string; mimeType: string };
          logger.info("[instant-session] using inline image", {
            traceId, mimeType: imagePart.mimeType, bytesApprox: imagePart.data.length,
          });
        } else {
          stage = "lookup:upload";
          emitProgress(traceId, { stage: "READING", progress: 10, message: "Reading problem..." });
          uploadRecord = await getUploadById(upload_id);
          if (!uploadRecord) throw new ValidationError("Upload not found");
          if (uploadRecord.user_id !== userId) {
            res.status(403).json({ error: "Forbidden" });
            return;
          }
          stage = "read:file";
          const imagePartRead = await readUploadAsBase64(uploadRecord);
          imagePart = { data: imagePartRead.data, mimeType: imagePartRead.mimeType } as { data: string; mimeType: string };
          logger.info("[instant-session] using upload", {
            traceId, uploadId: upload_id, source: imagePartRead.source,
            bytesApprox: imagePart.data.length,
          });
        }

        emitProgress(traceId, { stage: "SOLVING", progress: 30, message: "Reading & solving..." });
        stage = "ai:solve-from-image";
        const combined = await solveFromImageDirect(imagePart, aiOptions);
        problemText = combined.problemText;
        solution = combined.solution;

        logger.info("[instant-session] gemini-vision solve complete", {
          traceId, ocrSource, problemTextLength: problemText.length,
          elapsedMs: Date.now() - startedAt,
        });

        if (!problemText || looksLikeImagePlaceholder(problemText)) {
          throw new ValidationError("Could not read the problem from this image. Please try a clearer photo.");
        }

        // ── Post-OCR semantic cache check ────────────────────────────────────
        // Vision already solved, but if cache has a high-confidence match use
        // the cached (positively-rated) breakdown instead of the fresh AI one.
        const resolverSubject = subject ?? solution.subject;
        const cachedFromImage = await resolveFromCache(problemText, resolverSubject, req.user!.language, RESOLVE_TIMEOUT_POST_OCR_MS);
        logger.info(`[instant-session] ⚡ RESOLVER (post-ocr): mode=${cachedFromImage.mode} confidence=${cachedFromImage.confidence.toFixed(3)} language=${req.user!.language ?? "en"}`, { traceId });

        if (cachedFromImage.mode === "instant" && cachedFromImage.breakdown_json) {
          emitProgress(traceId, { stage: "BUILDING", progress: 85, message: "Found cached solution..." });
          const cachedPayload = attachRenderBlocksToPayload(cachedFromImage.breakdown_json as any);
          const cachedSession = await createSession(userId, {
            title: ((cachedPayload as any).title || "New Session").trim(),
            subject: (subject || (cachedPayload as any).subject || "General").trim(),
            topic: (cachedPayload as any).topic || null,
            problem: problemText,
            node_count: 0,
            breakdown_json: cachedPayload,
            visual_table_json: null,
            image_url: uploadRecord?.storage_url ?? null,
          });
          emitProgress(traceId, { stage: "DONE", progress: 100, message: "Redirecting..." });
          res.status(201).json({
            session: cachedSession,
            ocr: { text: problemText, source: ocrSource, warnings: [] },
            cached: true,
            resolver_confidence: cachedFromImage.confidence,
          });
          logger.info("[instant-session] image path served from cache", {
            traceId, confidence: cachedFromImage.confidence, cachedSessionId: cachedFromImage.session_id,
          });
          return;
        }
      }

      logger.info("[instant-session] solution ready", {
        traceId, ocrSource, title: solution.title,
        mode: solution.mode, elapsedMs: Date.now() - startedAt,
      });

      emitProgress(traceId, { stage: "BUILDING", progress: 75, message: "Finalizing solution..." });

      // Fire off visual table generation in parallel if needed
      let visualTablePromise = Promise.resolve<any>(null);
      if (requiresVisualTable(problemText)) {
        const tableSubject = solution.subject ?? subject ?? "General";
        visualTablePromise = generateVisualTable(problemText, tableSubject, aiOptions, imagePart).catch(() => null);
      }

      stage = "session:create";
      const visualTable = await visualTablePromise;

      emitProgress(traceId, { stage: "SAVING", progress: 90, message: "Saving session..." });

      // Wolfram Alpha cross-check: verify or patch finalAnswer using a CAS
      stage = "wolfram:verify";
      const wolframAnswer = await verifyWithWolfram(problemText).catch(() => null);
      if (wolframAnswer) {
        logger.info("[instant-session] wolfram cross-check", {
          traceId,
          aiAnswer: solution.finalAnswer?.slice(0, 120),
          wolframAnswer: wolframAnswer.slice(0, 120),
        });
        // Override AI answer only when AI produced a fallback/empty answer
        if (!solution.finalAnswer || isFallbackSession(solution, problemText)) {
          solution = { ...solution, finalAnswer: wolframAnswer };
        }
      }

      // Quality gate: reject sessions with unreadable/unsolvable content
      if (isFallbackSession(solution, problemText)) {
        throw new ValidationError(
          "Could not read or solve the problem from this image. Please try a clearer photo."
        );
      }

      // Resolve image_url from the upload (if it came via upload_id path)
      let sessionImageUrl: string | null = null;
      if (uploadRecord?.storage_url) {
        sessionImageUrl = uploadRecord.storage_url;
      } else if (upload_id) {
        const up = await getUploadById(upload_id).catch(() => null);
        if (up?.storage_url) sessionImageUrl = up.storage_url;
      }

      logger.info("[instant-session] resolved session image url", {
        traceId,
        uploadId: upload_id,
        sessionImageUrl,
        uploadRecordStorageUrl: uploadRecord?.storage_url ?? null,
      });

      stage = "session:create";
      solution = attachRenderBlocksToPayload(solution) as typeof solution;
      // Strip internal _usage field before storing in breakdown_json
      const { _usage: solutionUsage, ...solutionForStorage } = solution;
      const session = await createSession(userId, {
        title: (solution.title || "New Session").trim(),
        subject: (subject || solution.subject || "General").trim(),
        topic: solution.topic || null,
        problem: problemText,
        node_count: 0,
        breakdown_json: solutionForStorage,
        visual_table_json: visualTable,
        image_url: sessionImageUrl,
      });

      stage = "activity:log";
      logActivity(session.id, userId, "session_created", {
        title: session.title,
        subject: session.subject,
        source: "instant_photo",
      });

      stage = "usage:consume";
      const usage = await consumeTokenBudget(budget, {
        input: { upload_id: upload_id ?? null, subject, source: "instant_photo" },
        output: { session_id: session.id, problem: problemText },
        providerTotalTokens: solutionUsage?.totalTokens ?? null,
        promptTokens: solutionUsage?.promptTokens ?? null,
        completionTokens: solutionUsage?.completionTokens ?? null,
        source: solutionUsage?.source ?? "estimate",
      });

      // Persist token usage and cost to the session record (fire-and-forget)
      updateSession(session.id, userId, {
        prompt_tokens:     usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens:      usage.consumedTokens,
        ai_cost_usd:       usage.ai_cost_usd,
      }).catch((err) => logger.warn("[instant-session] token usage save failed", { error: String(err?.message ?? err) }));

      emitProgress(traceId, { stage: "DONE", progress: 100, message: "Redirecting..." });

      res.status(201).json({
        session,
        usage,
        ocr: { text: problemText, source: ocrSource, warnings: [] },
      });

      logger.info(`[instant-session] ✅ SERVED BY AI (no cache hit) — sessionId=${session.id} elapsed=${Date.now() - startedAt}ms`, { traceId });
    } catch (err) {
      logger.error("[instant-session] trace:error", {
        traceId, stage, userId: req.user?.sub ?? null,
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
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
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: [nodeLabel, nodeMathContent, parentProblem].filter(Boolean).join("\n"),
      });
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

// ─── POST /api/ai/expand-session-node ────────────────────────────────────────

router.post(
  "/expand-session-node",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { session_id, node_id } = req.body;
      if (typeof session_id !== "string" || !session_id.trim()) {
        throw new ValidationError("session_id is required");
      }
      if (typeof node_id !== "string" || !node_id.trim()) {
        throw new ValidationError("node_id is required");
      }

      const userId = req.user!.sub;
      const session = await getSessionById(session_id.trim(), userId);
      if (!session) throw new ForbiddenError("Session is not available.");

      const payload = parseJsonDeep(session.breakdown_json);
      if (!payload || typeof payload !== "object") {
        throw new ValidationError("Session solution data is not available.");
      }

      const solutionPayload = attachRenderBlocksToPayload(payload as Record<string, any>);
      const nodes = getMutableExplanationNodes(solutionPayload);
      const targetNode = findNodeById(nodes, node_id.trim());
      if (!targetNode) throw new ValidationError("Step is not available in this session.");
      const targetIndex = nodes.findIndex((node) => String(node?.id) === String(targetNode.id));
      const previousStep = targetIndex > 0 ? summarizeNodeForExpansion(nodes[targetIndex - 1]) : "";
      const nextStep = targetIndex >= 0 && targetIndex < nodes.length - 1
        ? summarizeNodeForExpansion(nodes[targetIndex + 1])
        : "";

      if (hasUsefulCachedSubSteps(targetNode)) {
        res.json({
          session,
          node: targetNode,
          nodes: targetNode.subSteps,
          cached: true,
        });
        return;
      }

      const budget = await reserveTokenBudget(userId);
      const aiOptions = await buildContextualAIOptions(req, {
        subject: session.subject,
        session_id: session.id,
        step_id: String(targetNode.id),
        referenceQuery: [
          session.problem,
          targetNode.label,
          targetNode.description,
          targetNode.mathContent,
        ].filter(Boolean).join("\n"),
      });
      const generated = await expandNode(
        String(targetNode.label || targetNode.title || `Step ${targetNode.id}`),
        String(targetNode.mathContent || targetNode.math || targetNode.label || ""),
        session.problem,
        aiOptions,
        {
          nodeDescription: String(targetNode.description || targetNode.why || "").trim(),
          previousStep,
          nextStep,
          fullSolution: buildExpansionSolutionReference(solutionPayload, nodes),
        }
      );

      const subSteps = generated.map((node, index) => attachRenderBlocksToNode({
        ...node,
        id: `${targetNode.id}_sub_${index + 1}`,
        parentId: String(targetNode.id),
        type: node.type || "branch",
      }));

      targetNode.subSteps = subSteps;
      targetNode.expandedAt = nowISO();

      const updatedSession = await updateSession(session.id, userId, {
        breakdown_json: solutionPayload,
        node_count: collectExplanationNodes(solutionPayload).length,
      });

      const usage = await consumeTokenBudget(budget, {
        input: { session_id: session.id, node_id: targetNode.id, subject: session.subject },
        output: subSteps,
      });

      res.json({
        session: updatedSession,
        node: targetNode,
        nodes: subSteps,
        usage,
        cached: false,
      });
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
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: [nodeLabel, nodeDescription, nodeMathContent, parentProblem].filter(Boolean).join("\n"),
      });
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
      const aiOptions = await buildContextualAIOptions(req, {
        subject,
        referenceQuery: [nodeLabel, nodeDescription, nodeMathContent].filter(Boolean).join("\n"),
      });
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
      const { session_id, step_id, limit = "50" } = req.query;
      const db = getSupabaseAdmin();
      const limitNum = parseInt(limit as string);

      let query = db
        .from("chat_messages")
        .select("*")
        .eq("user_id", req.user!.sub)
        .limit(limitNum);

      if (session_id) {
        query = query.eq("session_id", session_id as string);
      }

      if (step_id) {
        query = query.eq("step_id", step_id as string);
      }

      query = query.order("created_at", { ascending: session_id ? true : false });

      const { data: messages, error } = await query;
      if (error) throw new Error(error.message);

      res.json({ messages });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
