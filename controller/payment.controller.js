 import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Exam } from "../model/exam.model.js";
import { ExamAccess } from "../model/examAccess.model.js";
import { User } from "../model/user.model.js";

const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const EXAM_PRICE = Number(process.env.EXAM_PRICE_PER_EXAM) || 150;
const CURRENCY = process.env.EXAM_PRICE_CURRENCY || "USD";

const getPayPalAccessToken = async () => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "PayPal credentials not configured"
    );
  }
  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to authenticate with PayPal");
  }
  return data.access_token;
};

export const createExamPayPalOrder = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  const examId = req.params.examId;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!examId) throw new AppError(httpStatus.BAD_REQUEST, "examId is required");

  const exam = await Exam.findById(examId).lean();
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");

  const existingAccess = await ExamAccess.findOne({ userId, examId });
  if (existingAccess?.status === "unlocked") {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Exam already unlocked",
      data: { unlocked: true },
    });
  }

  const token = await getPayPalAccessToken();

  const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: CURRENCY,
            value: EXAM_PRICE.toFixed(2),
          },
          description: `Unlock exam: ${exam.name}`,
        },
      ],
      application_context: {
        brand_name: "Exam Unlock",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
      },
    }),
  });

  const orderData = await orderRes.json().catch(() => null);
  if (!orderRes.ok || !orderData?.id) {
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to create PayPal order");
  }

  await ExamAccess.findOneAndUpdate(
    { userId, examId },
    {
      userId,
      examId,
      status: "free",
      paymentStatus: "pending",
      paypalOrderId: orderData.id,
      purchasePrice: EXAM_PRICE,
      maxQuestionsPerSession: 2,
    },
    { upsert: true }
  );

  const approvalLink =
    orderData.links?.find((l) => l.rel === "approve")?.href || null;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "PayPal order created",
    data: {
      orderId: orderData.id,
      approvalLink,
      amount: EXAM_PRICE,
      currency: CURRENCY,
    },
  });
});

export const captureExamPayPalOrder = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  const examId = req.params.examId;
  const { orderId } = req.body;

  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  if (!examId || !orderId) {
    throw new AppError(httpStatus.BAD_REQUEST, "examId and orderId are required");
  }

  const accessDoc = await ExamAccess.findOne({ userId, examId });
  if (accessDoc?.status === "unlocked") {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Exam already unlocked",
      data: { unlocked: true },
    });
  }

  const token = await getPayPalAccessToken();

  const captureRes = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const captureData = await captureRes.json().catch(() => null);
  if (!captureRes.ok) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Failed to capture PayPal order"
    );
  }

  const purchaseState =
    captureData?.status ||
    captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.status;

  if (!["COMPLETED"].includes(purchaseState)) {
    throw new AppError(httpStatus.BAD_GATEWAY, "PayPal capture not completed");
  }

  const updatedAccess = await ExamAccess.findOneAndUpdate(
    { userId, examId },
    {
      userId,
      examId,
      status: "unlocked",
      paymentStatus: "completed",
      paypalOrderId: orderId,
      purchasePrice: EXAM_PRICE,
      maxQuestionsPerSession: 20,
      purchasedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam unlocked",
    data: {
      unlocked: true,
      access: updatedAccess,
    },
  });
});

export const getRevenueSummary = catchAsync(async (req, res) => {
  const [revenueAgg] = await ExamAccess.aggregate([
    {
      $match: {
        status: "unlocked",
        paymentStatus: "completed",
      },
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$purchasePrice" },
        totalUnlockedExams: { $sum: 1 },
      },
    },
  ]);

  const totalRevenue = revenueAgg?.totalRevenue || 0;
  const totalUnlockedExams = revenueAgg?.totalUnlockedExams || 0;

  const totalFreeExams = await ExamAccess.countDocuments({ status: "free" });

  const today = new Date();
  const startDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 6
  );

  const dailyRevenue = await ExamAccess.aggregate([
    {
      $match: {
        status: "unlocked",
        paymentStatus: "completed",
        createdAt: { $gte: startDate },
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

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Revenue summary fetched",
    data: {
      totalRevenue,
      totalUnlockedExams,
      totalFreeExams,
      dailyRevenue,
    },
  });
});

export const listPurchases = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  if (req.query.examId) filter.examId = req.query.examId;
  if (req.query.userId) filter.userId = req.query.userId;

  const [items, total] = await Promise.all([
    ExamAccess.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ExamAccess.countDocuments(filter),
  ]);

  const userIds = [
    ...new Set(items.map((i) => i.userId?.toString()).filter(Boolean)),
  ];
  const examIds = [
    ...new Set(items.map((i) => i.examId?.toString()).filter(Boolean)),
  ];

  const [users, exams] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("name email firstName lastName")
          .lean()
      : [],
    examIds.length
      ? Exam.find({ _id: { $in: examIds } }).select("name").lean()
      : [],
  ]);

  const userMap = {};
  users.forEach((u) => {
    userMap[u._id.toString()] = {
      name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
      email: u.email,
    };
  });

  const examMap = {};
  exams.forEach((e) => {
    examMap[e._id.toString()] = e.name;
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchases fetched",
    data: {
      purchases: items.map((i) => ({
        id: i._id,
        user: userMap[i.userId?.toString()] || null,
        examName: examMap[i.examId?.toString()] || null,
        examId: i.examId,
        status: i.status,
        paymentStatus: i.paymentStatus,
        price: i.purchasePrice,
        maxQuestionsPerSession: i.maxQuestionsPerSession,
        purchasedAt: i.purchasedAt,
        createdAt: i.createdAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});
