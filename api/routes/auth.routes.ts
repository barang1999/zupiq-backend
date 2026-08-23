import { Router, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import https from "node:https";
import { lookup } from "node:dns";
import appleSignin from "apple-signin-auth";
import { createUser, getUserByEmail, getUserById } from "../../services/user.service.js";
import {
  comparePassword,
  hashPassword,
  buildAuthTokens,
  verifyRefreshToken,
  toPublicUser,
} from "../../services/auth.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authRateLimit, loginRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ValidationError, UnauthorizedError, AppError } from "../middlewares/error.middleware.js";
import { firebaseAdmin } from "../../config/firebase.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import type { CreateUserDTO } from "../../models/user.model.js";
import { ensureSubscriptionSeed, getEffectiveAccessState } from "../../billing/subscription-service.js";
import { sendWelcomeEmail, sendPasswordResetEmail } from "../../services/email.service.js";

const router = Router();

interface VerifiedOAuthIdentity {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

function normalizeAudienceConfig(): string[] {
  const candidates = [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_ID,
  ];

  return candidates
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause ? `${err.message}; cause=${formatUnknownError(cause)}` : err.message;
  }
  return String(err);
}

function getJsonViaHttpsIpv4(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number; data: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { ...options, family: 4 }, callback);
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data: Record<string, string> = {};
          try {
            data = raw ? (JSON.parse(raw) as Record<string, string>) : {};
          } catch {
            reject(new Error(`Google tokeninfo returned invalid JSON with status ${res.statusCode ?? 0}`));
            return;
          }

          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            data,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Google tokeninfo request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
  });
}

async function verifyGoogleIdTokenViaTokenInfo(idToken: string): Promise<VerifiedOAuthIdentity | null> {
  const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  let ok = false;
  let tokenInfo: Record<string, string> = {};

  try {
    const response = await fetch(tokenInfoUrl, {
      signal: AbortSignal.timeout(10000),
    });

    ok = response.ok;
    if (ok) {
      tokenInfo = (await response.json()) as Record<string, string>;
    }
  } catch (err) {
    logger.warn("[auth:google] tokeninfo fetch failed; retrying via IPv4 HTTPS", {
      error: formatUnknownError(err),
    });
  }

  if (!ok) {
    try {
      const fallback = await getJsonViaHttpsIpv4(tokenInfoUrl);
      ok = fallback.ok;
      tokenInfo = fallback.data;
      if (!ok) {
        logger.warn("[auth:google] tokeninfo rejected token", {
          status: fallback.status,
          error: tokenInfo.error,
          errorDescription: tokenInfo.error_description,
        });
      }
    } catch (err) {
      logger.error("[auth:google] tokeninfo IPv4 HTTPS fallback failed", {
        error: formatUnknownError(err),
      });
      throw new AppError("Google sign-in verification is temporarily unavailable. Please try again.", 503);
    }
  }

  if (!ok) return null;

  const sub = tokenInfo.sub;
  const email = tokenInfo.email;
  const emailVerified = tokenInfo.email_verified;
  const aud = tokenInfo.aud;
  const name = tokenInfo.name ?? null;
  const picture = tokenInfo.picture ?? null;

  if (!sub || !email) {
    return null;
  }
  if (emailVerified !== "true") {
    throw new UnauthorizedError("Google account email is not verified");
  }

  const allowedAudiences = normalizeAudienceConfig();
  if (allowedAudiences.length > 0 && aud && !allowedAudiences.includes(aud)) {
    throw new UnauthorizedError("Invalid Google token audience");
  }

  return {
    uid: sub,
    email: email.toLowerCase(),
    name,
    picture,
  };
}

async function verifyOAuthIdentity(idToken: string): Promise<VerifiedOAuthIdentity> {
  // Preferred path: Firebase ID token (already issued by Firebase Auth).
  try {
    const decoded = await firebaseAdmin.verifyIdToken(idToken);
    if (!decoded.email) {
      throw new ValidationError("Google account has no email");
    }
    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      name: decoded.name ?? null,
      picture: decoded.picture ?? null,
    };
  } catch {
    // Fallback path: raw Google ID token from Google Sign-In SDK.
  }

  const googleIdentity = await verifyGoogleIdTokenViaTokenInfo(idToken);
  if (!googleIdentity) {
    throw new UnauthorizedError("Invalid Google sign-in token");
  }
  return googleIdentity;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post(
  "/register",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, full_name, education_level, grade, language } =
        req.body as CreateUserDTO;

      if (!email || !password || !full_name) {
        throw new ValidationError("email, password, and full_name are required");
      }
      if (password.length < 8) {
        throw new ValidationError("Password must be at least 8 characters");
      }

      const user = await createUser({
        email,
        password,
        full_name,
        education_level,
        grade,
        language,
      });

      await ensureSubscriptionSeed(user.id);
      const billing = await getEffectiveAccessState(user.id);
      const tokens = buildAuthTokens(user);

      // Fire-and-forget — don't block registration if email fails
      sendWelcomeEmail(user.email, user.full_name).catch((err) =>
        console.error("[auth] welcome email failed:", err)
      );

      res.status(201).json({ user, billing, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post(
  "/login",
  loginRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new ValidationError("email and password are required");
      }

      const user = await getUserByEmail(email);
      if (!user) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const isValid = await comparePassword(password, user.password_hash);
      if (!isValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const publicUser = toPublicUser(user);
      await ensureSubscriptionSeed(publicUser.id);
      const billing = await getEffectiveAccessState(publicUser.id);
      const tokens = buildAuthTokens(publicUser);

      res.json({ user: publicUser, billing, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/refresh ──────────────────────────────────────────────────

router.post(
  "/refresh",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) throw new ValidationError("refreshToken is required");

      const payload = verifyRefreshToken(refreshToken);
      const user = await getUserById(payload.sub);
      if (!user) throw new UnauthorizedError("User not found");

      await ensureSubscriptionSeed(user.id);
      const billing = await getEffectiveAccessState(user.id);
      const tokens = buildAuthTokens(user);
      res.json({ user, billing, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
// Stateless JWTs: logout is client-side (delete token).
// This endpoint exists for completeness / future token blacklist support.

router.post(
  "/logout",
  requireAuth,
  async (_req: Request, res: Response) => {
    res.json({ message: "Logged out successfully" });
  }
);

// ─── POST /api/auth/google ───────────────────────────────────────────────────

router.post(
  "/google",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { idToken } = req.body;
      if (!idToken) throw new ValidationError("idToken is required");

      const { uid, email, name, picture } = await verifyOAuthIdentity(idToken);

      const db = getSupabaseAdmin();

      // Check if user already exists by email
      let { data: existingUser } = await db
        .from("users")
        .select("*")
        .eq("email", email)
        .single();

      if (!existingUser) {
        // Create new user — password hash placeholder for OAuth-only account.
        const id = generateId();
        const { data: newUser, error } = await db
          .from("users")
          .insert({
            id,
            email,
            password_hash: `oauth_google:${uid}`,
            full_name: name ?? email.split("@")[0],
            avatar_url: picture ?? null,
            education_level: "high_school",
            language: "en",
            preferences: {},
            created_at: nowISO(),
            updated_at: nowISO(),
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        existingUser = newUser;
      }

      const { password_hash, ...publicUser } = existingUser as any;
      await ensureSubscriptionSeed(publicUser.id);
      const billing = await getEffectiveAccessState(publicUser.id);
      const tokens = buildAuthTokens(publicUser);

      res.json({ user: publicUser, billing, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/apple ────────────────────────────────────────────────────

router.post(
  "/apple",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { identityToken, email, givenName, familyName } = req.body;
      if (!identityToken) throw new ValidationError("identityToken is required");

      // Verify identity token with Apple (10s timeout — the JWKS fetch can hang)
      const applePayload = await Promise.race([
        appleSignin.verifyIdToken(identityToken, {
          audience: env.APPLE_CLIENT_ID,
          ignoreExpiration: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AppError("Apple verification timed out. Please try again.", 504)), 10000)
        ),
      ]);

      const sub = applePayload.sub; // stable Apple user ID
      if (!sub) throw new UnauthorizedError("Invalid Apple identity token");

      const db = getSupabaseAdmin();

      // 1. Look for existing user by Apple sub
      let { data: existingUser } = await db
        .from("users")
        .select("*")
        .eq("password_hash", `oauth_apple:${sub}`)
        .single();

      // 2. If not found, try matching by email (links Apple to existing account)
      if (!existingUser && email) {
        const { data: emailUser } = await db
          .from("users")
          .select("*")
          .eq("email", email.toLowerCase())
          .single();

        if (emailUser) {
          // Link Apple to the existing account by updating the password_hash only
          // if the account has no real password (i.e. is already an OAuth account)
          existingUser = emailUser;
        }
      }

      // 3. Create new user if still not found
      if (!existingUser) {
        const appleEmail = email?.toLowerCase() ?? `apple_${sub}@privaterelay.appleid.com`;
        const fullName = [givenName, familyName].filter(Boolean).join(" ") || appleEmail.split("@")[0];

        const id = generateId();
        const { data: newUser, error } = await db
          .from("users")
          .insert({
            id,
            email: appleEmail,
            password_hash: `oauth_apple:${sub}`,
            full_name: fullName,
            avatar_url: null,
            education_level: "high_school",
            language: "en",
            preferences: {},
            created_at: nowISO(),
            updated_at: nowISO(),
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        existingUser = newUser;

        // Send welcome email for new Apple sign-ups
        const { password_hash: _, ...newPublicUser } = existingUser as any;
        sendWelcomeEmail(newPublicUser.email, newPublicUser.full_name).catch((err) =>
          console.error("[auth] apple welcome email failed:", err)
        );
      }

      const { password_hash, ...publicUser } = existingUser as any;
      await ensureSubscriptionSeed(publicUser.id);
      const billing = await getEffectiveAccessState(publicUser.id);
      const tokens = buildAuthTokens(publicUser);

      res.json({ user: publicUser, billing, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
// Always responds 200 so we don't leak whether an email exists.

router.post(
  "/forgot-password",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      if (!email) throw new ValidationError("email is required");

      const db = getSupabaseAdmin();
      const user = await getUserByEmail(email);

      if (user) {
        // Delete any existing code for this user
        await db.from("password_reset_tokens").delete().eq("user_id", user.id);

        // 6-digit numeric code
        const code = (parseInt(randomBytes(3).toString("hex"), 16) % 900000 + 100000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        const { error } = await db.from("password_reset_tokens").insert({
          user_id: user.id,
          token: code,
          expires_at: expiresAt,
        });

        if (error) throw new AppError("Failed to create reset code", 500);

        await sendPasswordResetEmail(user.email, user.full_name, code);
      }

      res.json({ message: "If that email exists, a reset code has been sent." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/verify-reset-code ───────────────────────────────────────
// Validates a reset code without consuming it, so the user gets instant
// feedback on step 2 before being shown the new-password screen.

router.post(
  "/verify-reset-code",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) throw new ValidationError("email and code are required");

      const db = getSupabaseAdmin();
      const user = await getUserByEmail(email);
      if (!user) throw new UnauthorizedError("Invalid or expired code");

      const { data: record, error } = await db
        .from("password_reset_tokens")
        .select("expires_at")
        .eq("user_id", user.id)
        .eq("token", code)
        .single();

      if (error || !record) throw new UnauthorizedError("Invalid or expired code");

      if (new Date(record.expires_at) < new Date()) {
        await db.from("password_reset_tokens").delete().eq("token", code);
        throw new UnauthorizedError("Code has expired. Please request a new one.");
      }

      res.json({ valid: true });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/reset-password ──────────────────────────────────────────

router.post(
  "/reset-password",
  authRateLimit,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code, password } = req.body;
      if (!email || !code || !password) throw new ValidationError("email, code, and password are required");
      if (password.length < 8) throw new ValidationError("Password must be at least 8 characters");

      const db = getSupabaseAdmin();

      const user = await getUserByEmail(email);
      if (!user) throw new UnauthorizedError("Invalid or expired code");

      const { data: record, error: fetchError } = await db
        .from("password_reset_tokens")
        .select("*")
        .eq("user_id", user.id)
        .eq("token", code)
        .single();

      if (fetchError || !record) {
        throw new UnauthorizedError("Invalid or expired code");
      }

      if (new Date(record.expires_at) < new Date()) {
        await db.from("password_reset_tokens").delete().eq("token", code);
        throw new UnauthorizedError("Code has expired. Please request a new one.");
      }

      const passwordHash = await hashPassword(password);

      const { error: updateError } = await db
        .from("users")
        .update({ password_hash: passwordHash, updated_at: nowISO() })
        .eq("id", record.user_id);

      if (updateError) throw new AppError("Failed to update password", 500);

      // Consume the code
      await db.from("password_reset_tokens").delete().eq("token", code);

      res.json({ message: "Password updated successfully." });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/me ────────────────────────────────────────────────────────

router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getUserById(req.user!.sub);
      if (!user) throw new UnauthorizedError("User not found");
      await ensureSubscriptionSeed(user.id);
      const billing = await getEffectiveAccessState(user.id);
      res.json({ user, billing });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
