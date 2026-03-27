import { PLAN_CATALOG } from "./catalog.js";
import type {
  EntitlementValue,
  Entitlements,
  NormalizedSubscription,
  PlanKey,
  SubscriptionStatus,
} from "./types.js";

const PAID_ACCESS_STATUSES: SubscriptionStatus[] = ["active", "trialing", "past_due"];

function hasPaidAccessWindow(subscription: NormalizedSubscription, now = new Date()): boolean {
  if (subscription.planKey === "free") return true;

  if (PAID_ACCESS_STATUSES.includes(subscription.status)) return true;

  if (subscription.status === "canceled" && subscription.currentPeriodEnd) {
    return new Date(subscription.currentPeriodEnd).getTime() > now.getTime();
  }

  return false;
}

export function resolveEffectivePlanKey(subscription: NormalizedSubscription): PlanKey {
  return hasPaidAccessWindow(subscription) ? subscription.planKey : "free";
}

export function resolveEntitlements(subscription: NormalizedSubscription): Entitlements {
  const planKey = resolveEffectivePlanKey(subscription);
  return PLAN_CATALOG[planKey].entitlements;
}

export function canAccessEntitlement(
  entitlements: Entitlements,
  key: string
): boolean {
  const value = entitlements[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value.length > 0;
  return value !== null && value !== undefined;
}

export function getUsageLimit(
  entitlements: Entitlements,
  key: string
): number | null {
  const value = entitlements[key];
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function getEntitlementValue<T extends EntitlementValue = EntitlementValue>(
  entitlements: Entitlements,
  key: string
): T | undefined {
  return entitlements[key] as T | undefined;
}
