import { Router, Request, Response, NextFunction } from "express";
import type Stripe from "stripe";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { AppError, ValidationError } from "../middlewares/error.middleware.js";
import { getEntitlementValue } from "../../billing/entitlements.js";
import {
  extractRevenueCatEntitlementState,
  fetchRevenueCatSubscriber,
  parseRevenueCatWebhookEvent,
  verifyRevenueCatWebhookRequest,
  type RevenueCatEntitlementState,
} from "../../billing/providers/revenuecat.js";
import {
  mapStripeStatus,
  resolvePlanFromStripePriceId,
  startStripeCheckout,
  toIsoFromUnix,
  verifyStripeWebhookEvent,
} from "../../billing/providers/stripe.js";
import {
  cancelUserSubscription,
  changeUserPlan,
  getEffectiveAccessState,
  getPublicBillingCatalog,
  getSubscriptionByProviderSubscriptionId,
  hasEntitlement,
  listProviderMappings,
  logBillingEvent,
  resolveEntitlementLimit,
  syncSubscriptionFromProvider,
} from "../../billing/subscription-service.js";
import type { BillingInterval, BillingProvider, PlanKey, SubscriptionStatus } from "../../billing/types.js";
import { DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY, getTodayUsageSnapshot } from "../../billing/usage-service.js";
import {
  registerUsageStreamClient,
  sendUsageSnapshot,
  setupUsageStreamHeaders,
} from "../../billing/usage-stream.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import { logger } from "../../utils/logger.js";

const router = Router();
const DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY = "daily_deep_dive_token_limit";

function coercePlanKey(value: string | null | undefined): PlanKey | null {
  if (value === "free" || value === "core" || value === "pro") return value;
  return null;
}

function coerceBillingInterval(value: string | null | undefined): BillingInterval | null {
  if (value === "monthly" || value === "annual") return value;
  return null;
}

async function syncFromStripeSubscription(
  subscription: Stripe.Subscription,
  fallbackUserId?: string | null
): Promise<void> {
  const recurring = subscription.items.data[0]?.price?.recurring;
  const resolvedInterval: BillingInterval | null = recurring?.interval === "year"
    ? "annual"
    : recurring?.interval === "month"
      ? "monthly"
      : null;
  const mappedByPrice = resolvePlanFromStripePriceId(subscription.items.data[0]?.price?.id ?? null);
  const planKey = coercePlanKey(subscription.metadata?.planKey) ?? mappedByPrice?.planKey;
  if (!planKey) {
    throw new AppError(`Could not resolve planKey from Stripe subscription ${subscription.id}`, 400);
  }

  const existing = await getSubscriptionByProviderSubscriptionId(subscription.id);
  const userId = subscription.metadata?.userId || fallbackUserId || existing?.userId || null;
  if (!userId) {
    throw new AppError(`Could not resolve userId for Stripe subscription ${subscription.id}`, 400);
  }

  const amountCents = subscription.items.data[0]?.price?.unit_amount ?? 0;
  const currency = (subscription.currency ?? "usd").toUpperCase();
  const periodStartRaw = (subscription as any).current_period_start ?? subscription.items.data[0]?.current_period_start ?? null;
  const periodEndRaw = (subscription as any).current_period_end ?? subscription.items.data[0]?.current_period_end ?? null;
  const status: SubscriptionStatus = mapStripeStatus(
    subscription.status,
    Boolean(subscription.pause_collection)
  );

  await syncSubscriptionFromProvider({
    userId,
    provider: "stripe",
    planKey,
    status,
    billingInterval:
      coerceBillingInterval(subscription.metadata?.billingInterval) ??
      resolvedInterval ??
      mappedByPrice?.billingInterval ??
      null,
    amount: amountCents > 0 ? amountCents / 100 : existing?.amount ?? 0,
    currency,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodStart: toIsoFromUnix(periodStartRaw),
    currentPeriodEnd: toIsoFromUnix(periodEndRaw),
    trialStart: toIsoFromUnix(subscription.trial_start),
    trialEnd: toIsoFromUnix(subscription.trial_end),
    providerCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
    providerSubscriptionId: subscription.id,
    metadata: {
      source: "stripe-webhook",
      stripeStatus: subscription.status,
      latestInvoice:
        typeof subscription.latest_invoice === "string"
          ? subscription.latest_invoice
          : subscription.latest_invoice?.id ?? null,
      cancelAt: toIsoFromUnix(subscription.cancel_at),
    },
  });
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim()))];
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveRevenueCatUserId(state: RevenueCatEntitlementState, fallbackUserId?: string | null): Promise<string | null> {
  if (fallbackUserId) return fallbackUserId;

  const candidates = uniqueStrings([
    state.appUserId,
    ...state.aliases,
  ]).filter((candidate) => isUuidLike(candidate));

  if (!candidates.length) return null;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("users")
    .select("id")
    .in("id", candidates)
    .limit(1);

  if (error) {
    throw new AppError(error.message, 500);
  }

  return data?.[0]?.id ?? null;
}

async function applyRevenueCatState(
  state: RevenueCatEntitlementState,
  fallbackUserId?: string | null
) {
  const userId = await resolveRevenueCatUserId(state, fallbackUserId);
  if (!userId) {
    throw new AppError("Could not resolve userId for RevenueCat event", 400);
  }

  return await syncSubscriptionFromProvider({
    userId,
    provider: "revenuecat",
    planKey: state.isActive ? "pro" : "free",
    status: state.isActive ? state.status : "expired",
    billingInterval: state.isActive ? state.billingInterval ?? "monthly" : null,
    amount: 0,
    currency: state.currency || "USD",
    cancelAtPeriodEnd: state.status === "canceled",
    currentPeriodStart: state.purchasedAt,
    currentPeriodEnd: state.expiresAt,
    trialStart: null,
    trialEnd: null,
    providerCustomerId: state.appUserId,
    providerSubscriptionId: state.originalTransactionId ?? state.transactionId ?? state.productId,
    metadata: {
      source: "revenuecat",
      productId: state.productId,
      store: state.store,
      revenuecatAppUserId: state.appUserId,
      aliases: state.aliases,
      raw: state.raw,
    },
  });
}

router.post(
  "/webhook/stripe",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError("Stripe webhook requires raw request body", 400);
      }

      const event = verifyStripeWebhookEvent(req.body, req.headers["stripe-signature"]);
      const now = new Date().toISOString();

      try {
        await logBillingEvent({
          provider: "stripe",
          eventType: event.type,
          externalEventId: event.id,
          payload: {
            object: event.data.object?.object ?? null,
            livemode: event.livemode,
          },
          processedAt: now,
        });
      } catch {
        // keep webhook processing resilient
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const planKey = coercePlanKey(session.metadata?.planKey);
        const userId = session.client_reference_id || session.metadata?.userId || null;
        const billingInterval = (session.metadata?.billingInterval as BillingInterval | undefined) ?? "monthly";

        if (planKey && userId) {
          await syncSubscriptionFromProvider({
            userId,
            provider: "stripe",
            planKey,
            status: "active",
            billingInterval,
            amount: (session.amount_total ?? 0) / 100,
            currency: (session.currency ?? "usd").toUpperCase(),
            cancelAtPeriodEnd: false,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            trialStart: null,
            trialEnd: null,
            providerCustomerId: typeof session.customer === "string" ? session.customer : null,
            providerSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
            metadata: {
              source: "stripe-checkout",
              checkoutSessionId: session.id,
              paymentStatus: session.payment_status,
            },
          });
        }

        res.json({ received: true });
        return;
      }

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const subscription = event.data.object as Stripe.Subscription;
        await syncFromStripeSubscription(subscription, null);
        res.json({ received: true });
        return;
      }

      if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
        const invoice = event.data.object as Stripe.Invoice;
        const invoiceLegacySubscription = (invoice as any)?.subscription;
        const parent = (invoice as any)?.parent;
        const providerSubscriptionId =
          typeof invoiceLegacySubscription === "string"
            ? invoiceLegacySubscription
            : parent?.subscription_details?.subscription ?? null;

        if (providerSubscriptionId) {
          const existing = await getSubscriptionByProviderSubscriptionId(providerSubscriptionId);
          if (existing) {
            await syncSubscriptionFromProvider({
              userId: existing.userId,
              provider: "stripe",
              planKey: existing.planKey,
              status: event.type === "invoice.payment_failed" ? "past_due" : "active",
              billingInterval: existing.billingInterval,
              amount: invoice.amount_paid ? invoice.amount_paid / 100 : existing.amount,
              currency: (invoice.currency ?? existing.currency ?? "usd").toUpperCase(),
              cancelAtPeriodEnd: existing.cancelAtPeriodEnd,
              currentPeriodStart: existing.currentPeriodStart,
              currentPeriodEnd: existing.currentPeriodEnd,
              trialStart: existing.trialStart,
              trialEnd: existing.trialEnd,
              providerCustomerId:
                typeof invoice.customer === "string" ? invoice.customer : existing.providerCustomerId,
              providerSubscriptionId,
              metadata: {
                ...(existing.metadata ?? {}),
                source: "stripe-invoice",
                lastInvoiceId: invoice.id,
                lastInvoiceEvent: event.type,
              },
            });
          }
        }

        res.json({ received: true });
        return;
      }

      res.json({ received: true, ignored: true });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/webhook/revenuecat",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError("RevenueCat webhook requires raw request body", 400);
      }

      verifyRevenueCatWebhookRequest(req.body, req.headers);

      const payload = JSON.parse(req.body.toString("utf8")) as Record<string, unknown>;
      const state = parseRevenueCatWebhookEvent(payload);
      const event = (payload.event && typeof payload.event === "object" ? payload.event : payload) as Record<string, unknown>;
      const eventType = String(event.type ?? event.event_type ?? "unknown");
      const externalEventId = String(event.id ?? event.event_timestamp_ms ?? event.transaction_id ?? "");

      await logBillingEvent({
        provider: "revenuecat",
        eventType,
        externalEventId: externalEventId || null,
        payload: {
          productId: state?.productId ?? null,
          appUserId: state?.appUserId ?? null,
          aliases: state?.aliases ?? [],
        },
        processedAt: new Date().toISOString(),
      });

      if (!state) {
        res.json({ received: true, ignored: true });
        return;
      }

      const subscription = await applyRevenueCatState(state);
      logger.info("[revenuecat.webhook] subscription state applied", {
        userId: subscription.userId,
        planKey: subscription.planKey,
        status: subscription.status,
        productId: state.productId,
      });

      res.json({ received: true });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/catalog",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        plans: getPublicBillingCatalog(),
        providerMappings: listProviderMappings(),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.use(requireAuth);

router.get(
  "/usage/stream",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      setupUsageStreamHeaders(res);
      const cleanup = registerUsageStreamClient(userId, res);

      const access = await getEffectiveAccessState(userId);
      const dailyLimit = resolveEntitlementLimit(
        access.entitlements,
        DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
      );
      const usage = await getTodayUsageSnapshot(
        userId,
        DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        dailyLimit
      );

      sendUsageSnapshot(res, {
        ...usage,
        updatedAt: new Date().toISOString(),
        source: "snapshot",
      });

      req.on("close", cleanup);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/subscription",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const access = await getEffectiveAccessState(req.user!.sub);
      const dailyLimit = resolveEntitlementLimit(
        access.entitlements,
        DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
      );
      const usage = await getTodayUsageSnapshot(
        req.user!.sub,
        DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        dailyLimit
      );
      res.json({ access, usage });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/subscription/sync",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.sub;
      const revenuecatAppUserId = String(req.body?.revenuecatAppUserId ?? "").trim();
      const appUserIds = uniqueStrings([userId, revenuecatAppUserId || null]);

      logger.info("[revenuecat.sync] request received", {
        userId,
        revenuecatAppUserId: revenuecatAppUserId || null,
        lookupAppUserIds: appUserIds,
      });

      let bestState: RevenueCatEntitlementState | null = null;
      for (const appUserId of appUserIds) {
        const subscriber = await fetchRevenueCatSubscriber(appUserId);
        const state = extractRevenueCatEntitlementState(appUserId, subscriber);
        logger.info("[revenuecat.sync] subscriber state loaded", {
          userId,
          lookupAppUserId: appUserId,
          isActive: state.isActive,
          planKey: state.planKey,
          status: state.status,
          productId: state.productId,
          expiresAt: state.expiresAt,
          store: state.store,
        });
        const bestTime = bestState?.expiresAt ? new Date(bestState.expiresAt).getTime() : 0;
        const stateTime = state.expiresAt ? new Date(state.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (!bestState || (state.isActive && !bestState.isActive) || (state.isActive === bestState.isActive && stateTime > bestTime)) {
          bestState = state;
        }
      }

      if (!bestState) {
        throw new AppError("RevenueCat subscriber state could not be loaded", 502);
      }

      await applyRevenueCatState(bestState, userId);

      const access = await getEffectiveAccessState(userId);
      const dailyLimit = resolveEntitlementLimit(
        access.entitlements,
        DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
      );
      const usage = await getTodayUsageSnapshot(
        userId,
        DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        dailyLimit
      );

      logger.info("[revenuecat.sync] subscription state synced", {
        userId,
        planKey: access.subscription.planKey,
        status: access.subscription.status,
        revenuecatAppUserId: bestState.appUserId,
      });

      res.json({ access, usage });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/access",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entitlement = String(req.query.entitlement ?? "").trim();
      if (!entitlement) {
        throw new ValidationError("entitlement query parameter is required");
      }

      const access = await getEffectiveAccessState(req.user!.sub);
      const allowed = hasEntitlement(access.entitlements, entitlement);
      const value = getEntitlementValue(access.entitlements, entitlement) ?? null;

      const usageFeatureKey = String(req.query.usage_feature_key ?? "").trim();
      const usageLimit = resolveEntitlementLimit(access.entitlements, entitlement);
      const usage = usageFeatureKey
        ? await getTodayUsageSnapshot(req.user!.sub, usageFeatureKey, usageLimit)
        : null;

      res.json({
        entitlement,
        allowed,
        value,
        usage,
        effectivePlanKey: access.effectivePlanKey,
        status: access.subscription.status,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/subscribe",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const planKey = String(req.body?.planKey ?? "").trim() as PlanKey;
      const provider = (req.body?.provider ?? "manual") as BillingProvider;
      const billingInterval = (req.body?.billingInterval ?? "monthly") as BillingInterval;

      if (!planKey || !["free", "core", "pro"].includes(planKey)) {
        throw new ValidationError("planKey must be one of: free, core, pro");
      }
      if (!["manual", "stripe", "revenuecat", "none"].includes(provider)) {
        throw new ValidationError("provider must be one of: manual, stripe, revenuecat, none");
      }

      if (provider === "stripe" && planKey !== "free") {
        try {
          const checkout = await startStripeCheckout({
            userId: req.user!.sub,
            planKey,
            billingInterval,
          });
          res.json({ mode: "checkout_required", checkout });
          return;
        } catch (error) {
          throw new AppError(
            error instanceof Error ? error.message : "Stripe checkout failed",
            501
          );
        }
      }

      await changeUserPlan({
        userId: req.user!.sub,
        planKey,
        provider: planKey === "free" ? "none" : provider,
        billingInterval: planKey === "free" ? null : billingInterval,
      });

      const access = await getEffectiveAccessState(req.user!.sub);
      const dailyLimit = resolveEntitlementLimit(
        access.entitlements,
        DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
      );
      const usage = await getTodayUsageSnapshot(
        req.user!.sub,
        DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        dailyLimit
      );

      res.json({
        mode: "activated",
        access,
        usage,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const mode = String(req.body?.mode ?? "period_end");
      if (mode !== "period_end" && mode !== "immediate") {
        throw new ValidationError("mode must be one of: period_end, immediate");
      }

      const subscription = await cancelUserSubscription({
        userId: req.user!.sub,
        mode,
      });
      const access = await getEffectiveAccessState(req.user!.sub);
      const dailyLimit = resolveEntitlementLimit(
        access.entitlements,
        DAILY_DEEP_DIVE_TOKEN_LIMIT_ENTITLEMENT_KEY
      );
      const usage = await getTodayUsageSnapshot(
        req.user!.sub,
        DAILY_DEEP_DIVE_TOKEN_USAGE_FEATURE_KEY,
        dailyLimit
      );

      res.json({
        mode,
        subscription,
        access,
        usage,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
