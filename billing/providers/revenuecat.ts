import type { ProviderPlanMapping } from "../types.js";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError } from "../../api/middlewares/error.middleware.js";
import { env } from "../../config/env.js";
import type { BillingInterval, PlanKey, SubscriptionStatus } from "../types.js";

export function listRevenueCatPlanMappings(): ProviderPlanMapping[] {
  return [
    {
      planKey: "pro",
      provider: "revenuecat",
      environment: "production",
      productId: env.REVENUECAT_IOS_PRODUCT_PRO_MONTHLY || null,
      priceIdMonthly: env.REVENUECAT_IOS_PRODUCT_PRO_MONTHLY || null,
      priceIdAnnual: null,
      active: Boolean(env.REVENUECAT_IOS_PRODUCT_PRO_MONTHLY),
    },
    {
      planKey: "pro",
      provider: "revenuecat",
      environment: "production",
      productId: env.REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY || null,
      priceIdMonthly: env.REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY || null,
      priceIdAnnual: null,
      active: Boolean(env.REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY),
    },
  ];
}

export function normalizeRevenueCatStatus(rawStatus: string): SubscriptionStatus {
  const status = rawStatus.toLowerCase().trim();
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "expired") return "expired";
  if (status === "canceled") return "canceled";
  if (status === "paused") return "paused";
  if (status === "past_due") return "past_due";
  return "incomplete";
}

export interface RevenueCatEntitlementState {
  isActive: boolean;
  planKey: PlanKey;
  status: SubscriptionStatus;
  billingInterval: BillingInterval | null;
  productId: string | null;
  store: string | null;
  amount: number;
  currency: string;
  expiresAt: string | null;
  purchasedAt: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  appUserId: string | null;
  aliases: string[];
  raw: Record<string, unknown>;
}

const REVENUECAT_PRO_ENTITLEMENTS = ["zupiq_premium", "premium", "pro_access", "unlimited_access"];
const REVENUECAT_PRO_PRODUCTS = new Set([
  env.REVENUECAT_IOS_PRODUCT_PRO_MONTHLY,
  env.REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY,
].filter(Boolean));

function normalizeRevenueCatProductId(productId: string | null): string | null {
  if (!productId) return null;
  return productId.split(":")[0] || productId;
}

function msToIso(value: unknown): string | null {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function dateToIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function isFutureIso(value: string | null): boolean {
  if (!value) return true;
  return new Date(value).getTime() > Date.now() - 60 * 1000;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function hasValidSignature(rawBody: Buffer, signature: string): boolean {
  if (!env.REVENUECAT_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", env.REVENUECAT_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const normalized = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(normalized, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifyRevenueCatWebhookRequest(rawBody: Buffer, headers: Record<string, unknown>): void {
  const authHeader = firstString(headers.authorization);
  if (env.REVENUECAT_WEBHOOK_AUTH_HEADER && authHeader === env.REVENUECAT_WEBHOOK_AUTH_HEADER) return;

  const signature = firstString(
    headers["x-revenuecat-signature"],
    headers["x-revenuecat-webhook-signature"],
    headers["revenuecat-signature"]
  );
  if (signature && hasValidSignature(rawBody, signature)) return;

  if (!env.REVENUECAT_WEBHOOK_SECRET && !env.REVENUECAT_WEBHOOK_AUTH_HEADER) {
    throw new AppError("RevenueCat webhook verification is not configured", 500);
  }

  throw new AppError("Invalid RevenueCat webhook signature", 401);
}

export function parseRevenueCatWebhookEvent(payload: Record<string, unknown>): RevenueCatEntitlementState | null {
  const event = (payload.event && typeof payload.event === "object" ? payload.event : payload) as Record<string, unknown>;
  const eventType = firstString(event.type, event.event_type) ?? "";
  const rawProductId = firstString(event.product_id, event.product_identifier);
  const productId = normalizeRevenueCatProductId(rawProductId);
  const entitlementIds = stringArray(event.entitlement_ids);
  const isProProduct = productId ? REVENUECAT_PRO_PRODUCTS.has(productId) : false;
  const isProEntitlement = entitlementIds.some((id) => REVENUECAT_PRO_ENTITLEMENTS.includes(id));

  if (!isProProduct && !isProEntitlement) return null;

  const expiresAt = msToIso(event.expiration_at_ms) ?? dateToIso(event.expires_date);
  const purchasedAt = msToIso(event.purchased_at_ms) ?? dateToIso(event.purchase_date);
  const type = eventType.toUpperCase();
  const activeEvent = [
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "SUBSCRIPTION_EXTENDED",
    "TRANSFER",
  ].includes(type);
  const expiredEvent = type === "EXPIRATION";
  const canceledEvent = type === "CANCELLATION";
  const isActive = activeEvent || (canceledEvent && isFutureIso(expiresAt));

  return {
    isActive,
    planKey: isActive && !expiredEvent ? "pro" : "free",
    status: expiredEvent ? "expired" : canceledEvent ? "canceled" : isActive ? "active" : normalizeRevenueCatStatus(type),
    billingInterval: productId?.includes("monthly") ? "monthly" : null,
    productId,
    store: firstString(event.store),
    amount: 0,
    currency: "USD",
    expiresAt,
    purchasedAt,
    transactionId: firstString(event.transaction_id),
    originalTransactionId: firstString(event.original_transaction_id),
    appUserId: firstString(event.app_user_id, event.original_app_user_id),
    aliases: stringArray(event.aliases),
    raw: { ...event, raw_product_id: rawProductId },
  };
}

interface RevenueCatSubscriberResponse {
  subscriber?: {
    original_app_user_id?: string;
    original_application_version?: string;
    entitlements?: Record<string, {
      expires_date?: string | null;
      product_identifier?: string | null;
      purchase_date?: string | null;
    }>;
    subscriptions?: Record<string, {
    expires_date?: string | null;
    purchase_date?: string | null;
    store?: string | null;
    price?: {
      amount?: number | null;
      currency?: string | null;
    } | null;
    unsubscribe_detected_at?: string | null;
      billing_issues_detected_at?: string | null;
      original_transaction_id?: string | null;
    }>;
  };
}

export async function fetchRevenueCatSubscriber(appUserId: string): Promise<RevenueCatSubscriberResponse> {
  if (!env.REVENUECAT_SECRET_API_KEY) {
    throw new AppError("Missing REVENUECAT_SECRET_API_KEY", 500);
  }

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${env.REVENUECAT_SECRET_API_KEY}`,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new AppError(`RevenueCat subscriber lookup failed: ${response.status}`, 502);
  }

  return await response.json() as RevenueCatSubscriberResponse;
}

export function extractRevenueCatEntitlementState(
  appUserId: string,
  response: RevenueCatSubscriberResponse
): RevenueCatEntitlementState {
  const subscriber = response.subscriber ?? {};
  const entitlements = subscriber.entitlements ?? {};
  const subscriptions = subscriber.subscriptions ?? {};

  let best: RevenueCatEntitlementState | null = null;
  for (const entitlementId of REVENUECAT_PRO_ENTITLEMENTS) {
    const entitlement = entitlements[entitlementId];
    if (!entitlement) continue;
    const productId = normalizeRevenueCatProductId(entitlement.product_identifier ?? null);
    const subscription = productId ? subscriptions[productId] : null;
    const expiresAt = dateToIso(entitlement.expires_date);
    const purchaseDate = dateToIso(entitlement.purchase_date ?? subscription?.purchase_date);
    const hasBillingIssue = Boolean(subscription?.billing_issues_detected_at);
    const hasUnsubscribed = Boolean(subscription?.unsubscribe_detected_at);
    const active = isFutureIso(expiresAt) && !hasBillingIssue;
    const state: RevenueCatEntitlementState = {
      isActive: active,
      planKey: active ? "pro" : "free",
      status: active ? (hasUnsubscribed ? "canceled" : "active") : "expired",
      billingInterval: productId?.includes("monthly") ? "monthly" : null,
      productId,
      store: subscription?.store ?? null,
      amount: typeof subscription?.price?.amount === "number" ? subscription.price.amount : 0,
      currency: subscription?.price?.currency ?? "USD",
      expiresAt,
      purchasedAt: purchaseDate,
      transactionId: null,
      originalTransactionId: subscription?.original_transaction_id ?? null,
      appUserId,
      aliases: [],
      raw: { entitlementId, entitlement, subscription },
    };

    const bestTime = best?.expiresAt ? new Date(best.expiresAt).getTime() : 0;
    const stateTime = state.expiresAt ? new Date(state.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (!best || stateTime > bestTime) best = state;
  }

  return best ?? {
    isActive: false,
    planKey: "free",
    status: "expired",
    billingInterval: null,
    productId: null,
    store: null,
    amount: 0,
    currency: "USD",
    expiresAt: null,
    purchasedAt: null,
    transactionId: null,
    originalTransactionId: null,
    appUserId,
    aliases: [],
    raw: { subscriber },
  };
}
