import { AppError } from "../api/middlewares/error.middleware.js";
import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { PLAN_CATALOG, listPublicPlans } from "./catalog.js";
import { canAccessEntitlement, getUsageLimit, resolveEffectivePlanKey, resolveEntitlements } from "./entitlements.js";
import { listRevenueCatPlanMappings } from "./providers/revenuecat.js";
import { listStripePlanMappings } from "./providers/stripe.js";
import type {
  BillingInterval,
  BillingProvider,
  EffectiveAccessState,
  Entitlements,
  NormalizedSubscription,
  PlanCatalogItem,
  PlanKey,
  ProviderPlanMapping,
  SubscriptionStatus,
} from "./types.js";

interface SubscriptionRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  plan_key: string;
  status: SubscriptionStatus;
  provider: BillingProvider;
  billing_interval: BillingInterval | null;
  amount: number;
  currency: string;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  granted_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface RowLookupResult {
  row: SubscriptionRow | null;
  tableReady: boolean;
}

export interface ChangePlanInput {
  userId: string;
  planKey: PlanKey;
  provider?: BillingProvider;
  billingInterval?: BillingInterval | null;
}

export interface CancelPlanInput {
  userId: string;
  mode: "immediate" | "period_end";
}

export interface ProviderSyncInput {
  userId: string;
  planKey: PlanKey;
  status: SubscriptionStatus;
  provider: Exclude<BillingProvider, "none">;
  billingInterval: BillingInterval | null;
  amount: number;
  currency: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  trialStart?: string | null;
  trialEnd?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  metadata?: Record<string, unknown>;
}

function isMissingSubscriptionTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  const message = (maybe.message ?? "").toLowerCase();
  return maybe.code === "42P01" || message.includes("subscriptions") || message.includes("does not exist");
}

function normalizePlanKey(value: string | null | undefined): PlanKey {
  if (value === "core" || value === "pro" || value === "free") return value;
  return "free";
}

function addDaysIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildFreeSubscription(userId: string): NormalizedSubscription {
  return {
    subscriptionId: null,
    userId,
    workspaceId: null,
    planKey: "free",
    status: "free",
    provider: "none",
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
    grantedBy: "system-default",
    metadata: {},
    createdAt: null,
    updatedAt: null,
  };
}

function toNormalizedSubscription(row: SubscriptionRow): NormalizedSubscription {
  const planKey = normalizePlanKey(row.plan_key);
  return {
    subscriptionId: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id ?? null,
    planKey,
    status: row.status ?? (planKey === "free" ? "free" : "active"),
    provider: row.provider ?? (planKey === "free" ? "none" : "manual"),
    billingInterval: row.billing_interval ?? null,
    amount: Number.isFinite(row.amount) ? Number(row.amount) : PLAN_CATALOG[planKey].pricing.monthly,
    currency: row.currency ?? "USD",
    cancelAtPeriodEnd: !!row.cancel_at_period_end,
    currentPeriodStart: row.current_period_start ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    trialStart: row.trial_start ?? null,
    trialEnd: row.trial_end ?? null,
    providerCustomerId: row.provider_customer_id ?? null,
    providerSubscriptionId: row.provider_subscription_id ?? null,
    grantedBy: row.granted_by ?? "billing",
    metadata: row.metadata ?? {},
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function resolvePeriodDays(interval: BillingInterval | null): number {
  if (interval === "annual") return 365;
  return 30;
}

function resolveAmount(plan: PlanCatalogItem, interval: BillingInterval | null): number {
  if (interval === "annual" && typeof plan.pricing.annual === "number") {
    return plan.pricing.annual;
  }
  return plan.pricing.monthly;
}

function shouldAutoDowngradeToFree(row: SubscriptionRow): boolean {
  if (normalizePlanKey(row.plan_key) === "free") return false;

  const now = Date.now();
  const periodEndAt = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  const hasPeriodEnded = periodEndAt !== null && Number.isFinite(periodEndAt) && periodEndAt <= now;

  if (row.cancel_at_period_end && hasPeriodEnded) return true;
  if (row.status === "expired" || row.status === "paused" || row.status === "incomplete") return true;
  if (row.status === "canceled" && (periodEndAt === null || hasPeriodEnded)) return true;

  return false;
}

async function selectLatestSubscriptionRow(userId: string): Promise<RowLookupResult> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingSubscriptionTableError(error)) {
      logger.warn("subscriptions table is missing. Read paths will fallback to free.");
      return { row: null, tableReady: false };
    }
    throw new AppError(error.message, 500);
  }

  return {
    row: (data?.[0] as SubscriptionRow | undefined) ?? null,
    tableReady: true,
  };
}

async function upsertSubscriptionRow(
  userId: string,
  patch: Partial<SubscriptionRow>
): Promise<SubscriptionRow> {
  const existingLookup = await selectLatestSubscriptionRow(userId);
  if (!existingLookup.tableReady) {
    throw new AppError(
      "Billing schema is missing (subscriptions table). Run zupiq-backend/database/schema.sql first.",
      500
    );
  }

  const stableId = patch.id ?? existingLookup.row?.id ?? generateId();
  const db = getSupabaseAdmin();
  const payload: Partial<SubscriptionRow> = {
    id: stableId,
    user_id: userId,
    workspace_id: patch.workspace_id ?? null,
    plan_key: patch.plan_key ?? "free",
    status: patch.status ?? "free",
    provider: patch.provider ?? "none",
    billing_interval: patch.billing_interval ?? null,
    amount: patch.amount ?? 0,
    currency: patch.currency ?? "USD",
    cancel_at_period_end: patch.cancel_at_period_end ?? false,
    current_period_start: patch.current_period_start ?? null,
    current_period_end: patch.current_period_end ?? null,
    trial_start: patch.trial_start ?? null,
    trial_end: patch.trial_end ?? null,
    provider_customer_id: patch.provider_customer_id ?? null,
    provider_subscription_id: patch.provider_subscription_id ?? null,
    granted_by: patch.granted_by ?? "billing",
    metadata: patch.metadata ?? {},
    updated_at: nowISO(),
  };

  // Let database defaults fill created_at for newly inserted rows.
  const { data, error } = await db
    .from("subscriptions")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error || !data) {
    if (isMissingSubscriptionTableError(error)) {
      throw new AppError(
        "Billing schema is missing (subscriptions table). Run zupiq-backend/database/schema.sql first.",
        500
      );
    }
    throw new AppError(error?.message ?? "Failed to upsert subscription", 500);
  }

  return data as SubscriptionRow;
}

async function applyAutoDowngradeIfNeeded(row: SubscriptionRow): Promise<SubscriptionRow> {
  if (!shouldAutoDowngradeToFree(row)) return row;

  const downgraded = await upsertSubscriptionRow(row.user_id, {
    id: row.id,
    plan_key: "free",
    status: "free",
    provider: "none",
    billing_interval: null,
    amount: 0,
    currency: "USD",
    cancel_at_period_end: false,
    current_period_start: null,
    current_period_end: null,
    trial_start: null,
    trial_end: null,
    provider_customer_id: null,
    provider_subscription_id: null,
    granted_by: "billing-expiry",
    metadata: {
      ...(row.metadata ?? {}),
      downgraded_from_plan: row.plan_key,
      downgraded_at: nowISO(),
      reason: "period_end_or_expired",
    },
  });

  return downgraded;
}

export async function getNormalizedSubscription(userId: string): Promise<NormalizedSubscription> {
  const lookup = await selectLatestSubscriptionRow(userId);
  if (!lookup.row) return buildFreeSubscription(userId);
  const row = await applyAutoDowngradeIfNeeded(lookup.row);
  return toNormalizedSubscription(row);
}

export async function ensureSubscriptionSeed(userId: string): Promise<NormalizedSubscription> {
  const lookup = await selectLatestSubscriptionRow(userId);
  if (!lookup.tableReady) {
    return buildFreeSubscription(userId);
  }
  if (lookup.row) {
    const row = await applyAutoDowngradeIfNeeded(lookup.row);
    return toNormalizedSubscription(row);
  }

  const seeded = await upsertSubscriptionRow(userId, {
    plan_key: "free",
    status: "free",
    provider: "none",
    billing_interval: null,
    amount: 0,
    currency: "USD",
    cancel_at_period_end: false,
    granted_by: "signup-default",
    metadata: {},
  });

  return toNormalizedSubscription(seeded);
}

export async function changeUserPlan(input: ChangePlanInput): Promise<NormalizedSubscription> {
  const plan = PLAN_CATALOG[input.planKey];
  if (!plan || !plan.active) {
    throw new AppError("Selected plan is not available", 400);
  }

  const billingInterval: BillingInterval | null = input.planKey === "free"
    ? null
    : (input.billingInterval ?? "monthly");
  const provider: BillingProvider = input.planKey === "free"
    ? "none"
    : (input.provider ?? "manual");
  const periodDays = resolvePeriodDays(billingInterval);
  const isFree = input.planKey === "free";

  const next = await upsertSubscriptionRow(input.userId, {
    plan_key: input.planKey,
    status: isFree ? "free" : "active",
    provider,
    billing_interval: billingInterval,
    amount: resolveAmount(plan, billingInterval),
    currency: plan.pricing.currency,
    cancel_at_period_end: false,
    current_period_start: isFree ? null : nowISO(),
    current_period_end: isFree ? null : addDaysIso(periodDays),
    trial_start: null,
    trial_end: null,
    granted_by: provider === "manual" ? "manual" : "billing",
    metadata: { changed_at: nowISO(), changed_to: input.planKey },
  });

  return toNormalizedSubscription(next);
}

export async function cancelUserSubscription(input: CancelPlanInput): Promise<NormalizedSubscription> {
  const current = await ensureSubscriptionSeed(input.userId);
  if (current.planKey === "free") return current;

  if (input.mode === "immediate") {
    return changeUserPlan({ userId: input.userId, planKey: "free", provider: "none" });
  }

  const periodEnd = current.currentPeriodEnd ?? addDaysIso(resolvePeriodDays(current.billingInterval));
  const next = await upsertSubscriptionRow(input.userId, {
    id: current.subscriptionId ?? generateId(),
    plan_key: current.planKey,
    status: "active",
    provider: current.provider,
    billing_interval: current.billingInterval,
    amount: current.amount,
    currency: current.currency,
    cancel_at_period_end: true,
    current_period_start: current.currentPeriodStart ?? nowISO(),
    current_period_end: periodEnd,
    trial_start: current.trialStart,
    trial_end: current.trialEnd,
    provider_customer_id: current.providerCustomerId,
    provider_subscription_id: current.providerSubscriptionId,
    granted_by: current.grantedBy,
    metadata: { ...(current.metadata ?? {}), cancel_requested_at: nowISO() },
  });

  return toNormalizedSubscription(next);
}

export async function getEffectiveAccessState(userId: string): Promise<EffectiveAccessState> {
  const subscription = await ensureSubscriptionSeed(userId);
  const effectivePlanKey = resolveEffectivePlanKey(subscription);
  const effectivePlan = PLAN_CATALOG[effectivePlanKey];
  const entitlements = resolveEntitlements(subscription);

  return {
    subscription,
    effectivePlanKey,
    effectivePlan,
    entitlements,
  };
}

export function hasEntitlement(entitlements: Entitlements, entitlementKey: string): boolean {
  return canAccessEntitlement(entitlements, entitlementKey);
}

export function resolveEntitlementLimit(entitlements: Entitlements, entitlementKey: string): number | null {
  return getUsageLimit(entitlements, entitlementKey);
}

export function getPublicBillingCatalog(): PlanCatalogItem[] {
  return listPublicPlans();
}

export function listProviderMappings(): ProviderPlanMapping[] {
  return [
    ...listStripePlanMappings(),
    ...listRevenueCatPlanMappings(),
  ];
}

export async function getSubscriptionByProviderSubscriptionId(
  providerSubscriptionId: string
): Promise<NormalizedSubscription | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("provider_subscription_id", providerSubscriptionId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingSubscriptionTableError(error)) return null;
    throw new AppError(error.message, 500);
  }
  const row = (data?.[0] as SubscriptionRow | undefined) ?? null;
  if (!row) return null;
  return toNormalizedSubscription(row);
}

export async function syncSubscriptionFromProvider(input: ProviderSyncInput): Promise<NormalizedSubscription> {
  const plan = PLAN_CATALOG[input.planKey];
  if (!plan) {
    throw new AppError(`Unknown plan key from provider sync: ${input.planKey}`, 400);
  }

  const next = await upsertSubscriptionRow(input.userId, {
    plan_key: input.planKey,
    status: input.status,
    provider: input.provider,
    billing_interval: input.billingInterval,
    amount: input.amount,
    currency: input.currency || "USD",
    cancel_at_period_end: input.cancelAtPeriodEnd,
    current_period_start: input.currentPeriodStart ?? null,
    current_period_end: input.currentPeriodEnd ?? null,
    trial_start: input.trialStart ?? null,
    trial_end: input.trialEnd ?? null,
    provider_customer_id: input.providerCustomerId ?? null,
    provider_subscription_id: input.providerSubscriptionId ?? null,
    granted_by: "billing",
    metadata: input.metadata ?? {},
  });

  return toNormalizedSubscription(next);
}

export async function logBillingEvent(args: {
  provider: BillingProvider;
  eventType: string;
  externalEventId?: string | null;
  payload?: Record<string, unknown>;
  userId?: string | null;
  processedAt?: string | null;
}): Promise<void> {
  const db = getSupabaseAdmin();
  const payload = {
    id: generateId(),
    user_id: args.userId ?? null,
    provider: args.provider,
    event_type: args.eventType,
    external_event_id: args.externalEventId ?? null,
    payload: args.payload ?? {},
    processed_at: args.processedAt ?? null,
    created_at: nowISO(),
  };

  const { error } = await db.from("billing_events").insert(payload);
  if (!error) return;

  // Duplicate webhook deliveries are expected; treat unique violation as success.
  if ((error as { code?: string }).code === "23505") return;
  if ((error as { code?: string }).code === "42P01") return;

  logger.warn("Failed to persist billing event log", {
    provider: args.provider,
    eventType: args.eventType,
    externalEventId: args.externalEventId ?? null,
    error: error.message,
  });
}
