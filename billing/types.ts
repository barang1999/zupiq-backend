export type PlanKey = "free" | "core" | "pro";

export type SubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "paused"
  | "incomplete";

export type BillingProvider = "none" | "stripe" | "revenuecat" | "manual";
export type BillingInterval = "monthly" | "annual";

export type EntitlementValue = boolean | number | string | null;
export type Entitlements = Record<string, EntitlementValue>;

export interface PlanCatalogItem {
  planKey: PlanKey;
  displayName: string;
  rank: number;
  active: boolean;
  public: boolean;
  pricing: {
    monthly: number;
    annual?: number | null;
    currency: string;
  };
  entitlements: Entitlements;
}

export interface ProviderPlanMapping {
  planKey: PlanKey;
  provider: Exclude<BillingProvider, "none" | "manual">;
  environment: "development" | "production";
  productId: string | null;
  priceIdMonthly: string | null;
  priceIdAnnual: string | null;
  active: boolean;
}

export interface NormalizedSubscription {
  subscriptionId: string | null;
  userId: string;
  workspaceId: string | null;
  planKey: PlanKey;
  status: SubscriptionStatus;
  provider: BillingProvider;
  billingInterval: BillingInterval | null;
  amount: number;
  currency: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  grantedBy: string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface EffectiveAccessState {
  subscription: NormalizedSubscription;
  effectivePlanKey: PlanKey;
  effectivePlan: PlanCatalogItem;
  entitlements: Entitlements;
}

export interface UsageSnapshot {
  featureKey: string;
  used: number;
  limit: number | null;
  remaining: number | null;
}
