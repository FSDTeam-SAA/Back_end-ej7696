import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { ExamAttempt } from "../model/examAttempt.model.js";
import { Exam } from "../model/exam.model.js";

const buildDateRangeFilter = (from, to) => {
  const filter = {};
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    filter.$gte = fromDate;
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    filter.$lte = toDate;
  }
  return Object.keys(filter).length ? filter : null;
};

export const getOverview = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");

  const attempts = await ExamAttempt.find({ userId }).select(
    "score status startedAt endedAt"
  );

  const totalAttempts = attempts.length;
  const scores = attempts
    .map((a) => (typeof a.score === "number" ? a.score : null))
    .filter((s) => s !== null);
  const avgScore = scores.length
    ? Number((scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(2))
    : 0;
  const bestScore = scores.length ? Math.max(...scores) : 0;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Overview fetched",
    data: {
      totalAttempts,
      avgScore,
      bestScore,
      streak: null,
    },
  });
});

export const getPerformance = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");

  const { examId, from, to } = req.query;
  const filter = { userId };
  if (examId) filter.examId = examId;

  const dateFilter = buildDateRangeFilter(from, to);
  if (dateFilter) filter.createdAt = dateFilter;

  const attempts = await ExamAttempt.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const timeline = attempts.map((a) => ({
    attemptId: a._id,
    score: a.score ?? 0,
    status: a.status,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
  }));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Performance fetched",
    data: {
      attempts: attempts.map((a) => ({
        attemptId: a._id,
        examId: a.examId,
        score: a.score ?? 0,
        correctCount: a.correctCount ?? 0,
        wrongCount: a.wrongCount ?? 0,
        unansweredCount: a.unansweredCount ?? 0,
        status: a.status,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        flaggedQuestionIds: a.flaggedQuestionIds || [],
      })),
      timeline,
    },
  });
});

export const listAttempts = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = { userId };
  if (req.query.examId) filter.examId = req.query.examId;
  if (req.query.status) filter.status = req.query.status;

  const dateFilter = buildDateRangeFilter(req.query.from, req.query.to);
  if (dateFilter) filter.createdAt = dateFilter;

  const [items, total] = await Promise.all([
    ExamAttempt.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ExamAttempt.countDocuments(filter),
  ]);

  const examMap = {};
  const examIds = [...new Set(items.map((i) => i.examId?.toString()).filter(Boolean))];
  if (examIds.length) {
    const exams = await Exam.find({ _id: { $in: examIds } })
      .select("name")
      .lean();
    exams.forEach((e) => {
      examMap[e._id.toString()] = e.name;
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Attempts fetched",
    data: {
      attempts: items.map((i) => ({
        attemptId: i._id,
        examId: i.examId,
        examName: examMap[i.examId?.toString()] || null,
        score: i.score ?? 0,
        correctCount: i.correctCount ?? 0,
        wrongCount: i.wrongCount ?? 0,
        unansweredCount: i.unansweredCount ?? 0,
        status: i.status,
        startedAt: i.startedAt,
        endedAt: i.endedAt,
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

export const getAttemptDetails = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");

  const attempt = await ExamAttempt.findOne({
    _id: req.params.attemptId,
    userId,
  }).lean();

  if (!attempt) throw new AppError(httpStatus.NOT_FOUND, "Attempt not found");

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Attempt details fetched",
    data: attempt,
  });
});
