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

export const isRevenueCatRefundEvent = (event = {}) => {
  const eventType = clean(event.type).toUpperCase();
  const reason = clean(event.cancel_reason || event.expiration_reason).toUpperCase();
  return (
    safeNumber(event.price, 0) < 0 ||
    ((eventType === "CANCELLATION" || eventType === "EXPIRATION") &&
      reason === "CUSTOMER_SUPPORT")
  );
};
