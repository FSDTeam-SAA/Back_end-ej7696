import httpStatus from "http-status";
import mongoose from "mongoose";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";
import { Exam } from "../model/exam.model.js";
import { ExamQuestionCache } from "../model/examQuestionCache.model.js";
import { ExamAttempt } from "../model/examAttempt.model.js";
import { QuestionUsage } from "../model/questionUsage.model.js";
import { ExamAccess } from "../model/examAccess.model.js";

const QUESTION_SERVICE_URL =
  process.env.QUESTION_SERVICE_URL ||
  "https://ej7696.onrender.com/api/gen-question/";
const QUESTION_SERVICE_TIMEOUT_MS =
  Number(process.env.QUESTION_SERVICE_TIMEOUT_MS) || 20000;
const QUESTION_SERVICE_MODE =
  process.env.QUESTION_SERVICE_MODE?.toLowerCase() || "form";

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

const parseQuestionCount = (value) => {
  const resolved = value ?? 1;
  const parsed = Number(resolved);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "n_question must be a positive number"
    );
  }
  return Math.ceil(parsed);
};

const parseDurationMinutes = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "durationMinutes must be a positive number"
    );
  }
  return Math.ceil(parsed);
};

const parseBoolean = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  const normalized = value.toString().toLowerCase();
  return ["true", "1", "yes", "y", "on"].includes(normalized);
};

const normalizeAnswerValue = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => v?.toString().trim().toLowerCase()).filter(Boolean);
  }
  return [value.toString().trim().toLowerCase()].filter(Boolean);
};

const extractQuestionId = (q, index) =>
  q?._id?.toString() ||
  q?.id?.toString() ||
  q?.questionId?.toString() ||
  `q_${index}`;

const getMonthKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
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

  const nQuestion = parseQuestionCount(
    req.body?.n_question ?? req.body?.nQuestion ?? 1
  );
  const durationMinutes = parseDurationMinutes(
    req.body?.durationMinutes ?? req.body?.duration ?? null
  );

  const exam = await Exam.create({
    name,
    effectivitySheetContent,
    bodyOfKnowledgeContent,
    status: status || "active",
    image,
    createdBy: req.user?._id || null,
    n_question: nQuestion,
    durationMinutes,
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

export const startExam = catchAsync(async (req, res) => {
  const userId = req.user?._id?.toString();
  const examId = req.params.id || req.body.examId;
  const exam_type = req.body.exam_type || req.query.exam_type || "standard";

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (!examId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Exam ID is required");
  }

  const exam = await Exam.findById(examId).lean();
  if (!exam) {
    throw new AppError(httpStatus.NOT_FOUND, "Exam not found");
  }
  if (exam.status !== "active") {
    throw new AppError(httpStatus.BAD_REQUEST, "Exam is not active");
  }

  const nQuestion = parseQuestionCount(
    req.body?.n_question ??
      req.body?.nQuestion ??
      req.query?.n_question ??
      exam.n_question ??
      1
  );

  const monthKey = getMonthKey(new Date());
  const accessDoc = await ExamAccess.findOne({ userId, examId });
  const isUnlocked = accessDoc?.status === "unlocked";
  const maxQuestionsPerSession = isUnlocked
    ? 20
    : accessDoc?.maxQuestionsPerSession || 2;
  const effectiveQuestionCount = Math.min(nQuestion, maxQuestionsPerSession);

  const durationMinutes =
    parseDurationMinutes(
      req.body?.durationMinutes ??
        req.body?.duration ??
        req.query?.durationMinutes ??
        req.query?.duration ??
        null
    ) ?? exam.durationMinutes ?? null;

  const recreate = parseBoolean(
    req.body?.recreate ?? req.query?.recreate ?? false
  );

  const existingCache = await ExamQuestionCache.findOne({
    userId,
    examId,
  });

  if (
    existingCache &&
    !recreate &&
    existingCache.n_question === effectiveQuestionCount
  ) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Exam questions fetched from cache",
      data: {
        fromCache: true,
        status: existingCache.status,
        statusCode: existingCache.statusCode,
        questions: existingCache.questions,
        startTime: existingCache.startTime,
        endTime: existingCache.endTime,
        durationMinutes: existingCache.durationMinutes,
        cachedAt: existingCache.updatedAt,
      },
    });
  }

  if (!isUnlocked) {
    const usageAgg = await QuestionUsage.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), monthKey } },
      { $group: { _id: null, total: { $sum: "$questionsUsed" } } },
    ]);
    const totalUsedThisMonth = usageAgg?.[0]?.total || 0;
    if (totalUsedThisMonth >= 14) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Monthly free question limit reached. Please purchase to unlock more."
      );
    }
    if (totalUsedThisMonth + effectiveQuestionCount > 14) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Requested questions exceed monthly free limit. Reduce count or purchase this exam."
      );
    }
  }

  const questionPayload = {
    ex_name: exam.name,
    exam_type,
    sheet_content: exam.effectivitySheetContent || "",
    knowledge_content: exam.bodyOfKnowledgeContent || "",
    n_question: effectiveQuestionCount,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUESTION_SERVICE_TIMEOUT_MS);
  const sendQuestionRequest = async (useForm) => {
    if (useForm) {
      const params = new URLSearchParams();
      params.append("ex_name", questionPayload.ex_name || "");
      params.append("exam_type", questionPayload.exam_type || "");
      params.append("sheet_content", questionPayload.sheet_content || "");
      params.append("knowledge_content", questionPayload.knowledge_content || "");
      params.append("n_question", questionPayload.n_question.toString());

      return fetch(QUESTION_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal,
      });
    }

    return fetch(QUESTION_SERVICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(questionPayload),
      signal: controller.signal,
    });
  };

  let externalRes;
  let usedForm = QUESTION_SERVICE_MODE === "form";

  try {
    externalRes = await sendQuestionRequest(usedForm);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new AppError(httpStatus.REQUEST_TIMEOUT, "Question service timed out");
    }

    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to reach question service");
  } finally {
    clearTimeout(timeout);
  }

  const contentType = externalRes.headers.get("content-type") || "";
  let result = null;
  let rawText = null;

  if (contentType.includes("application/json")) {
    result = await externalRes.json().catch(() => null);
  } else {
    rawText = await externalRes.text().catch(() => null);
    if (rawText) {
      try {
        result = JSON.parse(rawText);
      } catch (err) {
        result = null;
      }
    }
  }

  const missingFields =
    result?.detail &&
    Array.isArray(result.detail) &&
    result.detail.some(
      (item) =>
        item?.type === "missing" &&
        Array.isArray(item?.loc) &&
        item.loc.includes("body")
    );

  const parsingError =
    externalRes.status === 400 &&
    (rawText?.includes("error parsing the body") ||
      JSON.stringify(result || {}).includes("error parsing the body"));

  if (
    !externalRes.ok &&
    (parsingError || (externalRes.status === 422 && missingFields)) &&
    QUESTION_SERVICE_MODE !== "auto"
  ) {
    // Retry once with the opposite content type when body parsing fails.
    try {
      externalRes = await sendQuestionRequest(!usedForm);
      usedForm = !usedForm;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new AppError(
          httpStatus.REQUEST_TIMEOUT,
          "Question service timed out"
        );
      }
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        "Failed to reach question service"
      );
    }

    rawText = null;
    result = null;
    const retryContentType = externalRes.headers.get("content-type") || "";
    if (retryContentType.includes("application/json")) {
      result = await externalRes.json().catch(() => null);
    } else {
      rawText = await externalRes.text().catch(() => null);
      if (rawText) {
        try {
          result = JSON.parse(rawText);
        } catch (err) {
          result = null;
        }
      }
    }
  }

  if (!externalRes.ok) {
    const snippet =
      (rawText || (result ? JSON.stringify(result) : "")).slice(0, 500) || "";
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `Question service error (${externalRes.status}). ${snippet}`.trim()
    );
  }

  if (!result && !rawText) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Question service returned an empty response"
    );
  }

  const payload = result?.text ?? result?.questions ?? result ?? rawText;
  let parsedQuestions = payload;
  if (typeof payload === "string") {
    try {
      parsedQuestions = JSON.parse(payload);
    } catch (err) {
      parsedQuestions = payload;
    }
  }

  if (!parsedQuestions) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Question service returned an unexpected response"
    );
  }

  const startTime = new Date();
  const endTime =
    durationMinutes && durationMinutes > 0
      ? new Date(startTime.getTime() + durationMinutes * 60 * 1000)
      : null;

  const cacheDoc = await ExamQuestionCache.findOneAndUpdate(
    { userId, examId },
    {
      userId,
      examId,
      examName: exam.name,
      sheetContent: exam.effectivitySheetContent || "",
      knowledgeContent: exam.bodyOfKnowledgeContent || "",
      n_question: effectiveQuestionCount,
      durationMinutes,
      startTime,
      endTime,
      status: result?.status ?? "success",
      statusCode: result?.status_code ?? externalRes.status,
      questions: parsedQuestions,
      rawResponse: result,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await QuestionUsage.findOneAndUpdate(
    { userId, examId, monthKey },
    { $inc: { questionsUsed: effectiveQuestionCount } },
    { upsert: true }
  );

  await ExamAttempt.findOneAndUpdate(
    { userId, examId, status: "IN_PROGRESS" },
    {
      userId,
      examId,
      startedAt: cacheDoc.startTime || startTime,
      endedAt: cacheDoc.endTime || null,
      status: "IN_PROGRESS",
      unansweredCount: Array.isArray(cacheDoc.questions)
        ? cacheDoc.questions.length
        : 0,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam started and questions fetched",
    data: {
      status: result?.status ?? "success",
      statusCode: result?.status_code ?? externalRes.status,
      questions: cacheDoc.questions,
      startTime: cacheDoc.startTime,
      endTime: cacheDoc.endTime,
      durationMinutes: cacheDoc.durationMinutes,
      fromCache: false,
    },
  });
});

export const updateExam = catchAsync(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");

  const allowedFields = [
    "name",
    "effectivitySheetContent",
    "bodyOfKnowledgeContent",
    "n_question",
    "durationMinutes",
  ];
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      if (field === "n_question") {
        exam[field] = parseQuestionCount(req.body[field]);
      } else if (field === "durationMinutes") {
        exam[field] = parseDurationMinutes(req.body[field]);
      } else {
        exam[field] = req.body[field];
      }
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

export const updateExamStatus = catchAsync(async (req, res) => {
  const exam = await Exam.findById(req.params.id);
  if (!exam) throw new AppError(httpStatus.NOT_FOUND, "Exam not found");

  if (req.body?.status === undefined) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status is required");
  }

  exam.status = parseStatus(req.body.status);
  await exam.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam status updated successfully",
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

export const submitExamAnswers = catchAsync(async (req, res) => {
  const userId = req.user?._id?.toString();
  const examId = req.params.id || req.body.examId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (!examId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Exam ID is required");
  }

  const cache = await ExamQuestionCache.findOne({ userId, examId });
  if (!cache || !Array.isArray(cache.questions) || cache.questions.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No cached questions found. Start the exam first."
    );
  }

  const answers = Array.isArray(req.body?.answers)
    ? req.body.answers
    : [];
  const flaggedQuestionIds = Array.isArray(req.body?.flaggedQuestionIds)
    ? req.body.flaggedQuestionIds.map((f) => f?.toString())
    : [];
  const reviewData = req.body?.reviewData ?? null;

  const details = [];
  let correct = 0;
  let answeredCount = 0;

  cache.questions.forEach((q, index) => {
    const submitted = normalizeAnswerValue(answers[index]);
    const correctOptions = Array.isArray(q.options)
      ? q.options
          .filter((opt) => opt?.is_correct)
          .map((opt) => opt.option?.toString().trim().toLowerCase())
          .filter(Boolean)
      : [];

    const isCorrect =
      submitted.length > 0 &&
      correctOptions.length > 0 &&
      submitted.length === correctOptions.length &&
      submitted.every((val) => correctOptions.includes(val));

    if (submitted.length > 0) answeredCount += 1;

    if (isCorrect) correct += 1;

    details.push({
      questionId: extractQuestionId(q, index),
      question: q.question || q.text || `Question ${index + 1}`,
      submitted,
      correctOptions,
      isCorrect,
      timeSpentSec: Number(req.body?.timeSpent?.[index]) || 0,
    });
  });

  const total = cache.questions.length;
  const wrong = answeredCount - correct;
  const unanswered = total - answeredCount;
  const score = {
    correct,
    incorrect: wrong,
    total: total,
    percent: total > 0 ? Number(((correct / total) * 100).toFixed(2)) : 0,
  };

  cache.lastSubmission = {
    answers,
    score,
    submittedAt: new Date(),
  };
  await cache.save();

  const endedAt = new Date();
  await ExamAttempt.findOneAndUpdate(
    { userId, examId, status: { $in: ["IN_PROGRESS", "TIMEOUT"] } },
    {
      userId,
      examId,
      endedAt,
      status: "SUBMITTED",
      score: score.percent,
      correctCount: correct,
      wrongCount: wrong,
      unansweredCount: unanswered,
      flaggedQuestionIds,
      answers: details.map((d) => ({
        questionId: d.questionId,
        selectedKey: d.submitted,
        isCorrect: d.isCorrect,
        timeSpentSec: d.timeSpentSec,
      })),
      reviewData,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam submitted",
    data: {
      score,
      details,
      cachedQuestionsVersion: cache.updatedAt,
    },
  });
});
