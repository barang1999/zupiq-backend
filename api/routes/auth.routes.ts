import { Router, Request, Response, NextFunction } from "express";
import { createUser, getUserByEmail, getUserById } from "../../services/user.service.js";
import {
  comparePassword,
  buildAuthTokens,
  verifyRefreshToken,
  toPublicUser,
} from "../../services/auth.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authRateLimit, loginRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ValidationError, UnauthorizedError } from "../middlewares/error.middleware.js";
import { firebaseAdmin } from "../../config/firebase.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import type { CreateUserDTO } from "../../models/user.model.js";
import { ensureSubscriptionSeed, getEffectiveAccessState } from "../../billing/subscription-service.js";

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

async function verifyGoogleIdTokenViaTokenInfo(idToken: string): Promise<VerifiedOAuthIdentity | null> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!response.ok) {
    return null;
  }

  const tokenInfo = (await response.json()) as Record<string, string>;
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
