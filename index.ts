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

// ─── Middlewares ──────────────────────────────────────────────────────────────
import { globalErrorHandler, notFoundHandler } from "./api/middlewares/error.middleware.js";
import { apiRateLimit } from "./api/middlewares/rateLimit.middleware.js";

// ─── App factory ──────────────────────────────────────────────────────────────

export async function createApp(): Promise<Express> {
  const app = express();

  // ─── Core middleware ──────────────────────────────────────────────────────

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

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

  app.use("/api", apiRateLimit);
  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/subjects", subjectsRoutes);
  app.use("/api/flashcards", flashcardsRoutes);
  app.use("/api/groups", groupsRoutes);
  app.use("/api/uploads", uploadsRoutes);
  app.use("/api/sessions", sessionsRoutes);

  // ─── Error handling (must come last) ─────────────────────────────────────

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  logger.info("Express app configured successfully.");
  return app;
}
