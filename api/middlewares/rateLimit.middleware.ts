import { Request, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

// ─── In-memory rate limiter ───────────────────────────────────────────────────
// For production, replace with redis-backed rate limiter (e.g., rate-limiter-flexible).

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitRecord>();

function getClientKey(req: Request): string {
  // Prefer X-Forwarded-For for clients behind proxies
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  return ip.trim();
}

function cleanup(): void {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.resetAt < now) {
      store.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

// ─── Factory ──────────────────────────────────────────────────────────────────

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}

export function createRateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? env.RATE_LIMIT_MAX_REQUESTS;
  const message = options.message ?? "Too many requests. Please try again later.";

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = getClientKey(req);
    const now = Date.now();
    const record = store.get(key);

    if (!record || record.resetAt < now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", maxRequests - 1);
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

    next();
  };
}

// ─── Pre-configured limiters ──────────────────────────────────────────────────

/** Standard API rate limit */
export const apiRateLimit = createRateLimit();

/** Stricter limit for auth endpoints (prevent brute force) */
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: env.NODE_ENV === "development" ? 100 : 10,
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});

/** Stricter limit for AI endpoints (expensive calls) */
export const aiRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: env.NODE_ENV === "development" ? 200 : 20,
  message: "AI request limit reached. Please wait a moment.",
});
