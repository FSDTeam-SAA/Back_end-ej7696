import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { User } from "../model/user.model.js";
import { ReferralPayoutRequest } from "../model/referralPayoutRequest.model.js";
import { ReferralRelationship } from "../model/referralRelationship.model.js";
import { ReferralReward } from "../model/referralReward.model.js";
import {
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
  const summary = await getReferralSummary(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral profile fetched",
    data: {
      referralCode: user.referralCode,
      referralLink: buildReferralLink(user.referralCode),
      appCreditBalance: Number(user.appCreditBalance || 0),
      earnings: summary,
    },
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

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral code is valid",
    data: {
      referralCode: referrer.referralCode,
      referralLink: buildReferralLink(referrer.referralCode),
      referrerName,
      discountPercent: 10,
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

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral ledger fetched",
    data,
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

  const [
    totalRelationships,
    activeRelationships,
    disqualifiedRelationships,
    pendingRewards,
    availableRewards,
    payoutPending,
  ] = await Promise.all([
    ReferralRelationship.countDocuments(),
    ReferralRelationship.countDocuments({ status: "active" }),
    ReferralRelationship.countDocuments({ status: "disqualified" }),
    ReferralReward.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, total: { $sum: "$remainingAmount" } } },
    ]),
    ReferralReward.aggregate([
      { $match: { status: "available" } },
      { $group: { _id: null, total: { $sum: "$remainingAmount" } } },
    ]),
    ReferralPayoutRequest.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral overview fetched",
    data: {
      totalRelationships,
      activeRelationships,
      disqualifiedRelationships,
      pendingRewards: Number(pendingRewards?.[0]?.total || 0),
      availableRewards: Number(availableRewards?.[0]?.total || 0),
      payoutPendingAmount: Number(payoutPending?.[0]?.total || 0),
      payoutPendingCount: Number(payoutPending?.[0]?.count || 0),
    },
  });
});
