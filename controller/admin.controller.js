import httpStatus from "http-status";
import mongoose from "mongoose";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { User } from "../model/user.model.js";
import { ExamAccess } from "../model/examAccess.model.js";

const buildDateLabels = (days = 7) => {
  const labels = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(d.toISOString().slice(0, 10));
  }
  return labels;
};

const formatUserName = (u) =>
  u.name ||
  [u.firstName, u.lastName].filter(Boolean).join(" ") ||
  u.email ||
  "User";

export const getDashboardOverview = catchAsync(async (req, res) => {
  if (!req.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  // Unlock data
  const unlockedUserIds = await ExamAccess.distinct("userId", {
    status: "unlocked",
    paymentStatus: "completed",
  });
  const unlockedSet = new Set(unlockedUserIds.map((id) => id.toString()));

  // Totals
  const totalUsers = await User.countDocuments({ role: "user" });
  const totalProfessional = unlockedUserIds.length;
  const totalStarter = Math.max(totalUsers - totalProfessional, 0);

  // Revenue
  const [revenueAgg] = await ExamAccess.aggregate([
    {
      $match: {
        status: "unlocked",
        paymentStatus: "completed",
      },
    },
    { $group: { _id: null, revenue: { $sum: "$purchasePrice" } } },
  ]);
  const totalRevenue = revenueAgg?.revenue || 0;

  // Daily revenue (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const dailyAgg = await ExamAccess.aggregate([
    {
      $match: {
        status: "unlocked",
        paymentStatus: "completed",
        createdAt: { $gte: sevenDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        revenue: { $sum: "$purchasePrice" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  const dailyMap = dailyAgg.reduce((acc, cur) => {
    acc[cur._id] = cur;
    return acc;
  }, {});
  const dailyLabels = buildDateLabels(7);
  const dailyRevenue = dailyLabels.map((label) => ({
    date: label,
    revenue: dailyMap[label]?.revenue || 0,
    count: dailyMap[label]?.count || 0,
  }));

  // Spend per user for recent list
  const spendAgg = await ExamAccess.aggregate([
    {
      $match: {
        paymentStatus: "completed",
      },
    },
    {
      $group: {
        _id: "$userId",
        total: { $sum: "$purchasePrice" },
      },
    },
  ]);
  const spendMap = spendAgg.reduce((acc, cur) => {
    acc[cur._id.toString()] = cur.total || 0;
    return acc;
  }, {});

  // Recent users
  const recentUsers = await User.find({ role: "user" })
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  const recent = recentUsers.map((u) => {
    const id = u._id.toString();
    return {
      id,
      name: formatUserName(u),
      email: u.email,
      joinedAt: u.createdAt,
      payable: spendMap[id] || 0,
      plan: unlockedSet.has(id) ? "Professional" : "Starter",
      status: u.status,
    };
  });

  const freeCount = totalStarter;
  const proCount = totalProfessional;
  const totalSubs = freeCount + proCount || 1;
  const freePercent = Number(((freeCount / totalSubs) * 100).toFixed(2));
  const proPercent = Number(((proCount / totalSubs) * 100).toFixed(2));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard overview fetched",
    data: {
      totals: {
        totalUsers,
        totalStarter,
        totalProfessional,
        totalRevenue,
      },
      revenue: {
        dailyRevenue,
      },
      subscriptionBreakdown: {
        freeCount,
        proCount,
        freePercent,
        proPercent,
      },
      recentUsers: recent,
    },
  });
});
