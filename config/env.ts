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
  GEMINI_PRO_MODEL: optionalEnv("GEMINI_PRO_MODEL", "gemini-2.5-flash"),
  WOLFRAM_APP_ID: optionalEnv("WOLFRAM_APP_ID", ""),

  // Mathpix — math-specialized OCR (~500ms, outputs LaTeX)
  // Get credentials at https://mathpix.com/ocr#pricing
  MATHPIX_APP_ID: optionalEnv("MATHPIX_APP_ID", ""),
  MATHPIX_APP_KEY: optionalEnv("MATHPIX_APP_KEY", ""),
  // Minimum confidence threshold (0-1) below which we fall back to Gemini vision
  MATHPIX_MIN_CONFIDENCE: parseFloat(optionalEnv("MATHPIX_MIN_CONFIDENCE", "0.85")),

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
  AUTH_RATE_LIMIT_WINDOW_MS: parseInt(optionalEnv("AUTH_RATE_LIMIT_WINDOW_MS", "900000"), 10),
  AUTH_RATE_LIMIT_MAX_REQUESTS: parseInt(optionalEnv("AUTH_RATE_LIMIT_MAX_REQUESTS", "60"), 10),

  // CORS — comma-separated list of allowed origins
  // e.g. CORS_ORIGIN=https://zupiq.ai,https://www.zupiq.ai
  CORS_ORIGIN: optionalEnv("CORS_ORIGIN", "http://localhost:5173,http://localhost:3000"),

  // Apple Sign-In
  APPLE_CLIENT_ID: optionalEnv("APPLE_CLIENT_ID", ""),

  // Resend (transactional email)
  RESEND_API_KEY: optionalEnv("RESEND_API_KEY", process.env.RESENT_API_KEY ?? ""),

  // App URL (used in email links)
  APP_URL: optionalEnv("APP_URL", "https://zupiq.ai"),

  // Stripe Billing
  STRIPE_SECRET_KEY: optionalEnv("STRIPE_SECRET_KEY", ""),
  STRIPE_WEBHOOK_SECRET: optionalEnv("STRIPE_WEBHOOK_SECRET", ""),
  STRIPE_PRODUCT_CORE: optionalEnv("STRIPE_PRODUCT_CORE", ""),
  STRIPE_PRICE_CORE_MONTHLY: optionalEnv("STRIPE_PRICE_CORE_MONTHLY", ""),
  STRIPE_PRICE_CORE_ANNUAL: optionalEnv("STRIPE_PRICE_CORE_ANNUAL", ""),
  STRIPE_PRODUCT_PRO: optionalEnv("STRIPE_PRODUCT_PRO", ""),
  STRIPE_PRICE_PRO_MONTHLY: optionalEnv("STRIPE_PRICE_PRO_MONTHLY", ""),
  STRIPE_PRICE_PRO_ANNUAL: optionalEnv("STRIPE_PRICE_PRO_ANNUAL", ""),
  STRIPE_CHECKOUT_SUCCESS_URL: optionalEnv("STRIPE_CHECKOUT_SUCCESS_URL", ""),
  STRIPE_CHECKOUT_CANCEL_URL: optionalEnv("STRIPE_CHECKOUT_CANCEL_URL", ""),
  STRIPE_BILLING_PORTAL_RETURN_URL: optionalEnv("STRIPE_BILLING_PORTAL_RETURN_URL", ""),

  // RevenueCat Billing
  REVENUECAT_WEBHOOK_SECRET: optionalEnv("REVENUECAT_WEBHOOK_SECRET", ""),
  REVENUECAT_WEBHOOK_AUTH_HEADER: optionalEnv("REVENUECAT_WEBHOOK_AUTH_HEADER", ""),
  REVENUECAT_SECRET_API_KEY: optionalEnv("REVENUECAT_SECRET_API_KEY", ""),
  REVENUECAT_IOS_PRODUCT_PRO_MONTHLY: optionalEnv(
    "REVENUECAT_IOS_PRODUCT_PRO_MONTHLY",
    "com.zupiq.mobile.premium.monthly"
  ),
  REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY: optionalEnv(
    "REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY",
    "zupiq.premium.monthly"
  ),

  // Review/test accounts
  TEST_PREMIUM_EMAIL: optionalEnv("TEST_PREMIUM_EMAIL", ""),
  TEST_PREMIUM_PASSWORD: optionalEnv("TEST_PREMIUM_PASSWORD", ""),
  TEST_PREMIUM_FULL_NAME: optionalEnv("TEST_PREMIUM_FULL_NAME", "Jenny"),

  // VIP users — comma-separated list of email addresses that automatically
  // receive pro access without going through the payment flow.
  // Example: VIP_EMAILS=alice@example.com,bob@example.com
  VIP_EMAILS: optionalEnv("VIP_EMAILS", ""),
} as const;

export type Env = typeof env;
