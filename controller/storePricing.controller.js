import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { StorePriceUpdate } from "../model/storePriceUpdate.model.js";
import {
  createStorePriceUpdateJob,
  queueStorePriceUpdateJob,
} from "../utils/storePricing.service.js";

const TARGETS = new Set(["professional_plan", "exam_unlock"]);

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
