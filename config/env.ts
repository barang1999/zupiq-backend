import dotenv from "dotenv";
import path from "path";

// Auto-load the right env file based on NODE_ENV:
//   development → .env.development
//   production  → .env.production
//   fallback    → .env
// Uses process.cwd() so it resolves correctly whether running via tsx (src/)
// or via node (dist/) — both are started from the project root.
const nodeEnv = process.env.NODE_ENV ?? "development";
const envPath = path.resolve(process.cwd(), `.env.${nodeEnv}`);
const fallbackPath = path.resolve(process.cwd(), ".env");

// Try environment-specific file first, fall back to .env
dotenv.config({ path: envPath });
dotenv.config({ path: fallbackPath });

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV: optionalEnv("NODE_ENV", "development"),
  PORT: parseInt(optionalEnv("PORT", "3000"), 10),

  // JWT
  JWT_SECRET: requireEnv("JWT_SECRET", "dev-jwt-secret-change-in-production"),
  JWT_EXPIRES_IN: optionalEnv("JWT_EXPIRES_IN", "7d"),
  JWT_REFRESH_EXPIRES_IN: optionalEnv("JWT_REFRESH_EXPIRES_IN", "30d"),

  // Supabase
  SUPABASE_URL: requireEnv("SUPABASE_URL", "https://placeholder.supabase.co"),
  SUPABASE_ANON_KEY: requireEnv("SUPABASE_ANON_KEY", "placeholder-key"),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnv("SUPABASE_SERVICE_ROLE_KEY", ""),

  // Google Gemini AI
  GEMINI_API_KEY: requireEnv("GEMINI_API_KEY", ""),
  GEMINI_MODEL: optionalEnv("GEMINI_MODEL", "gemini-2.5-flash"),

  // Firebase Admin (for Google login verification)
  FIREBASE_PROJECT_ID: requireEnv("FIREBASE_PROJECT_ID", ""),
  FIREBASE_CLIENT_EMAIL: requireEnv("FIREBASE_CLIENT_EMAIL", ""),
  FIREBASE_PRIVATE_KEY: requireEnv("FIREBASE_PRIVATE_KEY", ""),

  // File uploads
  UPLOAD_DIR: optionalEnv("UPLOAD_DIR", "./uploads"),
  UPLOAD_MAX_SIZE_MB: parseInt(optionalEnv("UPLOAD_MAX_SIZE_MB", "10"), 10),
  ALLOWED_FILE_TYPES: optionalEnv(
    "ALLOWED_FILE_TYPES",
    "image/jpeg,image/png,image/webp,application/pdf,text/plain"
  ).split(","),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: parseInt(optionalEnv("RATE_LIMIT_WINDOW_MS", "900000"), 10),
  RATE_LIMIT_MAX_REQUESTS: parseInt(optionalEnv("RATE_LIMIT_MAX_REQUESTS", "100"), 10),

  // CORS — comma-separated list of allowed origins
  // e.g. CORS_ORIGIN=https://zupiq.ai,https://www.zupiq.ai
  CORS_ORIGIN: optionalEnv("CORS_ORIGIN", "http://localhost:5173,http://localhost:3000"),
} as const;

export type Env = typeof env;
