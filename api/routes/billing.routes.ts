import { Router, Request, Response, NextFunction } from "express";
import type Stripe from "stripe";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { AppError, ValidationError } from "../middlewares/error.middleware.js";
import { getEntitlementValue } from "../../billing/entitlements.js";
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
