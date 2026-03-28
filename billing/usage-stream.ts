import type { Response } from "express";
import { logger } from "../utils/logger.js";

export interface UsageStreamPayload {
  featureKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  consumedTokens?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  source?: string;
  updatedAt: string;
}

const usageStreamClientsByUser = new Map<string, Set<Response>>();
const heartbeatTimers = new WeakMap<Response, ReturnType<typeof setInterval>>();

function writeEvent(res: Response, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function setupUsageStreamHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function registerUsageStreamClient(userId: string, res: Response): () => void {
  let clients = usageStreamClientsByUser.get(userId);
  if (!clients) {
    clients = new Set<Response>();
    usageStreamClientsByUser.set(userId, clients);
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

    const set = usageStreamClientsByUser.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) usageStreamClientsByUser.delete(userId);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
  return cleanup;
}

export function sendUsageSnapshot(res: Response, payload: UsageStreamPayload): void {
  writeEvent(res, "usage", payload);
}

export function publishUsageUpdate(userId: string, payload: UsageStreamPayload): void {
  const clients = usageStreamClientsByUser.get(userId);
  if (!clients || clients.size === 0) return;

  for (const client of clients) {
    try {
      writeEvent(client, "usage", payload);
    } catch (err) {
      logger.warn("[usage-stream] failed to publish usage event", {
        userId,
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
    usageStreamClientsByUser.delete(userId);
  }
}

