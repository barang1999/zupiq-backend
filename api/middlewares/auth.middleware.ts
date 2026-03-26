import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenPayload } from "../../services/auth.service.js";
import { logger } from "../../utils/logger.js";

// Extend Express Request to carry decoded JWT payload
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

/**
 * Middleware: require a valid JWT Bearer token.
 * Attaches the decoded user payload to req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid token";
    logger.warn("Auth middleware rejected token:", message);
    res.status(401).json({ error: "Unauthorized: " + message });
  }
}

/**
 * Middleware: attach user to request if a valid token is present,
 * but do not block the request if no token is provided.
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
  } catch {
    // Token invalid — ignore silently for optional routes
  }

  next();
}
