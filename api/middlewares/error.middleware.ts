import { Request, Response, NextFunction } from "express";
import { logger } from "../../utils/logger.js";

// ─── Custom application error ─────────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

// ─── 404 handler (must be registered after all routes) ───────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

// ─── Global error handler ─────────────────────────────────────────────────────

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Multer file size / type errors
  if (err && typeof err === "object" && (err as any).code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "File too large" });
    return;
  }

  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(`Non-operational error on ${req.method} ${req.path}:`, err.message);
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Unknown / unexpected errors
  const message = err instanceof Error ? err.message : "An unexpected error occurred";
  logger.error(`Unhandled error on ${req.method} ${req.path}:`, message);

  res.status(500).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : message,
  });
}
