import { Router, Request, Response, NextFunction } from "express";
import { createUser, getUserByEmail, getUserById } from "../../services/user.service.js";
import {
  comparePassword,
  buildAuthTokens,
  verifyRefreshToken,
  toPublicUser,
} from "../../services/auth.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { authRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ValidationError, UnauthorizedError } from "../middlewares/error.middleware.js";
import { firebaseAdmin } from "../../config/firebase.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { generateId, nowISO } from "../../utils/helpers.js";
import type { CreateUserDTO } from "../../models/user.model.js";

const router = Router();

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

      const tokens = buildAuthTokens(user);

      res.status(201).json({ user, ...tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ────────────────────────────────────────────────────

router.post(
  "/login",
  authRateLimit,
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
      const tokens = buildAuthTokens(publicUser);

      res.json({ user: publicUser, ...tokens });
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

      const tokens = buildAuthTokens(user);
      res.json({ user, ...tokens });
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
      console.log("[auth/google] received idToken:", idToken ? "present ✓" : "MISSING");
      if (!idToken) throw new ValidationError("idToken is required");

      // Verify the Firebase ID token
      console.log("[auth/google] verifying Firebase token...");
      const decoded = await firebaseAdmin.verifyIdToken(idToken);
      const { uid, email, name, picture } = decoded;
      console.log("[auth/google] verified uid:", uid, "email:", email);

      if (!email) throw new ValidationError("Google account has no email");

      const db = getSupabaseAdmin();

      // Check if user already exists (by email or firebase_uid)
      let { data: existingUser } = await db
        .from("users")
        .select("*")
        .eq("email", email.toLowerCase())
        .single();

      if (!existingUser) {
        // Create new user — no password needed for OAuth users
        const id = generateId();
        const { data: newUser, error } = await db
          .from("users")
          .insert({
            id,
            email: email.toLowerCase(),
            password_hash: `firebase:${uid}`, // placeholder — can never be used to login with password
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
      const tokens = buildAuthTokens(publicUser);

      res.json({ user: publicUser, ...tokens });
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
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
