import test from "node:test";
import assert from "node:assert/strict";
import { STORE_PRICE_CATALOG } from "../utils/storePricing.service.js";

test("professional plan maps the approved one-month Apple and Google products", () => {
  assert.deepEqual(STORE_PRICE_CATALOG.professional_plan.apple, [
    { productId: "one_month_subscriptions", kind: "subscription" },
  ]);
  assert.deepEqual(STORE_PRICE_CATALOG.professional_plan.google, [
    { productId: "six_month_subscriptions", basePlanId: "one-month" },
  ]);
});

test("exam unlock maps all nine one-month products on both stores", () => {
  const { apple, google } = STORE_PRICE_CATALOG.exam_unlock;
  assert.equal(apple.length, 9);
  assert.equal(google.length, 9);
  assert.equal(new Set(apple.map((item) => item.productId)).size, 9);
  assert.equal(new Set(google.map((item) => `${item.productId}:${item.basePlanId}`)).size, 9);
  assert.ok(apple.every((item) => item.productId.endsWith(".onemonth")));
  assert.ok(google.every((item) => item.basePlanId.endsWith("onemonth")));
});
