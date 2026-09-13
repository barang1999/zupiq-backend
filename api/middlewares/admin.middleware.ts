import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

/**
 * Middleware: require a valid admin JWT Bearer token.
 * Uses ADMIN_JWT_SECRET — completely separate from the user JWT_SECRET.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Admin token required." });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as { role?: string };
    if (payload?.role !== "admin") {
      res.status(401).json({ error: "Not an admin token." });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token." });
  }
}
