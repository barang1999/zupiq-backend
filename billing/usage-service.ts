import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import type { UsageSnapshot } from "./types.js";

interface DailyUsageRow {
  id: string;
  user_id: string;
  feature_key: string;
  usage_date: string;
  used_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export const DAILY_DEEP_DIVE_USAGE_FEATURE_KEY = "daily_deep_dive";

function isMissingUsageTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  const message = (maybe.message ?? "").toLowerCase();
  return maybe.code === "42P01" || message.includes("feature_usage_daily") || message.includes("does not exist");
}

function utcDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function getDailyUsageRow(
  userId: string,
  featureKey: string,
  usageDate: string
): Promise<DailyUsageRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("feature_usage_daily")
    .select("*")
    .eq("user_id", userId)
    .eq("feature_key", featureKey)
    .eq("usage_date", usageDate)
    .limit(1);

  if (error) {
    if (isMissingUsageTableError(error)) {
      logger.warn("feature_usage_daily table is missing. Usage enforcement is temporarily bypassed.");
      return null;
    }
    throw new Error(error.message);
  }

  return (data?.[0] as DailyUsageRow | undefined) ?? null;
}

export async function getTodayUsageCount(userId: string, featureKey: string): Promise<number> {
  const row = await getDailyUsageRow(userId, featureKey, utcDateKey());
  return row?.used_count ?? 0;
}

export async function incrementTodayUsage(
  userId: string,
  featureKey: string,
  amount = 1
): Promise<number> {
  const usageDate = utcDateKey();
  const db = getSupabaseAdmin();
  const current = await getDailyUsageRow(userId, featureKey, usageDate);

  if (!current) {
    const { error } = await db.from("feature_usage_daily").insert({
      id: generateId(),
      user_id: userId,
      feature_key: featureKey,
      usage_date: usageDate,
      used_count: Math.max(0, amount),
      metadata: {},
      created_at: nowISO(),
      updated_at: nowISO(),
    });

    if (error) {
      if (isMissingUsageTableError(error)) return Math.max(0, amount);
      throw new Error(error.message);
    }
    return Math.max(0, amount);
  }

  const nextCount = Math.max(0, current.used_count + amount);
  const { error } = await db
    .from("feature_usage_daily")
    .update({
      used_count: nextCount,
      updated_at: nowISO(),
    })
    .eq("id", current.id);

  if (error) {
    if (isMissingUsageTableError(error)) return nextCount;
    throw new Error(error.message);
  }

  return nextCount;
}

export async function getTodayUsageSnapshot(
  userId: string,
  featureKey: string,
  limit: number | null
): Promise<UsageSnapshot> {
  const used = await getTodayUsageCount(userId, featureKey);
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return {
    featureKey,
    used,
    limit,
    remaining,
  };
}
