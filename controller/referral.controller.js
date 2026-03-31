import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { User } from "../model/user.model.js";
import { AppSetting } from "../model/appSetting.model.js";
import { ReferralPayoutRequest } from "../model/referralPayoutRequest.model.js";
import { ReferralRelationship } from "../model/referralRelationship.model.js";
import { ReferralReward } from "../model/referralReward.model.js";
import {
  CASH_PAYOUT_MIN_BALANCE,
  REFERRAL_DISCOUNT_RATE,
  REFERRAL_PENDING_DAYS,
  buildReferralLink,
  convertAvailableBalanceToAppCredit,
  createCashPayoutRequest,
  generateUniqueReferralCode,
  getReferralSummary,
  listReferralLedger,
  listReferredUsers,
  normalizeReferralCode,
  releaseMaturedReferralRewards,
  updateCashPayoutRequestStatus,
} from "../utils/referral.service.js";

const REFERRAL_PROGRAM_HEADLINE = "Help Your Friend Pass Their Certification";
const REFERRAL_PROGRAM_DESCRIPTION =
  "Invite someone preparing for API certification exams. If they register using your referral code and complete their first Professional Plan purchase, they get a discount and you earn referral commission on that purchase.";
const REFERRAL_SHARE_CHANNELS = [
  "copy_link",
  "whatsapp",
  "linkedin",
  "sms",
  "facebook",
  "instagram",
];

const normalizeCommissionRate = (value) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    return REFERRAL_DISCOUNT_RATE;
  }
  return rate;
};

const getReferralCommissionRate = async () => {
  const settings = await AppSetting.findOne().select("referralCommissionRate").lean();
  return normalizeCommissionRate(settings?.referralCommissionRate);
};

const buildReferralShareMessage = ({
  referralCode,
  referralLink,
  referralCommissionRate,
}) => {
  const lines = [
    "I have been using Inspectors Path to practice for API certification exams.",
    "",
    "The app has realistic exam questions and full exam simulations that help you prepare for the real API exam.",
    "",
    "If you are studying for API 510, 570, 653 or any API exams, it is worth checking out.",
    "",
    `Use my referral code and get ${Math.round(
      referralCommissionRate * 100
    )}% off your first Professional Plan purchase. When you complete that purchase, I also get a ${Math.round(
      referralCommissionRate * 100
    )}% referral commission bonus.`,
    "",
    "Open this referral link:",
    referralLink,
    "",
    `Referral Code: ${referralCode}`,
    "If the app is not installed yet, open the same link again after installation so the referral is attached automatically.",
  ];

  return lines.join("\n").trim();
};

const buildReferralProgramPayload = ({
  referralCode,
  referralLink,
  referralCommissionRate,
}) => ({
  headline: REFERRAL_PROGRAM_HEADLINE,
  description: REFERRAL_PROGRAM_DESCRIPTION,
  referrerCommissionPercent: Math.round(referralCommissionRate * 100),
  newUserDiscountPercent: Math.round(referralCommissionRate * 100),
  pendingPeriodDays: REFERRAL_PENDING_DAYS,
  minimumCashPayout: CASH_PAYOUT_MIN_BALANCE,
  statusGuide: {
    pending:
      REFERRAL_PENDING_DAYS > 0
        ? "Commission is waiting for the pending window to pass."
        : "No pending wait. Commission becomes available right after the eligible purchase.",
    available: "Commission is ready for conversion or cash payout.",
    paid_out: "Commission has already been converted or paid out.",
  },
  shareChannels: REFERRAL_SHARE_CHANNELS,
  shareMessage: buildReferralShareMessage({
    referralCode,
    referralLink,
    referralCommissionRate,
  }),
});

const buildReferralActionPayload = (summary) => ({
  canConvertToAppCredit: Number(summary?.availableBalance || 0) > 0,
  canRequestCashPayout:
    Number(summary?.availableBalance || 0) >= CASH_PAYOUT_MIN_BALANCE,
  minimumCashPayout: CASH_PAYOUT_MIN_BALANCE,
});

const FINALIZED_PAYMENT_REWARD_MATCH = {
  status: { $in: ["available", "paid_out"] },
  commissionAmount: { $gt: 0 },
  relationshipId: { $ne: null },
  planPurchaseId: { $ne: null },
};

const resolveRequestBaseUrl = (req) => {
  const configuredBase =
    process.env.REFERRAL_LINK_BASE_URL ||
    process.env.CLIENT_URL ||
    process.env.APP_URL ||
    "";

  const normalizedConfiguredBase = configuredBase.trim();
  if (
    normalizedConfiguredBase &&
    !/localhost|127\.0\.0\.1/i.test(normalizedConfiguredBase)
  ) {
    return normalizedConfiguredBase;
  }

  const host = req.get("x-forwarded-host") || req.get("host") || "";
  if (!host) {
    return normalizedConfiguredBase;
  }

  const protocol =
    req.get("x-forwarded-proto") ||
    (req.secure ? "https" : req.protocol || "http");

  return `${protocol}://${host}`;
};

const ensureUserReferralIdentity = async (userId) => {
  const user = await User.findById(userId).select("referralCode appCreditBalance");
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (!user.referralCode) {
    user.referralCode = await generateUniqueReferralCode();
    await user.save();
  }

  return user;
};

export const getMyReferralProfile = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const user = await ensureUserReferralIdentity(userId);
  const [summary, referralCommissionRate] = await Promise.all([
    getReferralSummary(userId),
    getReferralCommissionRate(),
  ]);
  const referralLink = buildReferralLink(
    user.referralCode,
    resolveRequestBaseUrl(req)
  );
  const program = buildReferralProgramPayload({
    referralCode: user.referralCode,
    referralLink,
    referralCommissionRate,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral profile fetched",
    data: {
      referralCode: user.referralCode,
      referralLink,
      appCreditBalance: Number(user.appCreditBalance || 0),
      earnings: summary,
      actions: buildReferralActionPayload(summary),
      program,
    },
  });
});

export const getMyReferralProgram = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const user = await ensureUserReferralIdentity(userId);
  const referralCommissionRate = await getReferralCommissionRate();
  const referralLink = buildReferralLink(
    user.referralCode,
    resolveRequestBaseUrl(req)
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral program config fetched",
    data: buildReferralProgramPayload({
      referralCode: user.referralCode,
      referralLink,
      referralCommissionRate,
    }),
  });
});

export const getPublicReferralCode = catchAsync(async (req, res) => {
  const referralCode = normalizeReferralCode(req.params.code);
  if (!referralCode) {
    throw new AppError(httpStatus.BAD_REQUEST, "Referral code is required");
  }

  const referrer = await User.findOne({
    referralCode,
    status: "active",
  }).select("name firstName lastName referralCode");

  if (!referrer) {
    throw new AppError(httpStatus.NOT_FOUND, "Referral code not found");
  }

  const referrerName =
    referrer.name ||
    [referrer.firstName, referrer.lastName].filter(Boolean).join(" ") ||
    "Inspector";
  const referralCommissionRate = await getReferralCommissionRate();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral code is valid",
    data: {
      referralCode: referrer.referralCode,
      referralLink: buildReferralLink(
        referrer.referralCode,
        resolveRequestBaseUrl(req)
      ),
      referrerName,
      discountPercent: Math.round(referralCommissionRate * 100),
      appliesTo: "professional_plan_upgrade",
    },
  });
});

export const getMyReferredUsers = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const data = await listReferredUsers({
    userId,
    page: req.query.page,
    limit: req.query.limit,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referred users fetched",
    data,
  });
});

export const getMyReferralLedger = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const data = await listReferralLedger({
    userId,
    page: req.query.page,
    limit: req.query.limit,
  });
  const summary = await getReferralSummary(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral ledger fetched",
    data: {
      ...data,
      earnings: summary,
      actions: buildReferralActionPayload(summary),
    },
  });
});

export const convertReferralBalanceToCredit = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const amount =
    req.body?.amount !== undefined && req.body?.amount !== null
      ? Number(req.body.amount)
      : undefined;

  if (amount !== undefined && (Number.isNaN(amount) || amount <= 0)) {
    throw new AppError(httpStatus.BAD_REQUEST, "amount must be a positive number");
  }

  const result = await convertAvailableBalanceToAppCredit({ userId, amount });
  const summary = await getReferralSummary(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral balance converted to app credit",
    data: {
      conversion: result.conversion,
      appCreditBalance: result.creditBalance,
      earnings: summary,
    },
  });
});

export const requestReferralCashPayout = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const amount =
    req.body?.amount !== undefined && req.body?.amount !== null
      ? Number(req.body.amount)
      : undefined;

  if (amount !== undefined && (Number.isNaN(amount) || amount <= 0)) {
    throw new AppError(httpStatus.BAD_REQUEST, "amount must be a positive number");
  }

  const payoutRequest = await createCashPayoutRequest({ userId, amount });
  const summary = await getReferralSummary(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cash payout request created",
    data: {
      payoutRequest,
      earnings: summary,
    },
  });
});

export const listReferralPayoutRequestsAdmin = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status.toString().trim().toLowerCase();
  }

  const [items, total] = await Promise.all([
    ReferralPayoutRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name firstName lastName email referralCode")
      .populate("processedBy", "name firstName lastName email")
      .lean(),
    ReferralPayoutRequest.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral payout requests fetched",
    data: {
      requests: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

export const updateReferralPayoutRequestStatusAdmin = catchAsync(async (req, res) => {
  const status = req.body?.status;
  if (!status) {
    throw new AppError(httpStatus.BAD_REQUEST, "status is required");
  }

  const payoutRequest = await updateCashPayoutRequestStatus({
    requestId: req.params.requestId,
    status,
    processedBy: req.user?._id,
    notes: req.body?.notes,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payout request status updated",
    data: payoutRequest,
  });
});

export const getReferralOverviewAdmin = catchAsync(async (_req, res) => {
  await releaseMaturedReferralRewards();

  const [totalSharedReferrals, usedReferralsAgg, earningsAgg] = await Promise.all([
    ReferralRelationship.countDocuments(),
    ReferralReward.aggregate([
      { $match: FINALIZED_PAYMENT_REWARD_MATCH },
      { $group: { _id: "$relationshipId" } },
      { $count: "total" },
    ]),
    ReferralReward.aggregate([
      { $match: FINALIZED_PAYMENT_REWARD_MATCH },
      { $group: { _id: null, total: { $sum: "$commissionAmount" } } },
    ]),
  ]);

  const totalUsedReferrals = Number(usedReferralsAgg?.[0]?.total || 0);
  const totalEarnings =
    Math.round((Number(earningsAgg?.[0]?.total || 0) + Number.EPSILON) * 100) / 100;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral overview fetched",
    data: {
      totalSharedReferrals,
      totalUsedReferrals,
      totalEarnings,
    },
  });
});

const formatUserLite = (user) => {
  if (!user) {
    return { id: null, name: "Unknown", email: "" };
  }
  return {
    id: user._id || null,
    name:
      user.name ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.email ||
      "Unknown",
    email: user.email || "",
  };
};

export const listReferralUsageAdmin = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;
  const kind = (req.query.kind || "shared").toString().trim().toLowerCase();

  if (!["shared", "used"].includes(kind)) {
    throw new AppError(httpStatus.BAD_REQUEST, "kind must be either 'shared' or 'used'");
  }

  if (kind === "shared") {
    const [relationships, total] = await Promise.all([
      ReferralRelationship.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("referrerUserId", "name firstName lastName email")
        .populate("referredUserId", "name firstName lastName email")
        .lean(),
      ReferralRelationship.countDocuments(),
    ]);

    const relationshipIds = relationships.map((relationship) => relationship._id).filter(Boolean);

    const rewardAgg = relationshipIds.length
      ? await ReferralReward.aggregate([
          {
            $match: {
              ...FINALIZED_PAYMENT_REWARD_MATCH,
              relationshipId: { $in: relationshipIds },
            },
          },
          {
            $group: {
              _id: "$relationshipId",
              totalEarnings: { $sum: "$commissionAmount" },
              usedAt: { $max: "$createdAt" },
            },
          },
        ])
      : [];

    const rewardsByRelationshipId = rewardAgg.reduce((acc, entry) => {
      acc[entry._id?.toString?.() || ""] = entry;
      return acc;
    }, {});

    const items = relationships.map((relationship) => {
      const rewardEntry = rewardsByRelationshipId[relationship._id?.toString?.() || ""];

      return {
        relationshipId: relationship._id,
        referralCode: relationship.referralCode || "",
        referrer: formatUserLite(relationship.referrerUserId),
        referred: formatUserLite(relationship.referredUserId),
        joinedAt: relationship.joinedAt || relationship.createdAt || null,
        usedAt: rewardEntry?.usedAt || null,
        totalEarnings:
          Math.round((Number(rewardEntry?.totalEarnings || 0) + Number.EPSILON) * 100) / 100,
        isUsed: Boolean(rewardEntry),
      };
    });

    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Shared referral relationships fetched",
      data: {
        kind,
        items,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  }

  const usedBasePipeline = [
    { $match: FINALIZED_PAYMENT_REWARD_MATCH },
    {
      $group: {
        _id: "$relationshipId",
        totalEarnings: { $sum: "$commissionAmount" },
        usedAt: { $max: "$createdAt" },
      },
    },
    { $sort: { usedAt: -1 } },
  ];

  const [countAgg, pageAgg] = await Promise.all([
    ReferralReward.aggregate([...usedBasePipeline, { $count: "total" }]),
    ReferralReward.aggregate([...usedBasePipeline, { $skip: skip }, { $limit: limit }]),
  ]);

  const total = Number(countAgg?.[0]?.total || 0);
  const relationshipIds = pageAgg.map((item) => item._id).filter(Boolean);

  const relationships = relationshipIds.length
    ? await ReferralRelationship.find({ _id: { $in: relationshipIds } })
        .populate("referrerUserId", "name firstName lastName email")
        .populate("referredUserId", "name firstName lastName email")
        .lean()
    : [];

  const relationshipById = relationships.reduce((acc, relationship) => {
    acc[relationship._id.toString()] = relationship;
    return acc;
  }, {});

  const items = pageAgg
    .map((entry) => {
      const relationship = relationshipById[entry._id?.toString?.() || ""];
      if (!relationship) return null;

      return {
        relationshipId: relationship._id,
        referralCode: relationship.referralCode || "",
        referrer: formatUserLite(relationship.referrerUserId),
        referred: formatUserLite(relationship.referredUserId),
        joinedAt: relationship.joinedAt || relationship.createdAt || null,
        usedAt: entry.usedAt || relationship.upgradedAt || null,
        totalEarnings:
          Math.round((Number(entry.totalEarnings || 0) + Number.EPSILON) * 100) / 100,
        isUsed: true,
      };
    })
    .filter(Boolean);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Used referral relationships fetched",
    data: {
      kind,
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

export const deleteReferralRelationshipAdmin = catchAsync(async (req, res) => {
  const relationshipId = req.params.relationshipId;
  if (!relationshipId) {
    throw new AppError(httpStatus.BAD_REQUEST, "relationshipId is required");
  }

  const relationship = await ReferralRelationship.findById(relationshipId).lean();
  if (!relationship) {
    throw new AppError(httpStatus.NOT_FOUND, "Referral relationship not found");
  }

  const rewardExists = await ReferralReward.exists({
    relationshipId: relationship._id,
  });

  if (rewardExists) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot delete referral relationship that already has reward records"
    );
  }

  await Promise.all([
    ReferralRelationship.deleteOne({ _id: relationship._id }),
    User.updateOne(
      { _id: relationship.referredUserId },
      {
        $set: {
          referredBy: null,
          referredByCode: "",
          referredAt: null,
        },
      }
    ),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral relationship deleted",
    data: {
      relationshipId,
    },
  });
});
