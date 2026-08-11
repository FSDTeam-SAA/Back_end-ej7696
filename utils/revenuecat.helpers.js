const clean = (value) => value?.toString().trim() || "";

const safeNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const productIdentifierFromObject = (value) =>
  clean(
    value?.product_store_identifier ||
      value?.product?.store_identifier ||
      value?.product?.store_product_identifier ||
      value?.product?.identifier ||
      value?.store_product_identifier
  );

// RevenueCat API v2 purchase/subscription objects normally expose an internal
// product resource ID (for example `prod...`) instead of the App Store / Play
// Store identifier used by this application. Keep the two identifiers
// separate: treating `product_id` as a store identifier silently prevents exam
// products from matching the catalog.
export const internalProductIdentifierFromObject = (value) =>
  clean(value?.product_id || value?.product?.id);

export const revenueCatPurchaseIsUsable = (purchase) => {
  if (purchase?.refunded_at || purchase?.revoked_at) return false;
  const entitlementItems = purchase?.entitlements?.items;
  if (!Array.isArray(entitlementItems) || entitlementItems.length === 0) {
    return true;
  }
  return entitlementItems.some((item) =>
    ["active", "granted"].includes(clean(item?.state).toLowerCase())
  );
};

export const revenueCatPurchasesIncludeProduct = (purchases, productId) => {
  const requestedProductId = clean(productId);
  if (!requestedProductId || !Array.isArray(purchases)) return false;
  return purchases.some(
    (purchase) =>
      revenueCatPurchaseIsUsable(purchase) &&
      productIdentifierFromObject(purchase) === requestedProductId
  );
};

export const isRevenueCatRefundEvent = (event = {}) => {
  const eventType = clean(event.type).toUpperCase();
  const reason = clean(event.cancel_reason || event.expiration_reason).toUpperCase();
  return (
    safeNumber(event.price, 0) < 0 ||
    ((eventType === "CANCELLATION" || eventType === "EXPIRATION") &&
      reason === "CUSTOMER_SUPPORT")
  );
};

export const normalizeRevenueCatActionStatus = (value) =>
  clean(value).toLowerCase().replace(/[^a-z]/g, "");

export const revenueCatActionSucceeded = (value) =>
  normalizeRevenueCatActionStatus(value) === "success";

export const revenueCatSubscriptionWasCancelled = (subscription = {}) =>
  ["will_not_renew", "cancelled", "canceled"].includes(
    clean(subscription.auto_renewal_status).toLowerCase()
  );
