import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "../../config/env.js";
import { requireAdminAuth } from "../middlewares/admin.middleware.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// ─── POST /api/admin/login ────────────────────────────────────────────────────

router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required." });
      return;
    }

    const emailMatch = email.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();

    // Use constant-time comparison via bcrypt if password is hashed,
    // or direct comparison for plaintext env var (dev only).
    const passwordMatch = await (async () => {
      // If the stored password looks like a bcrypt hash, use bcrypt.compare.
      if (env.ADMIN_PASSWORD.startsWith("$2")) {
        return bcrypt.compare(password, env.ADMIN_PASSWORD);
      }
      return password === env.ADMIN_PASSWORD;
    })();

    if (!emailMatch || !passwordMatch) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const token = jwt.sign({ role: "admin" }, env.ADMIN_JWT_SECRET, { expiresIn: "12h" });

    res.json({ token });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
// Query params:
//   from  ISO date string — start of period (inclusive). Defaults to start of current month.
//   to    ISO date string — end of period (inclusive). Defaults to now.

router.get("/stats", requireAdminAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();

    // Resolve date range — default to current month
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const defaultTo = now.toISOString();

    const fromParam = (req.query.from as string | undefined)?.trim();
    const toParam = (req.query.to as string | undefined)?.trim();

    const from = fromParam && !isNaN(Date.parse(fromParam)) ? fromParam : defaultFrom;
    const to = toParam && !isNaN(Date.parse(toParam)) ? toParam : defaultTo;

    // Run all queries in parallel
    const [
      { count: totalUsers },
      { count: totalSessions },
      { data: activeUserRows },
      { data: tokenData },
      { count: coreUsers },
      { count: proUsers },
    ] = await Promise.all([
      // Total users is always all-time
      db.from("users").select("*", { count: "exact", head: true }),
      // Session count within the selected period
      db
        .from("study_sessions")
        .select("*", { count: "exact", head: true })
        .gte("created_at", from)
        .lte("created_at", to),
      // Distinct active users within the period
      db
        .from("study_sessions")
        .select("user_id")
        .gte("created_at", from)
        .lte("created_at", to),
      // Token + cost data within the period
      db
        .from("study_sessions")
        .select("total_tokens, prompt_tokens, completion_tokens, ai_cost_usd")
        .gte("created_at", from)
        .lte("created_at", to),
      // Core subscribers (all-time, active/trialing)
      db
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("plan_key", "core")
        .in("status", ["active", "trialing"]),
      // Pro subscribers (all-time, active/trialing)
      db
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("plan_key", "pro")
        .in("status", ["active", "trialing"]),
    ]);

    const rows = (tokenData ?? []) as {
      total_tokens: number | null;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      ai_cost_usd: number | null;
    }[];

    const activeUsers = new Set((activeUserRows ?? []).map((r: { user_id: string }) => r.user_id)).size;

    const totalTokens = rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const totalPromptTokens = rows.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0);
    const totalCompletionTokens = rows.reduce((s, r) => s + (r.completion_tokens ?? 0), 0);
    const totalCostUsd = rows.reduce((s, r) => s + (r.ai_cost_usd ?? 0), 0);
    const sessionCount = totalSessions ?? 0;
    const avgCostPerSession = sessionCount > 0 ? totalCostUsd / sessionCount : 0;

    res.json({
      // Always all-time
      totalUsers: totalUsers ?? 0,
      coreUsers: coreUsers ?? 0,
      proUsers: proUsers ?? 0,
      // Period-scoped metrics
      period: { from, to },
      totalSessions: sessionCount,
      activeUsers: activeUsers ?? 0,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      totalCostUsd,
      avgCostPerSession,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────

router.get("/users", requireAdminAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getSupabaseAdmin();
    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10)));
    const search = ((req.query.search as string) ?? "").trim();
    const offset = (page - 1) * limit;

    // Build user query — embed subscription via FK relation
    let userQuery = db
      .from("users")
      .select(
        "id, email, full_name, avatar_url, education_level, created_at, preferences, subscriptions(plan_key, status, provider, billing_interval, current_period_end, cancel_at_period_end)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      userQuery = userQuery.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, count: total, error } = await userQuery;

    if (error) {
      logger.error("[admin] users query error", { error: error.message });
      throw new Error(error.message);
    }

    type SubRow = {
      plan_key: string;
      status: string;
      provider: string;
      billing_interval: string | null;
      current_period_end: string | null;
      cancel_at_period_end: boolean;
    };

    const typedUsers = (users ?? []) as {
      id: string;
      email: string;
      full_name: string;
      avatar_url: string | null;
      education_level: string;
      created_at: string;
      preferences: Record<string, unknown> | null;
      subscriptions: SubRow | SubRow[] | null;
    }[];

    // Fetch session aggregates for the returned user IDs
    const userIds = typedUsers.map((u) => u.id);
    let sessionStats: Record<
      string,
      { session_count: number; total_tokens: number; total_cost: number; last_active: string | null }
    > = {};

    if (userIds.length > 0) {
      const { data: sessions } = await db
        .from("study_sessions")
        .select("user_id, total_tokens, ai_cost_usd, created_at")
        .in("user_id", userIds);

      const rows = (sessions ?? []) as {
        user_id: string;
        total_tokens: number | null;
        ai_cost_usd: number | null;
        created_at: string;
      }[];

      sessionStats = userIds.reduce(
        (acc, uid) => {
          const userRows = rows.filter((r) => r.user_id === uid);
          const sorted = [...userRows].sort((a, b) => b.created_at.localeCompare(a.created_at));
          acc[uid] = {
            session_count: userRows.length,
            total_tokens: userRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
            total_cost: userRows.reduce((s, r) => s + (r.ai_cost_usd ?? 0), 0),
            last_active: sorted[0]?.created_at ?? null,
          };
          return acc;
        },
        {} as typeof sessionStats
      );
    }

    const enriched = typedUsers.map((u) => {
      // Supabase returns the unique FK relation as an object or array — normalise to object | null
      const sub = Array.isArray(u.subscriptions) ? (u.subscriptions[0] ?? null) : u.subscriptions;
      return {
        ...u,
        subscriptions: undefined, // remove raw field
        preferences: undefined, // remove raw field
        has_rated_app: (u.preferences?.has_rated_app as boolean | undefined) ?? null,
        subscription: sub ?? { plan_key: "free", status: "free", provider: "none", billing_interval: null, current_period_end: null, cancel_at_period_end: false },
        ...(sessionStats[u.id] ?? {
          session_count: 0,
          total_tokens: 0,
          total_cost: 0,
          last_active: null,
        }),
      };
    });

    res.json({ users: enriched, total: total ?? 0, page, limit });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────

router.get(
  "/users/:id",
  requireAdminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getSupabaseAdmin();
      const { id } = req.params;

      const [{ data: user, error: userError }, { data: sessions, error: sessionsError }, { data: subData }] =
        await Promise.all([
          db
            .from("users")
            .select("id, email, full_name, avatar_url, education_level, language, created_at, updated_at, preferences")
            .eq("id", id)
            .single(),
          db
            .from("study_sessions")
            .select(
              "id, title, subject_id, topic_id, node_count, duration_seconds, prompt_tokens, completion_tokens, total_tokens, ai_cost_usd, created_at, bookmarked, image_url"
            )
            .eq("user_id", id)
            .order("created_at", { ascending: false }),
          db
            .from("subscriptions")
            .select("plan_key, status, provider, billing_interval, current_period_start, current_period_end, cancel_at_period_end, trial_end, granted_by, provider_subscription_id, updated_at")
            .eq("user_id", id)
            .maybeSingle(),
        ]);

      if (userError || !user) {
        res.status(404).json({ error: "User not found." });
        return;
      }

      if (sessionsError) {
        logger.error("[admin] user sessions query error", { error: sessionsError.message });
        throw new Error(sessionsError.message);
      }

      const rows = (sessions ?? []) as {
        total_tokens: number | null;
        ai_cost_usd: number | null;
        prompt_tokens: number | null;
        completion_tokens: number | null;
      }[];

      const stats = {
        session_count: rows.length,
        total_tokens: rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0),
        total_prompt_tokens: rows.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0),
        total_completion_tokens: rows.reduce((s, r) => s + (r.completion_tokens ?? 0), 0),
        total_cost: rows.reduce((s, r) => s + (r.ai_cost_usd ?? 0), 0),
      };

      const subscription = subData ?? { plan_key: "free", status: "free", provider: "none", billing_interval: null, current_period_start: null, current_period_end: null, cancel_at_period_end: false, trial_end: null, granted_by: "billing", provider_subscription_id: null, updated_at: null };

      const prefs = (user as { preferences?: Record<string, unknown> | null }).preferences;
      const enrichedUser = {
        ...user,
        preferences: undefined,
        has_rated_app: (prefs?.has_rated_app as boolean | undefined) ?? null,
      };
      res.json({ user: enrichedUser, subscription, sessions: sessions ?? [], stats });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/sessions ──────────────────────────────────────────────────

router.get(
  "/sessions",
  requireAdminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getSupabaseAdmin();
      const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10)));
      const search = ((req.query.search as string) ?? "").trim();
      const offset = (page - 1) * limit;

      let sessionQuery = db
        .from("study_sessions")
        .select(
          "id, user_id, title, subject_id, image_url, node_count, duration_seconds, prompt_tokens, completion_tokens, total_tokens, ai_cost_usd, created_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (search) {
        sessionQuery = sessionQuery.ilike("title", `%${search}%`);
      }

      const { data: sessions, count: total, error } = await sessionQuery;

      if (error) {
        logger.error("[admin] sessions query error", { error: error.message });
        throw new Error(error.message);
      }

      const typedSessions = (sessions ?? []) as {
        user_id: string;
        [key: string]: unknown;
      }[];

      // Enrich with user info
      const userIds = [...new Set(typedSessions.map((s) => s.user_id))];
      let userMap: Record<string, { email: string; full_name: string; avatar_url: string | null }> =
        {};

      if (userIds.length > 0) {
        const { data: users } = await db
          .from("users")
          .select("id, email, full_name, avatar_url")
          .in("id", userIds);

        const typedUsers = (users ?? []) as {
          id: string;
          email: string;
          full_name: string;
          avatar_url: string | null;
        }[];

        userMap = typedUsers.reduce(
          (acc, u) => {
            acc[u.id] = { email: u.email, full_name: u.full_name, avatar_url: u.avatar_url };
            return acc;
          },
          {} as typeof userMap
        );
      }

      const enriched = typedSessions.map((s) => ({
        ...s,
        user: userMap[s.user_id] ?? { email: "unknown", full_name: "Unknown", avatar_url: null },
      }));

      res.json({ sessions: enriched, total: total ?? 0, page, limit });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/sessions/:id ─────────────────────────────────────────────

router.get(
  "/sessions/:id",
  requireAdminAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getSupabaseAdmin();
      const { id } = req.params;

      const { data: session, error } = await db
        .from("study_sessions")
        .select(
          "id, user_id, title, subject_id, topic_id, problem, node_count, duration_seconds, image_url, bookmarked, breakdown_json, visual_table_json, prompt_tokens, completion_tokens, total_tokens, ai_cost_usd, created_at"
        )
        .eq("id", id)
        .single();

      if (error || !session) {
        res.status(404).json({ error: "Session not found." });
        return;
      }

      const typedSession = session as { user_id: string; [key: string]: unknown };

      const { data: user } = await db
        .from("users")
        .select("id, email, full_name, avatar_url")
        .eq("id", typedSession.user_id)
        .single();

      res.json({
        session: {
          ...typedSession,
          user: user ?? { id: typedSession.user_id, email: "unknown", full_name: "Unknown", avatar_url: null },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
