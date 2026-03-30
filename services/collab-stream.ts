import type { Response } from "express";
import { logger } from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CollabEventType =
  | "connected"
  | "session_updated"
  | "member_joined"
  | "member_left";

export interface CollabEvent {
  type: CollabEventType;
  sessionId: string;
  payload: unknown;
  timestamp: string;
}

// ─── In-memory client registry ────────────────────────────────────────────────
// Keyed by sessionId so all members of a session share one broadcast channel.

const clientsBySession = new Map<string, Set<Response>>();
const heartbeatTimers = new WeakMap<Response, ReturnType<typeof setInterval>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeEvent(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function setupCollabStreamHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function registerCollabStreamClient(sessionId: string, res: Response): () => void {
  let clients = clientsBySession.get(sessionId);
  if (!clients) {
    clients = new Set<Response>();
    clientsBySession.set(sessionId, clients);
  }
  clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      // cleanup handled by close/error listeners
    }
  }, 25_000);
  heartbeatTimers.set(res, heartbeat);

  const cleanup = () => {
    const timer = heartbeatTimers.get(res);
    if (timer) {
      clearInterval(timer);
      heartbeatTimers.delete(res);
    }
    const set = clientsBySession.get(sessionId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clientsBySession.delete(sessionId);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
  return cleanup;
}

export function publishCollabEvent(
  sessionId: string,
  type: CollabEventType,
  payload: unknown
): void {
  const clients = clientsBySession.get(sessionId);
  if (!clients || clients.size === 0) return;

  const event: CollabEvent = {
    type,
    sessionId,
    payload,
    timestamp: new Date().toISOString(),
  };

  for (const client of [...clients]) {
    try {
      writeEvent(client, type, event);
    } catch (err) {
      logger.warn("[collab-stream] failed to write event", {
        sessionId,
        type,
        error: err instanceof Error ? err.message : String(err),
      });
      const timer = heartbeatTimers.get(client);
      if (timer) {
        clearInterval(timer);
        heartbeatTimers.delete(client);
      }
      clients.delete(client);
    }
  }

  if (clients.size === 0) {
    clientsBySession.delete(sessionId);
  }
}
