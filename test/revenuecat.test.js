import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  isValidRevenueCatAuthorization,
  isValidRevenueCatSignature,
} from "../utils/revenuecat.webhook.js";
import {
  isRevenueCatRefundEvent,
  productIdentifierFromObject,
} from "../utils/revenuecat.helpers.js";

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
});
