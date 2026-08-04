import crypto from "node:crypto";

const clean = (value) => value?.toString().trim() || "";

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(clean(left));
  const rightBuffer = Buffer.from(clean(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const isValidRevenueCatAuthorization = (authorization, token) => {
  const configuredToken = clean(token);
  if (!configuredToken) return false;
  return (
    safeEqual(authorization, configuredToken) ||
    safeEqual(authorization, `Bearer ${configuredToken}`)
  );
};

const parseRevenueCatSignature = (header) => {
  const parts = clean(header)
    .split(",")
    .map((part) => part.split("=", 2))
    .filter(([key, value]) => key && value);
  return Object.fromEntries(parts);
};

export const isValidRevenueCatSignature = ({
  rawBody,
  signatureHeader,
  signingSecret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
}) => {
  if (!Buffer.isBuffer(rawBody)) return false;
  const { t: timestamp, v1: signature } = parseRevenueCatSignature(signatureHeader);
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || !signature) return false;
  if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) return false;

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  const expected = crypto
    .createHmac("sha256", clean(signingSecret))
    .update(signedPayload)
    .digest("hex");
  return safeEqual(signature, expected);
};
