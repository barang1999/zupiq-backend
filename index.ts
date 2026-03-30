import express, { Express } from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

// ─── Routes ───────────────────────────────────────────────────────────────────
import authRoutes from "./api/routes/auth.routes.js";
import usersRoutes from "./api/routes/users.routes.js";
import aiRoutes from "./api/routes/ai.routes.js";
import subjectsRoutes from "./api/routes/subjects.routes.js";
import flashcardsRoutes from "./api/routes/flashcards.routes.js";
import groupsRoutes from "./api/routes/groups.routes.js";
import uploadsRoutes from "./api/routes/uploads.routes.js";
import sessionsRoutes from "./api/routes/sessions.routes.js";
import collaborationRoutes from "./api/routes/collaboration.routes.js";
import billingRoutes from "./api/routes/billing.routes.js";
import quizzesRoutes from "./api/routes/quizzes.routes.js";
import quizAttemptsRoutes from "./api/routes/quizAttempts.routes.js";

// ─── Middlewares ──────────────────────────────────────────────────────────────
import { globalErrorHandler, notFoundHandler } from "./api/middlewares/error.middleware.js";
import { apiRateLimit } from "./api/middlewares/rateLimit.middleware.js";

// ─── App factory ──────────────────────────────────────────────────────────────

export async function createApp(): Promise<Express> {
  const app = express();

  // ─── Core middleware ──────────────────────────────────────────────────────

  // Support comma-separated origins: "https://zupiq.ai,https://www.zupiq.ai"
  const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-attach-trace-id"],
    })
  );

  // Allow Firebase's signInWithPopup to communicate with the opener window.
  // Without this, COOP: same-origin (often set by hosting platforms) blocks
  // the popup's window.closed check and the Google auth flow fails silently.
  app.use((_req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    next();
  });

  // Stripe webhook requires raw request body for signature verification.
  app.use("/api/billing/webhook/stripe", express.raw({ type: "application/json" }));

  const jsonParser = express.json({ limit: "10mb" });
  const urlEncodedParser = express.urlencoded({ extended: true, limit: "10mb" });
  app.use((req, res, next) => {
    if (req.path === "/api/billing/webhook/stripe") return next();
    return jsonParser(req, res, next);
  });
  app.use((req, res, next) => {
    if (req.path === "/api/billing/webhook/stripe") return next();
    return urlEncodedParser(req, res, next);
  });

  // Serve uploaded files statically
  app.use("/uploads", express.static("uploads"));

  // ─── Health check ─────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      env: env.NODE_ENV,
    });
  });

  // ─── API Routes ───────────────────────────────────────────────────────────

  if (env.NODE_ENV !== "development") {
    app.use("/api", apiRateLimit);
  } else {
    logger.info("Global /api rate limiter disabled in development mode.");
  }
  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/subjects", subjectsRoutes);
  app.use("/api/flashcards", flashcardsRoutes);
  app.use("/api/groups", groupsRoutes);
  app.use("/api/uploads", uploadsRoutes);
  app.use("/api/sessions", sessionsRoutes);
  app.use("/api", collaborationRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/quizzes", quizzesRoutes);
  app.use("/api/quiz-attempts", quizAttemptsRoutes);

  // ─── Error handling (must come last) ─────────────────────────────────────

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  logger.info("Express app configured successfully.");
  return app;
}
