# Manual Plan Upgrade Guide

## Overview

Manual upgrade lets an admin assign any billing plan (`free`, `core`, `pro`) to a user directly from the admin dashboard — no payment provider needed. Use it for:

- Granting pro/core access to beta testers, partners, or support cases
- Correcting a subscription that got stuck or mis-synced from RevenueCat/Stripe
- Downgrading a user back to free immediately

Manually-assigned subscriptions are stored in the same `subscriptions` table as Stripe and RevenueCat records. The row carries `provider = manual` (or `provider = none` for free), making it distinguishable from paid subscriptions.

---

## How to Upgrade a User

1. Open the admin dashboard and navigate to **Users**.
2. Click on a user to open their detail page.
3. In the **Subscription** card (top-right), click **Change Plan**.
4. A dropdown lists the three plans: `Free`, `Core`, `Pro`. The current plan has a checkmark.
5. Select the target plan.
6. The page refreshes automatically. The Subscription card now shows the new plan, the **Upgraded** date, and the **Day N** counter.

---

## Backend

### Route

```
POST /api/admin/users/:id/plan
Authorization: Bearer <admin JWT>
Content-Type: application/json

{ "plan_key": "pro" }   // "free" | "core" | "pro"
```

File: `zupiq-backend/api/routes/admin.routes.ts`

The route:
1. Validates `plan_key` is one of the three allowed values.
2. Confirms the user exists in the `users` table.
3. Calls `changeUserPlan()` from `billing/subscription-service.ts`.
4. Logs the action and returns the updated subscription row.

### Subscription Service

`changeUserPlan()` in `zupiq-backend/billing/subscription-service.ts`:

```ts
changeUserPlan({
  userId: id,
  planKey: "pro",          // target plan
  provider: "manual",      // "none" for free
  billingInterval: "monthly",
})
```

What gets written to `subscriptions`:

| Column | Value |
|---|---|
| `plan_key` | `"pro"` / `"core"` / `"free"` |
| `status` | `"active"` (or `"free"` for free plan) |
| `provider` | `"manual"` (or `"none"` for free) |
| `billing_interval` | `"monthly"` (or `null` for free) |
| `amount` | catalog price (monthly) |
| `current_period_start` | `now()` — upgrade timestamp |
| `current_period_end` | 30 days from now |
| `granted_by` | `"manual"` |
| `metadata` | `{ changed_at, changed_to }` |

> **Note:** `current_period_end` is set to +30 days as a default for manually-assigned plans. Unlike RevenueCat/Stripe, there is no auto-renewal — the period end date is informational only. The backend does **not** auto-expire manual subscriptions unless `shouldAutoDowngradeToFree()` triggers (period ended + `cancel_at_period_end = true`, or status is `expired`/`canceled`).

---

## Frontend

### Server Action

`adminChangeUserPlan(userId, planKey)` in `admin/src/app/_actions.ts`:

- POSTs to `POST /api/admin/users/:id/plan` using the admin token cookie.
- Returns `{ subscription }` on success or `{ error: string }` on failure.

### ChangePlanButton Component

`admin/src/components/admin/ChangePlanButton.tsx`

- Client component (`"use client"`).
- Renders a **Change Plan** button that opens a dropdown with all three plans.
- Uses `useTransition` for the async server action call.
- Calls `router.refresh()` on success so the page reloads with updated data.
- Shows an inline error message if the API returns an error.

---

## Day Counter

The Subscription card shows two pieces of upgrade-date information:

### "Upgraded" field
Displays the value of `current_period_start` formatted as a date (e.g. `Sep 17, 2026`). This is set to `now()` every time `changeUserPlan()` runs.

### "Day N" badge
Shown next to the plan badge:

```ts
// utils.ts
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
```

- Day 1 = the upgrade date itself (0 days elapsed → display `Day 1`)
- Day 2 = one day after upgrade, etc.

Both fields are only rendered when `plan_key !== "free"` and `current_period_start` is non-null.

---

## Manual vs RevenueCat / Stripe

| | Manual | RevenueCat | Stripe |
|---|---|---|---|
| `provider` | `manual` | `revenuecat` | `stripe` |
| `amount` | catalog price | `0` (store-owned) | actual charge |
| Auto-renewal | No | Yes (via webhook) | Yes (via webhook) |
| Period end enforcement | Informational only (no auto-expire by default) | Enforced via webhook events | Enforced via webhook events |
| Source of truth | Admin action | RevenueCat + webhook | Stripe + webhook |

If a user has both a manual row and a later RevenueCat sync, the `upsertSubscriptionRow` function uses `onConflict: "user_id"` — the latest upsert wins (determined by `updated_at`).

---

## Reverting / Downgrading

To revert a user to free:

1. Open the user's detail page.
2. Click **Change Plan** → select **Free**.

This calls `changeUserPlan({ planKey: "free", provider: "none" })`, which sets:
- `plan_key = "free"`, `status = "free"`, `provider = "none"`
- Clears period dates, billing interval, and provider IDs

To downgrade from `pro` to `core`, follow the same steps — select **Core** from the dropdown.

---

## Files Reference

```
zupiq-backend/api/routes/admin.routes.ts          POST /api/admin/users/:id/plan
zupiq-backend/billing/subscription-service.ts     changeUserPlan()
admin/src/app/_actions.ts                         adminChangeUserPlan() server action
admin/src/components/admin/ChangePlanButton.tsx   UI dropdown component
admin/src/app/(dashboard)/users/[id]/page.tsx     SubscriptionCard with Day N display
admin/src/lib/utils.ts                            daysSince()
```
