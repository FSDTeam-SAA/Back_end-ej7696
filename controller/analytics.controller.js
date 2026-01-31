import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { ExamAttempt } from "../model/examAttempt.model.js";
import { Exam } from "../model/exam.model.js";
import { ExamQuestionCache } from "../model/examQuestionCache.model.js";
import mongoose from "mongoose";

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

  const { attemptId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(attemptId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid attempt id");
  }

  const extractQuestionId = (q, index) =>
    q?._id?.toString() ||
    q?.id?.toString() ||
    q?.questionId?.toString() ||
    `q_${index}`;

  const extractCorrectOptions = (question) => {
    if (!question) return null;
    if (Array.isArray(question.options)) {
      const options = question.options
        .filter((opt) => opt?.is_correct)
        .map((opt) => opt.option ?? opt.value ?? opt.text)
        .filter((opt) => opt !== undefined && opt !== null);
      return options.length ? options : null;
    }
    if (question.correctAnswer !== undefined && question.correctAnswer !== null) {
      return question.correctAnswer;
    }
    if (question.answer !== undefined && question.answer !== null) {
      return question.answer;
    }
    return null;
  };

  const attempt = await ExamAttempt.findOne({
    _id: attemptId,
    userId,
  })
    .populate("examId", "name durationMinutes")
    .lean();

  if (!attempt) throw new AppError(httpStatus.NOT_FOUND, "Attempt not found");

  const normalizeReviewData = (reviewData, answers = []) => {
    const result = { topicBreakdown: [], answers: [] };

    if (!reviewData) {
      result.answers = Array.isArray(answers)
        ? answers.map((a) => ({
            questionId: a.questionId ?? null,
            userAnswer: a.selectedKey ?? null,
            isCorrect: typeof a.isCorrect === "boolean" ? a.isCorrect : null,
            timeSpentSec: a.timeSpentSec ?? 0,
          }))
        : [];
      return result;
    }

    if (Array.isArray(reviewData.topicBreakdown)) {
      result.topicBreakdown = reviewData.topicBreakdown;
    }

    const mapAnswer = (entry) => ({
      questionId: entry?.questionId ?? entry?.id ?? entry?._id ?? null,
      question: entry?.question ?? entry?.text ?? "",
      category: entry?.category ?? entry?.topic ?? entry?.section ?? null,
      userAnswer:
        entry?.userAnswer ??
        entry?.selectedKey ??
        entry?.submitted ??
        entry?.answer ??
        null,
      correctAnswer:
        entry?.correctAnswer ??
        entry?.correctOptions ??
        entry?.correct ??
        entry?.expected ??
        null,
      isCorrect:
        typeof entry?.isCorrect === "boolean" ? entry.isCorrect : null,
      timeSpentSec: entry?.timeSpentSec ?? entry?.timeSpent ?? 0,
    });

    if (Array.isArray(reviewData.answers)) {
      result.answers = reviewData.answers.map(mapAnswer);
    } else if (Array.isArray(reviewData.questions)) {
      result.answers = reviewData.questions.map(mapAnswer);
    } else if (Array.isArray(reviewData.details)) {
      result.answers = reviewData.details.map(mapAnswer);
    }

    if (!result.answers.length && Array.isArray(answers)) {
      result.answers = answers.map((a) => ({
        questionId: a.questionId ?? null,
        userAnswer: a.selectedKey ?? null,
        correctAnswer: a.correctAnswer ?? null,
        isCorrect: typeof a.isCorrect === "boolean" ? a.isCorrect : null,
        timeSpentSec: a.timeSpentSec ?? 0,
      }));
    }

    if (!result.topicBreakdown.length && result.answers.length) {
      const breakdownMap = new Map();
      result.answers.forEach((a) => {
        const category = a.category;
        if (!category) return;
        if (!breakdownMap.has(category)) {
          breakdownMap.set(category, {
            category,
            correct: 0,
            incorrect: 0,
            total: 0,
            accuracy: 0,
          });
        }
        if (typeof a.isCorrect !== "boolean") return;
        const entry = breakdownMap.get(category);
        entry.total += 1;
        if (a.isCorrect) entry.correct += 1;
        else entry.incorrect += 1;
      });
      result.topicBreakdown = Array.from(breakdownMap.values()).map((entry) => ({
        ...entry,
        accuracy:
          entry.total > 0
            ? Number(((entry.correct / entry.total) * 100).toFixed(2))
            : 0,
      }));
    }

    return result;
  };

  const review = normalizeReviewData(attempt.reviewData, attempt.answers);
  const needsCorrectAnswer = review.answers.some(
    (a) => a.correctAnswer === null || a.correctAnswer === undefined
  );

  if (needsCorrectAnswer && attempt.examId) {
    const examId = attempt.examId._id ?? attempt.examId;
    const cache = await ExamQuestionCache.findOne({ userId, examId }).lean();
    if (cache?.questions && Array.isArray(cache.questions)) {
      const correctMap = new Map();
      cache.questions.forEach((q, index) => {
        const key = extractQuestionId(q, index);
        correctMap.set(key, extractCorrectOptions(q));
      });

      review.answers = review.answers.map((a) => ({
        ...a,
        correctAnswer:
          a.correctAnswer === null || a.correctAnswer === undefined
            ? correctMap.get(a.questionId) ?? null
            : a.correctAnswer,
      }));
    }
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Attempt details fetched",
    data: {
      attemptId: attempt._id,
      exam: attempt.examId
        ? {
            examId: attempt.examId._id ?? attempt.examId,
            name: attempt.examId.name ?? null,
            durationMinutes: attempt.examId.durationMinutes ?? null,
          }
        : null,
      score: attempt.score ?? 0,
      correctCount: attempt.correctCount ?? 0,
      wrongCount: attempt.wrongCount ?? 0,
      unansweredCount: attempt.unansweredCount ?? 0,
      status: attempt.status,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      flaggedQuestionIds: attempt.flaggedQuestionIds || [],
      review,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    },
  });
});
