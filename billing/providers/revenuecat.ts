import type { ProviderPlanMapping } from "../types.js";

export function listRevenueCatPlanMappings(): ProviderPlanMapping[] {
  return [];
}

export function normalizeRevenueCatStatus(rawStatus: string): string {
  const status = rawStatus.toLowerCase().trim();
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "expired") return "expired";
  if (status === "canceled") return "canceled";
  if (status === "paused") return "paused";
  if (status === "past_due") return "past_due";
  return "incomplete";
}
