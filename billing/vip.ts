import { env } from "../config/env.js";
import { PLAN_CATALOG } from "./catalog.js";
import type { EffectiveAccessState, NormalizedSubscription } from "./types.js";

/**
 * Parsed set of VIP email addresses (lowercased) from the VIP_EMAILS env var.
 * Empty when VIP_EMAILS is not configured.
 */
const VIP_EMAIL_SET: Set<string> = new Set(
  env.VIP_EMAILS
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Returns true when at least one VIP email is configured.
 * Use this as a fast-path guard before doing any DB lookups.
 */
export function hasVipEmailsConfigured(): boolean {
  return VIP_EMAIL_SET.size > 0;
}

/**
 * Returns true if the given email is in the VIP list.
 * Always false when VIP_EMAILS is not configured.
 */
export function isVipEmail(email: string): boolean {
  if (VIP_EMAIL_SET.size === 0) return false;
  return VIP_EMAIL_SET.has(email.toLowerCase());
}

/**
 * Builds a synthetic pro EffectiveAccessState for a VIP user.
 * The subscription never expires (no currentPeriodEnd) and is not tied to any
 * payment provider — it is granted purely by the VIP_EMAILS env var.
 */
export function buildVipAccessState(userId: string): EffectiveAccessState {
  const subscription: NormalizedSubscription = {
    subscriptionId: null,
    userId,
    workspaceId: null,
    planKey: "pro",
    status: "active",
    provider: "manual",
    billingInterval: null,
    amount: 0,
    currency: "USD",
    cancelAtPeriodEnd: false,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    trialStart: null,
    trialEnd: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    grantedBy: "vip",
    metadata: { vip: true },
    createdAt: null,
    updatedAt: null,
  };

  const effectivePlan = PLAN_CATALOG["pro"];

  return {
    subscription,
    effectivePlanKey: "pro",
    effectivePlan,
    entitlements: effectivePlan.entitlements,
  };
}
