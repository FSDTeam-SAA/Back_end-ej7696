import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  isValidRevenueCatAuthorization,
  isValidRevenueCatSignature,
} from "../utils/revenuecat.webhook.js";
import {
  internalProductIdentifierFromObject,
  isRevenueCatRefundEvent,
  productIdentifierFromObject,
  revenueCatActionSucceeded,
  revenueCatSubscriptionWasCancelled,
} from "../utils/revenuecat.helpers.js";
import { buildExamUnlockSummary } from "../utils/examAccess.helpers.js";

test("RevenueCat webhook authorization accepts raw and Bearer token formats", () => {
  assert.equal(isValidRevenueCatAuthorization("secret", "secret"), true);
  assert.equal(isValidRevenueCatAuthorization("Bearer secret", "secret"), true);
  assert.equal(isValidRevenueCatAuthorization("Bearer wrong", "secret"), false);
  assert.equal(isValidRevenueCatAuthorization("", "secret"), false);
});

test("RevenueCat HMAC validation uses the unmodified request bytes", () => {
  const rawBody = Buffer.from('{"event":{"id":"event-1"}}');
  const timestamp = 1_700_000_000;
  const signingSecret = "signing-secret";
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]))
    .digest("hex");

  assert.equal(
    isValidRevenueCatSignature({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      signingSecret,
      nowSeconds: timestamp + 60,
    }),
    true
  );
  assert.equal(
    isValidRevenueCatSignature({
      rawBody: Buffer.from("{}"),
      signatureHeader: `t=${timestamp},v1=${signature}`,
      signingSecret,
      nowSeconds: timestamp + 60,
    }),
    false
  );
  assert.equal(
    isValidRevenueCatSignature({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      signingSecret,
      nowSeconds: timestamp + 301,
    }),
    false
  );
});

test("refund detection distinguishes cancellation from an actual store refund", () => {
  assert.equal(
    isRevenueCatRefundEvent({
      type: "CANCELLATION",
      cancel_reason: "UNSUBSCRIBE",
      price: 9.99,
    }),
    false
  );
  assert.equal(
    isRevenueCatRefundEvent({
      type: "CANCELLATION",
      cancel_reason: "CUSTOMER_SUPPORT",
    }),
    true
  );
  assert.equal(
    isRevenueCatRefundEvent({ type: "CANCELLATION", price: -9.99 }),
    true
  );
});

test("RevenueCat v2 product identifiers are parsed defensively", () => {
  assert.equal(
    productIdentifierFromObject({
      product: { store_identifier: "six_month_subscriptions:six-month" },
    }),
    "six_month_subscriptions:six-month"
  );
  assert.equal(
    productIdentifierFromObject({
      product_store_identifier: "six_month_subscriptions",
    }),
    "six_month_subscriptions"
  );
  assert.equal(
    productIdentifierFromObject({ product_id: "prod_internal_123" }),
    ""
  );
  assert.equal(
    internalProductIdentifierFromObject({ product_id: "prod_internal_123" }),
    "prod_internal_123"
  );
});

test("RevenueCat lifetime exam access never receives a fallback expiry", () => {
  const purchasedAt = new Date("2025-01-01T00:00:00.000Z");
  const result = buildExamUnlockSummary({
    access: {
      examId: "exam-570",
      purchaseType: "exam",
      paymentStatus: "completed",
      accessDuration: "lifetime",
      purchasedAt,
    },
    examMap: { "exam-570": "API 570" },
    user: null,
    now: new Date("2035-01-01T00:00:00.000Z").getTime(),
  });

  assert.equal(result.isLifetime, true);
  assert.equal(result.expiresAt, null);
  assert.equal(result.expiryMonths, null);
  assert.equal(result.isExpired, false);
});

test("only a successful Customer Center refund submission changes access", () => {
  assert.equal(revenueCatActionSucceeded("success"), true);
  assert.equal(revenueCatActionSucceeded(" SUCCESS "), true);
  assert.equal(revenueCatActionSucceeded("userCancelled"), false);
  assert.equal(revenueCatActionSucceeded("error"), false);
});

test("RevenueCat will_not_renew is treated as an immediate cancellation", () => {
  assert.equal(
    revenueCatSubscriptionWasCancelled({
      auto_renewal_status: "will_not_renew",
    }),
    true
  );
  assert.equal(
    revenueCatSubscriptionWasCancelled({ auto_renewal_status: "will_renew" }),
    false
  );
});
