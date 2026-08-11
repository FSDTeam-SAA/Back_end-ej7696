# RevenueCat backend setup

## Deployed endpoints

- Webhook: `POST https://api.inspectorspath.com/api/v1/payments/revenuecat/webhook`
- Authenticated client sync: `POST https://api.inspectorspath.com/api/v1/payments/revenuecat/sync`
- Authenticated refund callback: `POST https://api.inspectorspath.com/api/v1/payments/revenuecat/refund-request`

The client sync endpoint uses the signed-in backend user's MongoDB ID as the
RevenueCat App User ID. It does not accept a user ID from the request body.

## RevenueCat webhook form

- **Webhook name:** `Inspectors Path Backend`
- **Webhook URL:** `https://api.inspectorspath.com/api/v1/payments/revenuecat/webhook`
- **Authorization header value:** `Bearer <REVENUECAT_WEBHOOK_AUTH_TOKEN>`
- **Environment:** Both Production and Sandbox while testing
- **App:** the Inspector's Path apps, or All apps
- **Event type:** All Events
- **Paywall events:** optional; they are safely ignored by this backend

Use **Send test webhook** after the updated backend is deployed. A valid test
must receive HTTP 200. Requests with a missing/wrong Authorization value receive
HTTP 401.

## Required server configuration

Copy the RevenueCat variables from `.env.example` into the production server.
The RevenueCat v2 secret key needs these permissions:

- `customer_information:customers:read`
- `customer_information:subscriptions:read_write` (required for Google Play refunds)
- `customer_information:purchases:read`
- `project_configuration:products:read` (required to translate RevenueCat v2
  `prod...` resource IDs into App Store / Play Store product identifiers)

The webhook token is independent of the RevenueCat API key. Generate a random
token and keep it secret. The handler accepts the recommended `Bearer <token>`
format and also accepts the raw token for compatibility.

For stronger validation, enable HMAC webhook signing in RevenueCat and set
`REVENUECAT_WEBHOOK_SIGNING_SECRET`. The server verifies the signature against
the original raw JSON bytes and rejects signatures older than five minutes.

## Lifecycle behavior

- Initial purchases, renewals, uncancellations, extensions, transfers, and
  temporary grants synchronize current RevenueCat access.
- A subscription cancellation immediately changes the backend plan to Starter,
  even when RevenueCat still reports paid entitlement time.
- A successful Customer Center subscription-refund submission also changes the
  backend plan to Starter immediately. Failed or abandoned submissions do not
  change the plan, and one-time exam purchases are not changed by this callback.
- Expiration or a confirmed store refund removes RevenueCat-backed access.
- Webhook event IDs are stored uniquely, so retries cannot apply the same event
  twice.
- Unknown future event types are recorded and acknowledged without changing
  access.
- Flutter also calls the authenticated sync endpoint after purchase/restore to
  avoid waiting for webhook delivery.

## Refund behavior

The existing admin refund endpoint remains:

`POST /api/v1/payments/admin/transactions/:transactionId/refund`

- Stripe: full and partial refunds are issued through Stripe.
- PayPal: full and partial refunds are issued against the captured payment.
- RevenueCat Google Play/Galaxy: full transaction refunds are issued through
  RevenueCat API v2 and access is revoked.
- Apple: Apple does not expose this refund operation through RevenueCat. Issue
  the refund in App Store Connect; the RevenueCat webhook will then record the
  refund and revoke access.
- Manual records: local refund bookkeeping is supported.

Partial plan refunds no longer downgrade the user. A full plan refund downgrades
the user, locks RevenueCat/plan exam access, voids linked add-ons, and rebuilds
resource access from the user's remaining completed purchases.

## Deployment order

1. Deploy the backend and install production dependencies.
2. Confirm `GET https://api.inspectorspath.com/` returns HTTP 200.
3. Configure the webhook in RevenueCat using the values above.
4. Send a RevenueCat test webhook and confirm HTTP 200.
5. Make a sandbox purchase and confirm the user's backend profile becomes
   `professional` with a RevenueCat expiration date.
6. Test unsubscribe (access remains through expiry), expiration, refund, restore,
   duplicate webhook delivery, and account transfer.
