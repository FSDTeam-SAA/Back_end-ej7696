import crypto from "crypto";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { User } from "../model/user.model.js";
import { ReferralRelationship } from "../model/referralRelationship.model.js";
import { ReferralReward } from "../model/referralReward.model.js";
import { ReferralPayoutRequest } from "../model/referralPayoutRequest.model.js";
import { ReferralCreditConversion } from "../model/referralCreditConversion.model.js";
import { ProfessionalPlanPurchase } from "../model/professionalPlanPurchase.model.js";
import { ResourcePurchase } from "../model/resourcePurchase.model.js";

export const REFERRAL_DISCOUNT_RATE = 0.1;
export const REFERRAL_PENDING_DAYS = 7;
export const CASH_PAYOUT_MIN_BALANCE = 100;

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeIdLike = (value) => value?.toString().trim() || "";

const normalizeEmail = (email) => email?.toString().trim().toLowerCase() || "";

export const normalizeReferralCode = (code) =>
  code?.toString().trim().toUpperCase() || "";

const buildReferralCodeCandidate = () => {
  const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `IP${raw}`;
};

export const buildReferralLink = (referralCode) => {
  const normalizedCode = normalizeReferralCode(referralCode);
  if (!normalizedCode) return "";

  const base =
    process.env.REFERRAL_LINK_BASE_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    "";

  if (!base) {
    return `/r/${normalizedCode}`;
  }

  return `${base.replace(/\/+$/, "")}/r/${normalizedCode}`;
};

export const generateUniqueReferralCode = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = buildReferralCodeCandidate();
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }
  throw new AppError(
    httpStatus.INTERNAL_SERVER_ERROR,
    "Unable to generate unique referral code"
  );
};

export const validateReferralAtSignup = ({ referrer, email, installationId }) => {
  const fraudChecks = {
    selfReferral: false,
    sameEmail: false,
    sameDeviceId: false,
    samePaymentAccount: false,
  };

  if (!referrer) {
    throw new AppError(httpStatus.BAD_REQUEST, "Referral code is invalid");
  }

  const referrerEmail = normalizeEmail(referrer.email);
  const candidateEmail = normalizeEmail(email);

  if (referrerEmail && candidateEmail && referrerEmail === candidateEmail) {
    fraudChecks.sameEmail = true;
  }

  const referrerInstallation = normalizeIdLike(referrer.activeInstallationId);
  const candidateInstallation = normalizeIdLike(installationId);
  if (
    referrerInstallation &&
    candidateInstallation &&
    referrerInstallation === candidateInstallation
  ) {
    fraudChecks.sameDeviceId = true;
  }

  if (fraudChecks.sameEmail || fraudChecks.sameDeviceId || fraudChecks.selfReferral) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Referral code cannot be used for this account"
    );
  }

  return fraudChecks;
};

export const createReferralRelationshipOnSignup = async ({
  referrer,
  referredUser,
  referralCode,
}) => {
  if (!referrer || !referredUser) return null;

  const existing = await ReferralRelationship.findOne({
    referredUserId: referredUser._id,
  });

  if (existing) {
    return existing;
  }

  return ReferralRelationship.create({
    referrerUserId: referrer._id,
    referredUserId: referredUser._id,
    referralCode: normalizeReferralCode(referralCode),
    status: "active",
    fraudChecks: {
      selfReferral: false,
      sameEmail: false,
      sameDeviceId: false,
      samePaymentAccount: false,
    },
    joinedAt: new Date(),
  });
};

export const releaseMaturedReferralRewards = async (userId) => {
  const now = new Date();
  const filter = {
    status: "pending",
    pendingUntil: { $lte: now },
    remainingAmount: { $gt: 0 },
  };
  if (userId) {
    filter.referrerUserId = userId;
  }

  await ReferralReward.updateMany(filter, {
    $set: {
      status: "available",
      availableAt: now,
    },
  });
};

const getCompletedPaymentAccountHit = async ({ userId, paymentAccountFingerprint }) => {
  if (!userId || !paymentAccountFingerprint) return false;

  const [planHit, resourceHit] = await Promise.all([
    ProfessionalPlanPurchase.exists({
      userId,
      status: "completed",
      paymentAccountFingerprint,
    }),
    ResourcePurchase.exists({
      userId,
      status: "completed",
      paymentAccountFingerprint,
    }),
  ]);

  return Boolean(planHit || resourceHit);
};

export const runUpgradeFraudChecks = async ({
  referredUser,
  referrer,
  paymentAccountFingerprint,
}) => {
  const fraudChecks = {
    selfReferral: false,
    sameEmail: false,
    sameDeviceId: false,
    samePaymentAccount: false,
  };

  if (!referredUser || !referrer) {
    return {
      fraudChecks,
      hasFraud: false,
    };
  }

  if (normalizeIdLike(referredUser._id) === normalizeIdLike(referrer._id)) {
    fraudChecks.selfReferral = true;
  }

  if (
    normalizeEmail(referredUser.email) &&
    normalizeEmail(referredUser.email) === normalizeEmail(referrer.email)
  ) {
    fraudChecks.sameEmail = true;
  }

  const referredInstallation = normalizeIdLike(referredUser.activeInstallationId);
  const referrerInstallation = normalizeIdLike(referrer.activeInstallationId);
  if (
    referredInstallation &&
    referrerInstallation &&
    referredInstallation === referrerInstallation
  ) {
    fraudChecks.sameDeviceId = true;
  }

  if (paymentAccountFingerprint) {
    const samePaymentAccount = await getCompletedPaymentAccountHit({
      userId: referrer._id,
      paymentAccountFingerprint,
    });
    if (samePaymentAccount) {
      fraudChecks.samePaymentAccount = true;
    }
  }

  const hasFraud = Object.values(fraudChecks).some(Boolean);
  return { fraudChecks, hasFraud };
};

export const markRelationshipDisqualified = async ({
  relationship,
  fraudChecks,
  reason,
}) => {
  if (!relationship) return null;

  relationship.status = "disqualified";
  relationship.disqualifiedReason = reason || "Referral disqualified";
  relationship.fraudChecks = {
    ...(relationship.fraudChecks || {}),
    ...(fraudChecks || {}),
  };
  await relationship.save();
  return relationship;
};

export const createPendingReferralReward = async ({
  relationship,
  planPurchase,
  resourcePurchase,
  commissionAmount,
  commissionRate,
  currency,
  metadata,
}) => {
  if (!relationship || (!planPurchase && !resourcePurchase)) return null;
  const normalizedAmount = roundCurrency(commissionAmount);
  if (normalizedAmount <= 0) return null;

  const existingFilter = planPurchase
    ? { planPurchaseId: planPurchase._id }
    : { resourcePurchaseId: resourcePurchase._id };

  const existing = await ReferralReward.findOne(existingFilter);
  if (existing) return existing;

  const pendingUntil = new Date();
  pendingUntil.setDate(pendingUntil.getDate() + REFERRAL_PENDING_DAYS);

  const payload = {
    relationshipId: relationship._id,
    referrerUserId: relationship.referrerUserId,
    referredUserId: relationship.referredUserId,
    currency: currency || "USD",
    commissionRate,
    commissionAmount: normalizedAmount,
    remainingAmount: normalizedAmount,
    status: "pending",
    pendingUntil,
    metadata: {
      referralCode: relationship.referralCode,
      ...(metadata || {}),
    },
  };

  if (planPurchase) {
    payload.planPurchaseId = planPurchase._id;
  }

  if (resourcePurchase) {
    payload.resourcePurchaseId = resourcePurchase._id;
  }

  return ReferralReward.create(payload);
};

export const voidReferralRewardsForPlanPurchase = async ({ planPurchaseId, reason }) => {
  if (!planPurchaseId) return;
  const rewards = await ReferralReward.find({
    planPurchaseId,
    status: { $ne: "voided" },
  });

  for (const reward of rewards) {
    reward.status = "voided";
    reward.voidedAt = new Date();
    reward.voidReason = reason || "Payment not eligible";
    reward.remainingAmount = 0;
    await reward.save();
  }
};

const aggregateRewardBalance = async (userId) => {
  const [summary] = await ReferralReward.aggregate([
    {
      $match: {
        referrerUserId: userId,
      },
    },
    {
      $group: {
        _id: null,
        pendingRewards: {
          $sum: {
            $cond: [{ $eq: ["$status", "pending"] }, "$remainingAmount", 0],
          },
        },
        availableBalance: {
          $sum: {
            $cond: [{ $eq: ["$status", "available"] }, "$remainingAmount", 0],
          },
        },
        totalEarned: {
          $sum: {
            $cond: [{ $eq: ["$status", "voided"] }, 0, "$commissionAmount"],
          },
        },
      },
    },
  ]);

  return {
    pendingRewards: roundCurrency(summary?.pendingRewards || 0),
    availableBalance: roundCurrency(summary?.availableBalance || 0),
    totalEarned: roundCurrency(summary?.totalEarned || 0),
  };
};

const aggregatePaidOut = async (userId) => {
  const [creditAgg, payoutAgg] = await Promise.all([
    ReferralCreditConversion.aggregate([
      { $match: { userId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    ReferralPayoutRequest.aggregate([
      { $match: { userId, status: { $in: ["approved", "paid"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return roundCurrency((creditAgg?.[0]?.total || 0) + (payoutAgg?.[0]?.total || 0));
};

export const getReferralSummary = async (userId) => {
  await releaseMaturedReferralRewards(userId);

  const [rewardBalance, paidOut, inspectorsReferred, successfulUpgrades] =
    await Promise.all([
      aggregateRewardBalance(userId),
      aggregatePaidOut(userId),
      ReferralRelationship.countDocuments({ referrerUserId: userId, status: "active" }),
      ReferralRelationship.countDocuments({
        referrerUserId: userId,
        upgradedAt: { $ne: null },
        status: "active",
      }),
    ]);

  return {
    inspectorsReferred,
    successfulUpgrades,
    totalEarned: rewardBalance.totalEarned,
    paidOut,
    availableBalance: rewardBalance.availableBalance,
    pendingRewards: rewardBalance.pendingRewards,
  };
};

const getAvailableRewardsForAllocation = async (userId) => {
  await releaseMaturedReferralRewards(userId);

  return ReferralReward.find({
    referrerUserId: userId,
    status: "available",
    remainingAmount: { $gt: 0 },
  }).sort({ availableAt: 1, createdAt: 1 });
};

const allocateRewardAmount = async (userId, amount) => {
  const normalizedAmount = roundCurrency(amount);
  if (!normalizedAmount || normalizedAmount <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Amount must be greater than 0");
  }

  const rewards = await getAvailableRewardsForAllocation(userId);
  const totalAvailable = roundCurrency(
    rewards.reduce((sum, reward) => sum + (reward.remainingAmount || 0), 0)
  );

  if (normalizedAmount > totalAvailable) {
    throw new AppError(httpStatus.BAD_REQUEST, "Amount exceeds available balance");
  }

  let left = normalizedAmount;
  const allocations = [];

  for (const reward of rewards) {
    if (left <= 0) break;

    const current = roundCurrency(reward.remainingAmount || 0);
    if (current <= 0) continue;

    const used = roundCurrency(Math.min(current, left));
    reward.remainingAmount = roundCurrency(current - used);

    if (reward.remainingAmount <= 0) {
      reward.remainingAmount = 0;
      reward.status = "paid_out";
      reward.paidOutAt = new Date();
    }

    await reward.save();

    allocations.push({
      rewardId: reward._id,
      amount: used,
    });

    left = roundCurrency(left - used);
  }

  if (left > 0) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Unable to allocate full amount"
    );
  }

  return {
    amount: normalizedAmount,
    allocations,
    totalAvailable,
  };
};

const restoreRewardAllocation = async (allocations = []) => {
  for (const allocation of allocations) {
    const reward = await ReferralReward.findById(allocation.rewardId);
    if (!reward || reward.status === "voided") continue;

    reward.remainingAmount = roundCurrency(
      Number(reward.remainingAmount || 0) + Number(allocation.amount || 0)
    );
    reward.status = "available";
    reward.paidOutAt = null;
    await reward.save();
  }
};

export const convertAvailableBalanceToAppCredit = async ({ userId, amount }) => {
  const summary = await getReferralSummary(userId);
  const requestedAmount =
    amount !== undefined ? roundCurrency(amount) : roundCurrency(summary.availableBalance);

  if (!requestedAmount || requestedAmount <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No available balance to convert");
  }

  const allocationResult = await allocateRewardAmount(userId, requestedAmount);

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const before = roundCurrency(user.appCreditBalance || 0);
  const after = roundCurrency(before + allocationResult.amount);
  user.appCreditBalance = after;
  await user.save();

  const conversion = await ReferralCreditConversion.create({
    userId,
    amount: allocationResult.amount,
    currency: "USD",
    rewardAllocations: allocationResult.allocations,
    creditBalanceBefore: before,
    creditBalanceAfter: after,
    convertedAt: new Date(),
  });

  return {
    conversion,
    creditBalance: after,
  };
};

export const createCashPayoutRequest = async ({ userId, amount }) => {
  const summary = await getReferralSummary(userId);
  if (summary.availableBalance < CASH_PAYOUT_MIN_BALANCE) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Minimum available balance for cash payout is $${CASH_PAYOUT_MIN_BALANCE}`
    );
  }

  const requestedAmount =
    amount !== undefined ? roundCurrency(amount) : roundCurrency(summary.availableBalance);

  if (requestedAmount < CASH_PAYOUT_MIN_BALANCE) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Minimum cash payout request is $${CASH_PAYOUT_MIN_BALANCE}`
    );
  }

  const allocationResult = await allocateRewardAmount(userId, requestedAmount);

  const payoutRequest = await ReferralPayoutRequest.create({
    userId,
    amount: allocationResult.amount,
    currency: "USD",
    payoutMethod: "cash",
    status: "pending",
    rewardAllocations: allocationResult.allocations,
    requestedAt: new Date(),
  });

  return payoutRequest;
};

export const updateCashPayoutRequestStatus = async ({
  requestId,
  status,
  processedBy,
  notes,
}) => {
  const payoutRequest = await ReferralPayoutRequest.findById(requestId);
  if (!payoutRequest) {
    throw new AppError(httpStatus.NOT_FOUND, "Payout request not found");
  }

  const normalizedStatus = status?.toString().trim().toLowerCase();
  const allowed = ["approved", "rejected", "paid"];
  if (!allowed.includes(normalizedStatus)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid payout status");
  }

  if (payoutRequest.status === "rejected" || payoutRequest.status === "paid") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Payout request is already finalized"
    );
  }

  if (normalizedStatus === "rejected" && payoutRequest.status !== "rejected") {
    await restoreRewardAllocation(payoutRequest.rewardAllocations || []);
  }

  payoutRequest.status = normalizedStatus;
  payoutRequest.processedBy = processedBy || payoutRequest.processedBy;
  payoutRequest.notes = notes?.toString().trim() || payoutRequest.notes;
  payoutRequest.processedAt = new Date();
  await payoutRequest.save();

  return payoutRequest;
};

export const listReferralLedger = async ({ userId, page = 1, limit = 10 }) => {
  await releaseMaturedReferralRewards(userId);

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 10, 1);
  const skip = (safePage - 1) * safeLimit;

  const [rewards, rewardTotal, payouts, conversions] = await Promise.all([
    ReferralReward.find({ referrerUserId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ReferralReward.countDocuments({ referrerUserId: userId }),
    ReferralPayoutRequest.find({ userId }).sort({ createdAt: -1 }).limit(20).lean(),
    ReferralCreditConversion.find({ userId }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);

  return {
    rewards,
    payouts,
    conversions,
    meta: {
      page: safePage,
      limit: safeLimit,
      total: rewardTotal,
      totalPages: Math.ceil(rewardTotal / safeLimit) || 1,
    },
  };
};

export const listReferredUsers = async ({ userId, page = 1, limit = 10 }) => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 10, 1);
  const skip = (safePage - 1) * safeLimit;

  const [relationships, total] = await Promise.all([
    ReferralRelationship.find({ referrerUserId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("referredUserId", "name firstName lastName email createdAt")
      .lean(),
    ReferralRelationship.countDocuments({ referrerUserId: userId }),
  ]);

  const relationIds = relationships.map((item) => item._id);
  const rewards = relationIds.length
    ? await ReferralReward.find({ relationshipId: { $in: relationIds } }).lean()
    : [];

  const rewardMap = rewards.reduce((acc, reward) => {
    const key = reward.relationshipId.toString();
    if (!acc[key]) {
      acc[key] = {
        totalCommission: 0,
        pendingCommission: 0,
        availableCommission: 0,
        paidOutCommission: 0,
      };
    }

    const consumed = roundCurrency(
      Number(reward.commissionAmount || 0) - Number(reward.remainingAmount || 0)
    );

    acc[key].totalCommission = roundCurrency(
      acc[key].totalCommission + Number(reward.commissionAmount || 0)
    );

    if (reward.status === "pending") {
      acc[key].pendingCommission = roundCurrency(
        acc[key].pendingCommission + Number(reward.remainingAmount || 0)
      );
    }

    if (reward.status === "available") {
      acc[key].availableCommission = roundCurrency(
        acc[key].availableCommission + Number(reward.remainingAmount || 0)
      );
    }

    if (consumed > 0) {
      acc[key].paidOutCommission = roundCurrency(acc[key].paidOutCommission + consumed);
    }

    return acc;
  }, {});

  const items = relationships.map((relationship) => {
    const referred = relationship.referredUserId || {};
    const rewardInfo = rewardMap[relationship._id.toString()] || {
      totalCommission: 0,
      pendingCommission: 0,
      availableCommission: 0,
      paidOutCommission: 0,
    };

    return {
      relationshipId: relationship._id,
      referredUserId: referred._id || null,
      referredName:
        referred.name ||
        [referred.firstName, referred.lastName].filter(Boolean).join(" ") ||
        referred.email ||
        "User",
      referredEmail: referred.email || "",
      joinedAt: relationship.joinedAt || relationship.createdAt,
      upgradedAt: relationship.upgradedAt || null,
      status: relationship.status,
      disqualifiedReason: relationship.disqualifiedReason || "",
      commission: rewardInfo,
    };
  });

  return {
    users: items,
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
  };
};
