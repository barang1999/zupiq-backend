import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./index.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = await createApp();

  // Optional: serve pre-built frontend in production when running as a single server.
  // Set SERVE_STATIC=true in your backend .env to enable this.
  if (env.NODE_ENV === "production" && process.env.SERVE_STATIC === "true") {
    const { default: express } = await import("express");
    const distPath = path.join(__dirname, "..", "web", "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    logger.info(`Serving static frontend from ${distPath}`);
  }

  app.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`Backend API running on http://localhost:${env.PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
