import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { Exam } from "../model/exam.model.js";

const parseStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["active", "inactive"].includes(normalized)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status must be active or inactive");
  }
  return normalized;
};

const sanitizeExam = (doc) => {
  if (!doc) return doc;
  return doc.toObject ? doc.toObject() : doc;
};

const listExams = async (filter = {}, pageQuery, limitQuery) => {
  const page = Math.max(parseInt(pageQuery, 10) || 1, 1);
  const limit = Math.max(parseInt(limitQuery, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const [exams, total] = await Promise.all([
    Exam.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Exam.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    exams: exams.map(sanitizeExam),
    meta: { page, limit, total, totalPages },
  };
};

export const createExam = catchAsync(async (req, res) => {
  const { name, effectivitySheetContent, bodyOfKnowledgeContent } = req.body;
  const status = parseStatus(req.body.status);

  if (!name) {
    throw new AppError(httpStatus.BAD_REQUEST, "Exam name is required");
  }

  let image = { public_id: "", url: "" };
  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    image = { public_id: upload.public_id, url: upload.secure_url };
  }

  const exam = await Exam.create({
    name,
    effectivitySheetContent,
    bodyOfKnowledgeContent,
    status: status || "active",
    image,
    createdBy: req.user?._id || null,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam created successfully",
    data: sanitizeExam(exam),
  });
});

export const getActiveExams = catchAsync(async (req, res) => {
  const data = await listExams(
    { status: "active" },
    req.query.page,
    req.query.limit
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Active exams fetched",
    data,
  });
});

export const getAllExamsAdmin = catchAsync(async (req, res) => {
  const statusFilter = parseStatus(req.query.status);
  const filter = {};
  if (statusFilter) filter.status = statusFilter;

  const data = await listExams(filter, req.query.page, req.query.limit);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All exams fetched",
    data,
  });
});

export const updateExam = catchAsync(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");

  const allowedFields = [
    "name",
    "effectivitySheetContent",
    "bodyOfKnowledgeContent",
  ];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      exam[field] = req.body[field];
    }
  });

  if (req.body.status !== undefined) {
    exam.status = parseStatus(req.body.status);
  }

  if (req.file) {
    const upload = await uploadOnCloudinary(req.file.buffer);
    exam.image = { public_id: upload.public_id, url: upload.secure_url };
  }

  await exam.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam updated successfully",
    data: sanitizeExam(exam),
  });
});

export const deleteExam = catchAsync(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");

  await exam.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam deleted successfully",
    data: null,
  });
});
