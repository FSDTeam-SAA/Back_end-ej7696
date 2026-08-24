import httpStatus from "http-status";

import AppError from "../errors/AppError.js";
import { ExamAccess } from "../model/examAccess.model.js";
import { ExamSubscriptionTransaction } from "../model/examSubscriptionTransaction.model.js";
import { isExamEntitlementActive } from "./examAccess.helpers.js";

export const EXAM_ACCESS_DURATION_MONTHS = 6;

// App Store / Play Store accounts can legitimately move between application
// accounts, and RevenueCat re-attributes their purchase history to the newest
// App User ID. For those providers a transaction that already belongs to
// another user is a transfer, not a conflict. Card providers stay strict: a
// Stripe/PayPal charge must never change owner.
const STORE_TRANSFER_PROVIDERS = new Set(["revenuecat", "apple", "google"]);

export const addExamAccessMonths = (
  value,
  months = EXAM_ACCESS_DURATION_MONTHS
) => {
  const result = new Date(value);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
};

export const buildLegacyExamEntitlementWindow = (purchasedAt) => {
  const purchaseDate = new Date(purchasedAt);
  const configuredMigrationDate = process.env.EXAM_SUBSCRIPTION_MIGRATION_AT
    ? new Date(process.env.EXAM_SUBSCRIPTION_MIGRATION_AT)
    : null;
  const startedAt =
    configuredMigrationDate && !Number.isNaN(configuredMigrationDate.getTime())
      ? configuredMigrationDate
      : purchaseDate;
  return { startedAt, expiresAt: addExamAccessMonths(startedAt) };
};

export const grantExamEntitlement = async ({
  userId,
  examId,
  source,
  provider,
  amount = 0,
  currency = "USD",
  startedAt = new Date(),
  expiresAt,
  externalTransactionId = "",
  originalTransactionId = "",
  productId = "",
  purchaseType = source === "initial_included" ? "plan" : "exam",
  paymentFields = {},
  metadata = {},
}) => {
  const normalizedStartedAt = new Date(startedAt);
  const normalizedExpiresAt = expiresAt
    ? new Date(expiresAt)
    : addExamAccessMonths(normalizedStartedAt);

  if (externalTransactionId) {
    const existingTransaction = await ExamSubscriptionTransaction.findOne({
      provider,
      externalTransactionId,
    }).lean();
    if (existingTransaction) {
      const examMatches =
        existingTransaction.examId?.toString() === examId.toString();
      const userMatches =
        existingTransaction.userId?.toString() === userId.toString();
      const isStoreTransfer =
        examMatches &&
        !userMatches &&
        // A row without an owner cannot be transferred: passing an undefined
        // userId to the revoke below would widen its filter to the exam alone
        // and revoke an unrelated account.
        Boolean(existingTransaction.userId) &&
        STORE_TRANSFER_PROVIDERS.has(
          provider?.toString().trim().toLowerCase()
        );

      if (!examMatches || (!userMatches && !isStoreTransfer)) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Payment transaction is already linked to another exam entitlement"
        );
      }

      if (isStoreTransfer) {
        // Stores allow a single owner per purchase, so hand the entitlement
        // over instead of rejecting the sync: revoke the previous owner's
        // access, then re-point the ledger row at the new user. The unique
        // index on { provider, externalTransactionId } means the row has to
        // move rather than be duplicated.
        await revokeExamEntitlement({
          userId: existingTransaction.userId,
          examId: existingTransaction.examId,
          reason: "store_transfer",
        });
        await ExamSubscriptionTransaction.updateOne(
          { _id: existingTransaction._id },
          {
            $set: {
              userId,
              "metadata.transferredFromUserId":
                existingTransaction.userId?.toString() || "",
              "metadata.transferredAt": new Date(),
            },
          }
        );
      }
    }
  }

  const existing = await ExamAccess.findOne({ userId, examId });
  if (isExamEntitlementActive(existing, normalizedStartedAt)) {
    return { access: existing, created: false };
  }

  const access = await ExamAccess.findOneAndUpdate(
    { userId, examId },
    {
      $set: {
        userId,
        examId,
        status: "active",
        source,
        purchaseType,
        currency: currency.toString().trim().toUpperCase() || "USD",
        purchasePrice: Math.max(0, Number(amount) || 0),
        totalAmount: Math.max(0, Number(amount) || 0),
        maxQuestionsPerSession: 30,
        paymentStatus: "completed",
        purchasedAt: normalizedStartedAt,
        startedAt: normalizedStartedAt,
        accessDuration: "six_months",
        expiresAt: normalizedExpiresAt,
        ...paymentFields,
        metadata: { ...metadata, durationMonths: EXAM_ACCESS_DURATION_MONTHS },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const transactionFilter = externalTransactionId
    ? { provider, externalTransactionId }
    : {
        userId,
        examId,
        source,
        startedAt: normalizedStartedAt,
        provider,
      };
  await ExamSubscriptionTransaction.findOneAndUpdate(
    transactionFilter,
    {
      $set: {
        examAccessId: access._id,
        status: "completed",
        amount: Math.max(0, Number(amount) || 0),
        currency: currency.toString().trim().toUpperCase() || "USD",
        startedAt: normalizedStartedAt,
        expiresAt: normalizedExpiresAt,
        originalTransactionId,
        productId,
        metadata,
      },
      $setOnInsert: {
        userId,
        examId,
        source,
        provider,
        externalTransactionId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { access, created: true };
};

export const recordPendingExamSubscription = async ({
  userId,
  examId,
  examAccessId,
  provider,
  externalTransactionId,
  amount,
  currency = "USD",
  productId = "",
}) =>
  ExamSubscriptionTransaction.findOneAndUpdate(
    { provider, externalTransactionId },
    {
      $setOnInsert: {
        userId,
        examId,
        examAccessId,
        source: "exam_subscription",
        provider,
        status: "pending",
        amount: Math.max(0, Number(amount) || 0),
        currency: currency.toString().trim().toUpperCase() || "USD",
        externalTransactionId,
        productId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

export const markExamSubscriptionTransactionStatus = async ({
  provider,
  externalTransactionId,
  status,
  reason = "",
}) =>
  ExamSubscriptionTransaction.findOneAndUpdate(
    { provider, externalTransactionId },
    {
      $set: {
        status,
        ...(reason ? { "metadata.statusReason": reason } : {}),
      },
    },
    { new: true }
  );

export const revokeExamEntitlement = async ({
  userId,
  examId,
  provider = "",
  externalTransactionId = "",
  reason = "revoked",
  transactionStatus = "revoked",
}) => {
  const access = await ExamAccess.findOneAndUpdate(
    { userId, examId },
    {
      $set: {
        status: "revoked",
        paymentStatus: "voided",
        maxQuestionsPerSession: 2,
        "metadata.revocationReason": reason,
        "metadata.revokedAt": new Date(),
      },
    },
    { new: true }
  );
  if (externalTransactionId) {
    // Grants key the ledger by { provider, externalTransactionId } — the
    // provider has to be part of the filter, otherwise the same store id
    // reused by another provider would be revoked by mistake. Callers that
    // build a scoped id (see examLedgerTransactionId) must pass the same
    // scoped value here or nothing matches.
    await ExamSubscriptionTransaction.findOneAndUpdate(
      {
        ...(provider ? { provider } : {}),
        externalTransactionId,
      },
      { $set: { status: transactionStatus, "metadata.revocationReason": reason } }
    );
  }
  return access;
};

export const expireExamEntitlements = async ({ userId, now = new Date() } = {}) =>
  ExamAccess.updateMany(
    {
      ...(userId ? { userId } : {}),
      status: { $in: ["active", "unlocked"] },
      expiresAt: { $ne: null, $lte: now },
    },
    {
      $set: {
        status: "expired",
        maxQuestionsPerSession: 2,
        "metadata.expiredAt": now,
      },
    }
  );
