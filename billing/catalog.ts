import type { PlanCatalogItem, PlanKey } from "./types.js";

export const PLAN_CATALOG: Record<PlanKey, PlanCatalogItem> = {
  free: {
    planKey: "free",
    displayName: "Scholar",
    rank: 10,
    active: true,
    public: true,
    pricing: { monthly: 0, annual: null, currency: "USD" },
    entitlements: {
      basic_breakdowns: true,
      deep_dive_access: true,
      daily_deep_dive_limit: 3,
      knowledge_maps: false,
      knowledge_map_export: false,
      ai_tutor: false,
      priority_processing: false,
      larger_project_capacity: "small",
      faster_generation: false,
      premium_models: false,
    },
  },
  core: {
    planKey: "core",
    displayName: "Builder",
    rank: 20,
    active: true,
    public: true,
    pricing: { monthly: 5, annual: null, currency: "USD" },
    entitlements: {
      basic_breakdowns: true,
      deep_dive_access: true,
      daily_deep_dive_limit: null,
      knowledge_maps: true,
      knowledge_map_export: false,
      ai_tutor: true,
      priority_processing: false,
      larger_project_capacity: "medium",
      faster_generation: true,
      premium_models: "standard",
    },
  },
  pro: {
    planKey: "pro",
    displayName: "Architect",
    rank: 30,
    active: true,
    public: true,
    pricing: { monthly: 9.99, annual: null, currency: "USD" },
    entitlements: {
      basic_breakdowns: true,
      deep_dive_access: true,
      daily_deep_dive_limit: null,
      knowledge_maps: true,
      knowledge_map_export: true,
      ai_tutor: true,
      priority_processing: true,
      larger_project_capacity: "large",
      faster_generation: true,
      premium_models: "full",
    },
  },
};

export function getPlanCatalogItem(planKey: PlanKey): PlanCatalogItem {
  return PLAN_CATALOG[planKey];
}

export function listPublicPlans(): PlanCatalogItem[] {
  return Object.values(PLAN_CATALOG)
    .filter((p) => p.active && p.public)
    .sort((a, b) => a.rank - b.rank);
}
