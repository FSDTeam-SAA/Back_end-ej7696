import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { StorePriceUpdate } from "../model/storePriceUpdate.model.js";
import { Exam } from "../model/exam.model.js";
import {
  STORE_PRICE_CATALOG,
  createStorePriceUpdateJob,
  queueStorePriceUpdateJob,
} from "../utils/storePricing.service.js";

const TARGETS = new Set(["professional_plan", "exam_unlock"]);

export const saveExamStoreProducts = catchAsync(async (req, res) => {
  const exam = await Exam.findById(req.params.examId).catch(() => null);
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");
  const fields = ["appleProductId", "googleProductId", "googleBasePlanId", "revenueCatAppleProductId", "revenueCatGoogleProductId"];
  const products = Object.fromEntries(fields.map((field) => [field, String(req.body?.[field] || "").trim()]));
  if (!products.appleProductId || !products.googleProductId || !products.googleBasePlanId ||
      !products.revenueCatAppleProductId || !products.revenueCatGoogleProductId) {
    throw new AppError(httpStatus.BAD_REQUEST, "All Apple, Google Play, and RevenueCat product IDs are required");
  }
  if (Object.values(products).some((value) => !/^[A-Za-z0-9._:-]{2,200}$/.test(value))) {
    throw new AppError(httpStatus.BAD_REQUEST, "Product IDs may contain letters, numbers, dots, underscores, colons, and hyphens");
  }
  const googleStoreId = `${products.googleProductId}:${products.googleBasePlanId}`;
  const reserved = STORE_PRICE_CATALOG.exam_unlock;
  const reservedIds = new Set([
    ...reserved.apple.map((item) => item.productId),
    ...reserved.apple.map((item) => item.productId.replace(/\.onemonth$/, ".sixmonth")),
    ...reserved.apple.map((item) => item.productId.replace(/\.onemonth$/, ".unlock")),
    ...reserved.google.map((item) => `${item.productId}:${item.basePlanId}`),
    ...reserved.google.map((item) => `${item.productId}:${item.basePlanId.replace(/onemonth$/, "sixmonth")}`),
    ...STORE_PRICE_CATALOG.professional_plan.apple.map((item) => item.productId),
    ...STORE_PRICE_CATALOG.professional_plan.google.map((item) => `${item.productId}:${item.basePlanId}`),
    "six_month_subscriptions",
    "six_month_subscriptions:six-month",
  ]);
  if ([products.appleProductId, googleStoreId, products.revenueCatAppleProductId,
      products.revenueCatGoogleProductId].some((id) => reservedIds.has(id))) {
    throw new AppError(httpStatus.CONFLICT, "This store product ID is already assigned to a built-in exam");
  }
  const duplicate = await Exam.exists({
    _id: { $ne: exam._id },
    $or: [
      { "storeProducts.appleProductId": products.appleProductId },
      { "storeProducts.googleProductId": products.googleProductId, "storeProducts.googleBasePlanId": products.googleBasePlanId },
      { "storeProducts.revenueCatAppleProductId": products.revenueCatAppleProductId },
      { "storeProducts.revenueCatGoogleProductId": products.revenueCatGoogleProductId },
    ],
  });
  if (duplicate) throw new AppError(httpStatus.CONFLICT, "A product ID is already assigned to another exam");
  exam.storeProducts = products;
  await exam.save();
  sendResponse(res, { statusCode: httpStatus.OK, success: true, message: "Exam store products saved", data: exam });
});

const parsePrice = (value) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0 || price > 10000) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Price must be a positive USD amount not greater than 10000"
    );
  }
  const rounded = Math.round(price * 100) / 100;
  if (Math.abs(price - rounded) > Number.EPSILON) {
    throw new AppError(httpStatus.BAD_REQUEST, "Price can have at most two decimal places");
  }
  return rounded;
};

export const startCoordinatedPriceUpdate = catchAsync(async (req, res) => {
  const target = req.body.target?.toString().trim().toLowerCase();
  if (!TARGETS.has(target)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "target must be professional_plan or exam_unlock"
    );
  }
  const currency = (req.body.currency || "USD").toString().trim().toUpperCase();
  if (currency !== "USD") {
    throw new AppError(httpStatus.BAD_REQUEST, "Only USD pricing is supported");
  }
  const newPrice = parsePrice(req.body.price);
  const active = await StorePriceUpdate.exists({
    target,
    status: { $in: ["queued", "running"] },
  });
  if (active) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A coordinated price update is already running for this target"
    );
  }
  const job = await createStorePriceUpdateJob({
    target,
    newPrice,
    initiatedBy: req.user._id,
  });
  queueStorePriceUpdateJob(job._id);
  sendResponse(res, {
    statusCode: httpStatus.ACCEPTED,
    success: true,
    message: "Coordinated store price update queued",
    data: job,
  });
});

export const listCoordinatedPriceUpdates = catchAsync(async (req, res) => {
  const target = req.query.target?.toString().trim().toLowerCase();
  if (target && !TARGETS.has(target)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid price update target");
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = target ? { target } : {};
  const jobs = await StorePriceUpdate.find(filter)
    .populate("initiatedBy", "name email role")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coordinated price update history fetched",
    data: jobs,
  });
});

export const getCoordinatedPriceUpdate = catchAsync(async (req, res) => {
  const job = await StorePriceUpdate.findById(req.params.jobId)
    .populate("initiatedBy", "name email role")
    .lean();
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Price update job not found");
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coordinated price update fetched",
    data: job,
  });
});

export const deleteCoordinatedPriceUpdate = catchAsync(async (req, res) => {
  const job = await StorePriceUpdate.findById(req.params.jobId);
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Price update job not found");
  if (!["failed", "partial"].includes(job.status)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Only failed or partial price update history can be deleted"
    );
  }
  await job.deleteOne();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Failed price update history deleted",
    data: { id: job._id },
  });
});

export const retryCoordinatedPriceUpdate = catchAsync(async (req, res) => {
  const job = await StorePriceUpdate.findById(req.params.jobId);
  if (!job) throw new AppError(httpStatus.NOT_FOUND, "Price update job not found");
  if (["queued", "running"].includes(job.status)) {
    throw new AppError(httpStatus.CONFLICT, "This price update is already running");
  }
  if (job.status === "completed") {
    throw new AppError(httpStatus.CONFLICT, "This price update is already complete");
  }
  const active = await StorePriceUpdate.exists({
    _id: { $ne: job._id },
    target: job.target,
    status: { $in: ["queued", "running"] },
  });
  if (active) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Another coordinated price update is already running for this target"
    );
  }
  job.status = "queued";
  job.retryCount += 1;
  job.lastError = "";
  job.completedAt = null;
  if (job.apple.status !== "confirmed") job.apple.status = "pending";
  if (job.google.status !== "confirmed") job.google.status = "pending";
  if (job.database.status !== "confirmed") job.database.status = "pending";
  await job.save();
  queueStorePriceUpdateJob(job._id);
  sendResponse(res, {
    statusCode: httpStatus.ACCEPTED,
    success: true,
    message: "Price update retry queued",
    data: job,
  });
});
