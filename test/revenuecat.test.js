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
import {
  buildExamUnlockSummary,
  buildSelectedExamUnlockResponse,
  canAccessOwnedExam,
  isActiveProfessionalSubscription,
} from "../utils/examAccess.helpers.js";

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
    examImageMap: {
      "exam-570": "https://cdn.example.com/exams/api-570.png",
    },
    user: null,
    now: new Date("2035-01-01T00:00:00.000Z").getTime(),
  });

  assert.equal(result.isLifetime, true);
  assert.equal(
    result.examImageUrl,
    "https://cdn.example.com/exams/api-570.png"
  );
  assert.equal(result.expiresAt, null);
  assert.equal(result.expiryMonths, null);
  assert.equal(result.isExpired, false);
});

test("selected exam sync response explicitly confirms the unlocked exam", () => {
  const result = buildSelectedExamUnlockResponse({
    exam: { _id: "exam-570", name: "API 570" },
    access: {
      _id: "access-1",
      examId: "exam-570",
      status: "unlocked",
      purchaseType: "plan",
      paymentStatus: "completed",
      accessDuration: "subscription",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    },
  });

  assert.equal(result.examId, "exam-570");
  assert.equal(result.examName, "API 570");
  assert.equal(result.unlocked, true);
  assert.equal(result.purchaseType, "plan");
  assert.equal(result.paymentStatus, "completed");
});

test("exam ownership is accessible only with an active Professional subscription", () => {
  const access = { status: "unlocked", purchaseType: "exam" };
  const activeUser = {
    subscriptionTier: "professional",
    subscriptionExpiresAt: "2030-01-01T00:00:00.000Z",
  };
  const starterUser = {
    subscriptionTier: "starter",
    subscriptionExpiresAt: null,
  };
  const now = new Date("2029-01-01T00:00:00.000Z");

  assert.equal(isActiveProfessionalSubscription(activeUser, now), true);
  assert.equal(
    canAccessOwnedExam({ user: activeUser, access, referenceDate: now }),
    true
  );
  assert.equal(
    canAccessOwnedExam({ user: starterUser, access, referenceDate: now }),
    false
  );
  assert.equal(
    canAccessOwnedExam({
      user: activeUser,
      access: { status: "free", purchaseType: "exam" },
      referenceDate: now,
    }),
    false
  );
});

test("legacy standalone exam purchases are summarized as durable ownership", () => {
  const result = buildExamUnlockSummary({
    access: {
      examId: "exam-1184",
      status: "unlocked",
      purchaseType: "exam",
      paymentStatus: "completed",
      accessDuration: "three_months",
      purchasedAt: new Date("2025-01-01T00:00:00.000Z"),
      expiresAt: new Date("2025-04-01T00:00:00.000Z"),
    },
    examMap: { "exam-1184": "API 1184" },
    user: { subscriptionTier: "starter" },
    unlocked: false,
    now: new Date("2030-01-01T00:00:00.000Z").getTime(),
  });

  assert.equal(result.owned, true);
  assert.equal(result.unlocked, false);
  assert.equal(result.requiresSubscription, true);
  assert.equal(result.isLifetime, true);
  assert.equal(result.isExpired, false);
  assert.equal(result.expiresAt, null);
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
