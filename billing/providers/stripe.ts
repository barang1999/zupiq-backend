import Stripe from "stripe";
import { env } from "../../config/env.js";
import type { BillingInterval, PlanKey, ProviderPlanMapping, SubscriptionStatus } from "../types.js";

interface StripeCheckoutRequest {
  userId: string;
  planKey: PlanKey;
  billingInterval: BillingInterval;
}

export interface StripeCheckoutResponse {
  provider: "stripe";
  checkoutUrl: string;
  sessionId: string;
  priceId: string;
}

const ENVIRONMENT = (process.env.NODE_ENV === "production" ? "production" : "development") as
  | "development"
  | "production";

const STRIPE_PROVIDER_MAPPINGS: ProviderPlanMapping[] = [
  {
    planKey: "core",
    provider: "stripe",
    environment: ENVIRONMENT,
    productId: env.STRIPE_PRODUCT_CORE || null,
    priceIdMonthly: env.STRIPE_PRICE_CORE_MONTHLY || null,
    priceIdAnnual: env.STRIPE_PRICE_CORE_ANNUAL || null,
    active: true,
  },
  {
    planKey: "pro",
    provider: "stripe",
    environment: ENVIRONMENT,
    productId: env.STRIPE_PRODUCT_PRO || null,
    priceIdMonthly: env.STRIPE_PRICE_PRO_MONTHLY || null,
    priceIdAnnual: env.STRIPE_PRICE_PRO_ANNUAL || null,
    active: true,
  },
];

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (stripeClient) return stripeClient;
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function getStripeWebhookSecret(): string {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  return env.STRIPE_WEBHOOK_SECRET;
}

export function listStripePlanMappings(): ProviderPlanMapping[] {
  return STRIPE_PROVIDER_MAPPINGS;
}

function resolveStripePriceId(planKey: PlanKey, billingInterval: BillingInterval): string | null {
  const mapping = STRIPE_PROVIDER_MAPPINGS.find((item) => item.planKey === planKey && item.active);
  if (!mapping) return null;
  return billingInterval === "annual" ? mapping.priceIdAnnual : mapping.priceIdMonthly;
}

export function resolvePlanFromStripePriceId(priceId: string | null | undefined): {
  planKey: PlanKey;
  billingInterval: BillingInterval;
} | null {
  if (!priceId) return null;
  const match = STRIPE_PROVIDER_MAPPINGS.find((mapping) =>
    mapping.active && (mapping.priceIdMonthly === priceId || mapping.priceIdAnnual === priceId)
  );
  if (!match) return null;
  if (match.priceIdAnnual === priceId) return { planKey: match.planKey, billingInterval: "annual" };
  return { planKey: match.planKey, billingInterval: "monthly" };
}

export function mapStripeStatus(
  status: Stripe.Subscription.Status,
  paused: boolean
): SubscriptionStatus {
  if (paused) return "paused";
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "incomplete" || status === "incomplete_expired") return "incomplete";
  return "expired";
}

export function toIsoFromUnix(timestamp: number | null | undefined): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  return new Date(timestamp * 1000).toISOString();
}

export function verifyStripeWebhookEvent(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined
): Stripe.Event {
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature) {
    throw new Error("Missing Stripe signature header");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
}

export async function startStripeCheckout(
  request: StripeCheckoutRequest
): Promise<StripeCheckoutResponse> {
  const priceId = resolveStripePriceId(request.planKey, request.billingInterval);
  if (!priceId) {
    throw new Error(`Stripe price id is not configured for ${request.planKey} (${request.billingInterval}).`);
  }
  if (!env.STRIPE_CHECKOUT_SUCCESS_URL || !env.STRIPE_CHECKOUT_CANCEL_URL) {
    throw new Error("Missing STRIPE_CHECKOUT_SUCCESS_URL or STRIPE_CHECKOUT_CANCEL_URL");
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: env.STRIPE_CHECKOUT_SUCCESS_URL,
    cancel_url: env.STRIPE_CHECKOUT_CANCEL_URL,
    client_reference_id: request.userId,
    allow_promotion_codes: true,
    metadata: {
      userId: request.userId,
      planKey: request.planKey,
      billingInterval: request.billingInterval,
    },
    subscription_data: {
      metadata: {
        userId: request.userId,
        planKey: request.planKey,
        billingInterval: request.billingInterval,
      },
    },
  });

  if (!session.url) {
    throw new Error("Stripe checkout session did not return a redirect URL");
  }

  return {
    provider: "stripe",
    checkoutUrl: session.url,
    sessionId: session.id,
    priceId,
  };
}
