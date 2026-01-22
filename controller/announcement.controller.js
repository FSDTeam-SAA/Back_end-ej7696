import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { Announcement } from "../model/announcement.model.js";

const parseStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["visible", "hidden"].includes(normalized)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Status must be visible or hidden"
    );
  }
  return normalized;
};

const sanitizeAnnouncement = (doc) => {
  if (!doc) return doc;
  return doc.toObject ? doc.toObject() : doc;
};

const emitAnnouncementEvent = (req, event, payload) => {
  const io = req.app?.get("io");
  if (io) {
    io.to("alerts").emit(event, payload);
  }
};

const listAnnouncements = async (filter = {}, pageQuery, limitQuery) => {
  const page = Math.max(parseInt(pageQuery, 10) || 1, 1);
  const limit = Math.max(parseInt(limitQuery, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const [announcements, total] = await Promise.all([
    Announcement.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Announcement.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    announcements: announcements.map(sanitizeAnnouncement),
    meta: { page, limit, total, totalPages },
  };
};

export const createAnnouncement = catchAsync(async (req, res) => {
  const message = req.body.message?.toString().trim();
  if (!message) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Announcement message is required"
    );
  }

  const announcement = await Announcement.create({
    message,
    status: "visible",
    createdBy: req.user?._id || null,
  });

  const sanitized = sanitizeAnnouncement(announcement);
  emitAnnouncementEvent(req, "announcement:new", sanitized);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Announcement created and sent to all users",
    data: sanitized,
  });
});

export const getPublicAnnouncements = catchAsync(async (req, res) => {
  const data = await listAnnouncements(
    { status: "visible" },
    req.query.page,
    req.query.limit
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Visible announcements fetched",
    data,
  });
});

export const getAnnouncementsAdmin = catchAsync(async (req, res) => {
  const statusFilter = parseStatus(req.query.status);
  const filter = {};
  if (statusFilter) filter.status = statusFilter;

  const data = await listAnnouncements(filter, req.query.page, req.query.limit);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Announcements fetched",
    data,
  });
});

export const updateAnnouncementStatus = catchAsync(async (req, res) => {
  const status = parseStatus(req.body.status);
  if (!status) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status is required");
  }

  const announcement = await Announcement.findById(req.params.id);
  if (!announcement)
    throw new AppError(httpStatus.NOT_FOUND, "Announcement not found");

  announcement.status = status;
  announcement.hiddenAt = status === "hidden" ? new Date() : null;
  await announcement.save();

  const sanitized = sanitizeAnnouncement(announcement);
  emitAnnouncementEvent(req, "announcement:status", {
    _id: sanitized._id,
    status: sanitized.status,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Announcement status updated",
    data: sanitized,
  });
});

export const deleteAnnouncement = catchAsync(async (req, res) => {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement)
    throw new AppError(httpStatus.NOT_FOUND, "Announcement not found");

  await announcement.deleteOne();
  emitAnnouncementEvent(req, "announcement:deleted", { _id: req.params.id });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Announcement deleted",
    data: null,
  });
});
