import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { env } from "../config/env.js";
import { PublicUser, User } from "../models/user.model.js";

const BCRYPT_ROUNDS = 12;

// ─── Password utilities ───────────────────────────────────────────────────────

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export async function comparePassword(
  plainPassword: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}

// ─── Token shapes ─────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  full_name: string;
  education_level: string;
  language: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  type: "refresh";
  iat?: number;
  exp?: number;
}

// ─── Token generation ─────────────────────────────────────────────────────────

export function signAccessToken(user: PublicUser): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    full_name: user.full_name,
    education_level: user.education_level,
    language: user.language,
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function signRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: "refresh" };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

// ─── Token verification ───────────────────────────────────────────────────────

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as RefreshTokenPayload;
  if (decoded.type !== "refresh") {
    throw new Error("Invalid token type");
  }
  return decoded;
}

// ─── Auth response builder ────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export function buildAuthTokens(user: PublicUser): AuthTokens {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user.id),
    expiresIn: env.JWT_EXPIRES_IN,
  };
}

/**
 * Strip password_hash from a User record to get a PublicUser.
 */
export function toPublicUser(user: User): PublicUser {
  const { password_hash, ...publicUser } = user;
  return publicUser;
}
