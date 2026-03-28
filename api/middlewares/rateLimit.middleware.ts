import { Request, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

// ─── In-memory rate limiter ───────────────────────────────────────────────────
// For production, replace with redis-backed rate limiter (e.g., rate-limiter-flexible).

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

function getClientKey(req: Request): string {
  // Prefer X-Forwarded-For for clients behind proxies
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  return ip.trim();
}

// ─── Factory ──────────────────────────────────────────────────────────────────

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  scopeByPath?: boolean;
}

export function createRateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const message = options.message ?? "Too many requests. Please try again later.";
  const skipSuccessfulRequests = options.skipSuccessfulRequests ?? false;
  const scopeByPath = options.scopeByPath ?? false;

  // Each limiter instance gets its own store so endpoints don't share counters
  const instanceStore = new Map<string, RateLimitRecord>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of instanceStore.entries()) {
      if (record.resetAt < now) instanceStore.delete(key);
    }
  }, 5 * 60 * 1000);

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (env.NODE_ENV === "development") {
      next();
      return;
    }

    const clientKey = getClientKey(req);
    const normalizedPath = `${req.baseUrl}${req.path}`
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, "/:id")
      .replace(/\/\d+(?=\/|$)/g, "/:id");
    const key = scopeByPath ? `${clientKey}:${normalizedPath}` : clientKey;
    const now = Date.now();
    const record = instanceStore.get(key);

    if (!record || record.resetAt < now) {
      instanceStore.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", maxRequests - 1);

      if (skipSuccessfulRequests) {
        res.on("finish", () => {
          if (res.statusCode < 400) {
            const r = instanceStore.get(key);
            if (r) r.count = Math.max(0, r.count - 1);
          }
        });
      }

      return next();
    }

    record.count += 1;
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

    if (record.count > maxRequests) {
      logger.warn(`Rate limit exceeded for ${key}`);
      res.status(429).json({ error: message });
      return;
    }

    if (skipSuccessfulRequests) {
      res.on("finish", () => {
        if (res.statusCode < 400) {
          const r = instanceStore.get(key);
          if (r) r.count = Math.max(0, r.count - 1);
        }
      });
    }

    next();
  };
}

// ─── Pre-configured limiters ──────────────────────────────────────────────────

/** Standard API rate limit */
export const apiRateLimit = createRateLimit({ scopeByPath: true });

/** Stricter limit for register/google auth endpoints */
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: env.NODE_ENV === "development" ? 100 : 10,
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});

/**
 * Login-specific rate limit: only failed attempts count.
 * Successful logins do not consume the quota, so signing out
 * and back in never triggers the lockout.
 */
export const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: env.NODE_ENV === "development" ? 100 : 10,
  message: "Too many failed login attempts. Please try again in 15 minutes.",
  skipSuccessfulRequests: true,
});

/** Stricter limit for AI endpoints (expensive calls) */
export const aiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: env.NODE_ENV === "development" ? 200 : 20,
  message: "AI request limit reached. Please wait a moment.",
});
