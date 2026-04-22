import type { Response } from "express";
import { logger } from "../utils/logger.js";

const clientsByTraceId = new Map<string, Response>();

export function registerProgressClient(traceId: string, res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  clientsByTraceId.set(traceId, res);
  logger.info(`[progress] Client registered for traceId: ${traceId}`);

  res.on("close", () => {
    clientsByTraceId.delete(traceId);
    logger.info(`[progress] Client disconnected for traceId: ${traceId}`);
  });
}

export function emitProgress(traceId: string, payload: { stage: string; progress: number; message?: string }) {
  const res = clientsByTraceId.get(traceId);
  if (!res) return;

  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    logger.debug(`[progress] Emitted for ${traceId}: ${payload.stage} (${payload.progress}%)`);
  } catch (err) {
    logger.error(`[progress] Failed to emit for ${traceId}`, err);
    clientsByTraceId.delete(traceId);
  }
}
