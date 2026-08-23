# Zupiq Subscription & Payment Guide

## 1. Overview

Zupiq uses RevenueCat for mobile in-app subscriptions and keeps the backend as the source of truth for feature access.

Backend plans:

```text
free
core
pro
```

RevenueCat mobile subscription mapping:

```text
RevenueCat entitlement zupiq_premium -> backend plan_key pro
```

The mobile app can show store-localized prices from RevenueCat, but the backend must not rely on a fixed price. Google Play and App Store own localized pricing, tax, trials, offers, renewals, and cancellation management.

---

## 2. RevenueCat Identifiers

Entitlement:

```text
zupiq_premium
```

The code also recognizes these legacy/test entitlement names as fallbacks:

```text
premium
pro_access
unlimited_access
```

Google Play subscription product:

```text
zupiq.premium.monthly
```

App Store subscription product:

```text
com.zupiq.mobile.premium.monthly
```

RevenueCat should have a current offering with a Monthly package containing the correct platform product.

Recommended offering:

```text
default
```

Package:

```text
Monthly
```

If `Purchases.getOfferings()` returns an empty offering or the app shows `No package available`, check that the current offering has a Monthly package for the platform being tested.

---

## 3. RevenueCat Dashboard Setup

1. Create or open the Zupiq project in RevenueCat.
2. Add iOS app with bundle ID `com.zupiq.mobile`.
3. Add Android app with package name `com.zupiq.mobile`.
4. Create entitlement `zupiq_premium`.
5. Add App Store product `com.zupiq.mobile.premium.monthly`.
6. Add Google Play product `zupiq.premium.monthly`.
7. Attach both products to entitlement `zupiq_premium`.
8. Create or open offering `default`.
9. Mark `default` as Current.
10. Add a Monthly package to the current offering.
11. Attach the iOS and Android monthly products to that package.

---

## 4. Environment Variables

Frontend mobile SDK keys are public build-time values:

```env
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_PRO=zupiq_premium,premium,pro_access,unlimited_access
```

These are configured in:

```text
frontend/eas.json
frontend/.env
frontend/.env.development
frontend/.env.production
```

For EAS builds, `EXPO_PUBLIC_*` values are baked into the native binary. Rebuild after changing them.

Backend RevenueCat variables are private server-side values:

```env
REVENUECAT_WEBHOOK_SECRET=
REVENUECAT_WEBHOOK_AUTH_HEADER=Bearer <random-secret>
REVENUECAT_SECRET_API_KEY=sk_xxxxxxxxxxxxxxxxxxxx
REVENUECAT_IOS_PRODUCT_PRO_MONTHLY=com.zupiq.mobile.premium.monthly
REVENUECAT_ANDROID_PRODUCT_PRO_MONTHLY=zupiq.premium.monthly
```

`REVENUECAT_SECRET_API_KEY` must be a RevenueCat REST API v1 secret key. The backend uses:

```http
GET https://api.revenuecat.com/v1/subscribers/{app_user_id}
```

Do not use the mobile `appl_...` or `goog_...` SDK key for backend sync.

### Webhook Authentication

The current simple setup uses a static Authorization header.

Generate a value:

```bash
printf "Bearer %s\n" "$(openssl rand -hex 32)"
```

Put the full generated value in backend env:

```env
REVENUECAT_WEBHOOK_AUTH_HEADER=Bearer <generated-value>
```

Enter the same full value in RevenueCat webhook settings as the `Authorization` header.

`REVENUECAT_WEBHOOK_SECRET` is a different option for HMAC verification. Do not confuse it with the static auth header. If using static header auth, leave `REVENUECAT_WEBHOOK_SECRET` empty.

---

## 5. Backend Architecture

Backend billing state is stored in the existing `subscriptions` table.

Important columns:

```text
user_id
plan_key
status
provider
billing_interval
amount
currency
cancel_at_period_end
current_period_start
current_period_end
provider_customer_id
provider_subscription_id
metadata
```

RevenueCat-backed rows should look like:

```text
plan_key = pro
status = active | canceled | expired
provider = revenuecat
billing_interval = monthly
amount = 0
currency = USD
```

`amount` is intentionally `0` for RevenueCat subscriptions. The backend does not own localized subscription pricing. Display price in the paywall from RevenueCat/store data only.

Backend entitlements are derived from `PLAN_CATALOG` in:

```text
zupiq-backend/billing/catalog.ts
```

There is no separate app-specific entitlements table for the current Zupiq implementation.

---

## 6. Backend Routes

### Get Subscription

```http
GET /api/billing/subscription
Authorization: Bearer <Zupiq access token>
```

Response shape:

```json
{
  "access": {
    "subscription": {
      "planKey": "pro",
      "status": "active",
      "provider": "revenuecat",
      "billingInterval": "monthly",
      "currentPeriodEnd": "2026-08-23T10:20:31.000Z"
    },
    "effectivePlanKey": "pro",
    "entitlements": {}
  },
  "usage": {
    "used": 0,
    "limit": null,
    "remaining": null
  }
}
```

Frontend screens must read `data.access.subscription`, not `data.access.planKey`.

### RevenueCat Webhook

```http
POST /api/billing/webhook/revenuecat
Authorization: Bearer <configured webhook auth header>
Content-Type: application/json
```

Configured in:

```text
zupiq-backend/index.ts
zupiq-backend/api/routes/billing.routes.ts
```

The route requires a raw request body so signature/header verification can happen before JSON parsing.

Handled RevenueCat events include:

```text
INITIAL_PURCHASE
RENEWAL
CANCELLATION
EXPIRATION
PRODUCT_CHANGE
UNCANCELLATION
SUBSCRIPTION_EXTENDED
TRANSFER
```

The webhook updates `subscriptions` through `syncSubscriptionFromProvider()`.

### RevenueCat Sync Fallback

```http
POST /api/billing/subscription/sync
Authorization: Bearer <Zupiq access token>
Content-Type: application/json

{
  "revenuecatAppUserId": "current Purchases.getAppUserID() value"
}
```

Mobile calls this after successful purchase or restore. This endpoint:

1. Uses the authenticated Zupiq user ID.
2. Also checks the `revenuecatAppUserId` sent by the mobile SDK.
3. Calls RevenueCat REST API v1 for subscriber data.
4. Chooses the latest active `zupiq_premium` entitlement.
5. Upserts the Zupiq `subscriptions` row.
6. Returns the same shape as `GET /api/billing/subscription`.

This fallback is required because webhooks can be delayed, especially during sandbox testing.

---

## 7. Frontend Architecture

RevenueCat setup lives in:

```text
frontend/src/lib/revenueCat.ts
```

Main helpers:

```ts
configureRevenueCat()
identifyRevenueCatUser(user.id)
logoutRevenueCatUser()
hasRevenueCatProEntitlement(customerInfo)
```

The app initializes RevenueCat in:

```text
frontend/app/_layout.tsx
```

`AuthContext` identifies RevenueCat users on login/session hydration and logs out RevenueCat on sign-out:

```text
frontend/src/context/AuthContext.js
```

`AuthContext` also stores backend billing state:

```ts
billing
syncBilling({ nextBilling })
```

### Paywall

Paywall file:

```text
frontend/app/(public)/paywall.tsx
```

Purchase flow:

```text
configureRevenueCat()
Purchases.getOfferings()
select monthly package
require signed-in Zupiq user
Purchases.logIn(user.id)
Purchases.purchasePackage(monthlyPackage)
check active entitlement zupiq_premium
POST /api/billing/subscription/sync
syncBilling({ nextBilling: synced.access })
return to subscription screen
```

Restore flow:

```text
Purchases.logIn(user.id)
Purchases.restorePurchases()
check active entitlement zupiq_premium
POST /api/billing/subscription/sync
syncBilling({ nextBilling: synced.access })
```

The paywall displays `priceString` from RevenueCat:

```ts
monthlyPackage.product.priceString
```

Do not hardcode localized subscription prices on profile or subscription status screens.

### Subscription Screen

Subscription screen:

```text
frontend/app/subscription.tsx
```

It reads:

```ts
data.access.subscription
data.access.effectivePlanKey
```

It refreshes when focused so returning from the paywall shows the upgraded state immediately.

It does not render backend `amount`, because store-localized price is owned by Google Play/App Store.

### Profile Screen

Profile screen:

```text
frontend/app/(app)/profile.tsx
```

The profile badge and Subscription row use:

```ts
billing.subscription
billing.effectivePlanKey
```

They no longer use stale `user.is_pro`.

---

## 8. Debug Logs

Useful frontend logs:

```text
[revenuecat.configure]
[revenuecat.offerings]
[revenuecat.login]
[revenuecat.purchase] starting
[revenuecat.purchase] completed
[revenuecat.purchase] cancelled
[revenuecat.purchase] post-cancel customerInfo
[revenuecat.restore]
[revenuecat.sync] starting
[revenuecat.sync] completed
[subscription.render] loaded
```

Useful backend logs:

```text
[revenuecat.webhook] subscription state applied
[revenuecat.sync] request received
[revenuecat.sync] subscriber state loaded
[revenuecat.sync] subscription state synced
```

Common causes when sync fails:

```text
Missing REVENUECAT_SECRET_API_KEY
Wrong RevenueCat API version/key type
RevenueCat app_user_id mismatch
Entitlement identifier not zupiq_premium
Current offering missing Monthly package
Product not attached to entitlement
Play Store/App Store product not active for tested app
```

---

## 9. Developer Testing

### RevenueCat Offering Empty

Error:

```text
There are no Play Store products registered in the RevenueCat dashboard for your offerings
```

Fix:

1. Open RevenueCat Offerings.
2. Ensure `default` is Current.
3. Ensure it has a Monthly package.
4. Ensure Monthly package includes `zupiq.premium.monthly` for Android.
5. Ensure Monthly package includes `com.zupiq.mobile.premium.monthly` for iOS.
6. Ensure both products are attached to `zupiq_premium`.

### Purchase Cancelled

RevenueCat may log:

```text
PurchaseCancelledError
USER_CANCELED
```

This usually means the SDK did not return a successful purchase result. The paywall checks `Purchases.getCustomerInfo()` after cancellation; if `zupiq_premium` is already active, it still syncs the backend.

### Verify Backend State

Expected active sandbox row:

```json
{
  "plan_key": "pro",
  "status": "active",
  "provider": "revenuecat",
  "billing_interval": "monthly",
  "amount": "0",
  "provider_customer_id": "<zupiq-user-id>",
  "provider_subscription_id": "zupiq.premium.monthly"
}
```

Correct old rows that were created before `amount` was fixed:

```sql
update subscriptions
set amount = 0
where provider = 'revenuecat';
```

### Verify Frontend State

After successful sync, logs should include:

```text
[revenuecat.sync] completed { planKey: "pro", status: "active", effectivePlanKey: "pro" }
[subscription.render] loaded { planKey: "pro", status: "active", effectivePlanKey: "pro" }
```

Profile should show:

```text
Pro
Pro Active
```

### Free Limit Handling

When a free user reaches the daily AI token limit, backend AI routes return:

```json
{
  "code": "BILLING_USAGE_LIMIT_REACHED",
  "error": "Daily free usage limit reached (... tokens today).",
  "details": {
    "featureKey": "daily_deep_dive_tokens",
    "used": 12000,
    "limit": 12000,
    "remaining": 0
  }
}
```

HTTP status:

```text
402 Payment Required
```

Frontend helper:

```text
frontend/src/lib/billingLimit.js
```

The scan and solution flows use this helper to route users to:

```text
frontend/app/(public)/paywall.tsx
```

Patched entry points:

```text
frontend/app/(app)/_layout.tsx
frontend/src/features/flow/FlowBottomNav.js
frontend/src/components/ui/ProblemComposerModal.js
frontend/app/solution.tsx
```

---

## 10. App Store / Play Store Compliance

Before release:

```text
[ ] In-app product created in App Store Connect
[ ] Subscription group configured in App Store Connect
[ ] Subscription product created in Google Play Console
[ ] RevenueCat entitlement zupiq_premium exists
[ ] RevenueCat current offering has Monthly package
[ ] Monthly package links both platform products
[ ] Restore button present on paywall
[ ] Terms and Privacy links present on paywall
[ ] "Cancel anytime" messaging present
[ ] Backend REVENUECAT_SECRET_API_KEY set
[ ] Backend REVENUECAT_WEBHOOK_AUTH_HEADER or REVENUECAT_WEBHOOK_SECRET set
[ ] RevenueCat webhook points to production backend
[ ] Backend subscription amount is not used for localized display
```

---

## 11. Current Implementation Files

Backend:

```text
zupiq-backend/config/env.ts
zupiq-backend/index.ts
zupiq-backend/billing/providers/revenuecat.ts
zupiq-backend/billing/subscription-service.ts
zupiq-backend/api/routes/billing.routes.ts
zupiq-backend/billing/catalog.ts
```

Frontend:

```text
frontend/src/lib/revenueCat.ts
frontend/src/api/billing.js
frontend/src/context/AuthContext.js
frontend/src/lib/storage.js
frontend/app/_layout.tsx
frontend/app/(public)/paywall.tsx
frontend/app/subscription.tsx
frontend/app/(app)/profile.tsx
frontend/eas.json
```

---

## 12. Recommended Release Flow

1. Configure App Store and Play Store products.
2. Configure RevenueCat apps, entitlement, products, and current offering.
3. Set mobile RevenueCat SDK keys in EAS.
4. Set backend RevenueCat REST API v1 secret key.
5. Set RevenueCat webhook Authorization header.
6. Deploy backend.
7. Configure RevenueCat webhook:

```text
https://api.zupiq.ai/api/billing/webhook/revenuecat
```

8. Build a fresh mobile binary.
9. Test Android internal testing purchase.
10. Test iOS TestFlight purchase.
11. Confirm backend row updates to `provider = revenuecat`, `plan_key = pro`, `amount = 0`.
12. Confirm Subscription and Profile screens render `Pro`.
