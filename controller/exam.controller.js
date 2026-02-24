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
import { AppSetting } from "../model/appSetting.model.js";
import { ExamRating } from "../model/examRating.model.js";
import { User } from "../model/user.model.js";

const QUESTION_SERVICE_URL =
  process.env.QUESTION_SERVICE_URL 
const QUESTION_SERVICE_TIMEOUT_MS =
  Number(process.env.QUESTION_SERVICE_TIMEOUT_MS);
const QUESTION_SERVICE_MODE =
  process.env.QUESTION_SERVICE_MODE?.toLowerCase() || "form";
const QUESTION_SERVICE_RETRY_COUNT =
  Number(process.env.QUESTION_SERVICE_RETRY_COUNT) || 1;
const QUESTION_SERVICE_RETRY_DELAY_MS =
  Number(process.env.QUESTION_SERVICE_RETRY_DELAY_MS) || 800;
const QUESTION_SERVICE_DEFAULT_EXAM_TYPE =
  process.env.QUESTION_SERVICE_DEFAULT_EXAM_TYPE?.toString().trim() || "";
const SUBSCRIPTION_QUESTION_LIMIT_PER_EXAM = 1200;

const parseStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = value.toString().toLowerCase();
  if (!["active", "inactive"].includes(normalized)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Status must be active or inactive");
  }
  return normalized;
};

const parseReviewStatus = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  let normalized = value.toString().toLowerCase();
  if (normalized === "publish") normalized = "published";
  if (!["pending", "published"].includes(normalized)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Review status must be pending or published"
    );
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

const isActiveProfessionalSubscription = (user, referenceDate = new Date()) => {
  if (!user) return false;
  if (user.subscriptionTier?.toString().toLowerCase() !== "professional") {
    return false;
  }
  if (!user.subscriptionExpiresAt) return false;
  const expiresAt = new Date(user.subscriptionExpiresAt);
  return expiresAt.getTime() > referenceDate.getTime();
};

const dateValuesEqual = (left, right) => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return new Date(left).getTime() === new Date(right).getTime();
};

const defaultProgress = () => ({
  answers: [],
  timeSpentSec: [],
  currentIndex: 0,
  flaggedQuestionIds: [],
  lastSavedAt: null,
});

const buildQuestionUsage = ({
  isSubscriptionLimited = false,
  questionsGenerated = 0,
  questionLimit = SUBSCRIPTION_QUESTION_LIMIT_PER_EXAM,
  subscriptionStartedAt = null,
  subscriptionExpiresAt = null,
} = {}) => {
  if (!isSubscriptionLimited) {
    return {
      mode: "standard",
      questionLimit: null,
      questionsGenerated: null,
      questionsRemaining: null,
      limitReached: false,
      subscriptionStartedAt: subscriptionStartedAt || null,
      subscriptionExpiresAt: subscriptionExpiresAt || null,
    };
  }

  const used = toNumberOrZero(questionsGenerated);
  const safeLimit = Math.max(toNumberOrZero(questionLimit), 1);
  const remaining = Math.max(safeLimit - used, 0);

  return {
    mode: "subscription",
    questionLimit: safeLimit,
    questionsGenerated: used,
    questionsRemaining: remaining,
    limitReached: remaining === 0,
    subscriptionStartedAt: subscriptionStartedAt || null,
    subscriptionExpiresAt: subscriptionExpiresAt || null,
  };
};

const normalizeAnswerValue = (value) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => v?.toString().trim().toLowerCase()).filter(Boolean);
  }
  return [value.toString().trim().toLowerCase()].filter(Boolean);
};

const mergeIndexedArray = (existing, updates) => {
  const base = Array.isArray(existing) ? [...existing] : [];
  if (!Array.isArray(updates)) return base;
  updates.forEach((value, index) => {
    if (value !== undefined) {
      base[index] = value;
    }
  });
  return base;
};

const toNumberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

const applyQuestionIndex = (questions) => {
  if (!Array.isArray(questions)) return questions;
  return questions.map((q, index) => {
    if (q && typeof q === "object" && !Array.isArray(q)) {
      return { ...q, index };
    }
    return q;
  });
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

const listExamReviews = async (filter = {}, pageQuery, limitQuery) => {
  const page = Math.max(parseInt(pageQuery, 10) || 1, 1);
  const limit = Math.max(parseInt(limitQuery, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const [reviews, total] = await Promise.all([
    ExamRating.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ExamRating.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    reviews,
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
  const settings = await AppSetting.findOne().lean();
  const unlockPrice = settings?.examUnlockPrice ?? 150;
  const currency = settings?.currency ?? "USD";

  const data = await listExams(
    { status: "active" },
    req.query.page,
    req.query.limit
  );

  if (req.user?._id) {
    const userId = req.user._id.toString();
    const examIds = data.exams.map((exam) => exam._id);

    const accesses = await ExamAccess.find({
      userId,
      examId: { $in: examIds },
    }).lean();

    const accessMap = accesses.reduce((acc, access) => {
      acc[access.examId.toString()] = access;
      return acc;
    }, {});


    data.exams = data.exams.map((exam) => {
      const access = accessMap[exam._id.toString()];
      const isUnlocked = access?.status === "unlocked";
      return {
        ...exam,
        unlockPrice,
        currency,
        unlocked: Boolean(isUnlocked),
        accessStatus: access?.status || "free",
        purchaseType: access?.purchaseType || null,
        paymentStatus: access?.paymentStatus || null,
      };
    });
  } else {
    data.exams = data.exams.map((exam) => ({
      ...exam,
      unlockPrice,
      currency,
      unlocked: false,
      accessStatus: "free",
      purchaseType: null,
      paymentStatus: null,
    }));
  }

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
  const rawExamType = "closed_book"
  //   req.body?.exam_type ?? req.query?.exam_type ?? req.body?.examType ?? null;
  const normalizedExamType =
    rawExamType !== undefined && rawExamType !== null
      ? rawExamType.toString().trim()
      : "";
  const exam_type =
    normalizedExamType && normalizedExamType.toLowerCase() !== "standard"
      ? normalizedExamType
      : QUESTION_SERVICE_DEFAULT_EXAM_TYPE;
  // if (!exam_type) {
  //   throw new AppError(
  //     httpStatus.BAD_REQUEST,
  //     "exam_type is required. Provide exam_type or set QUESTION_SERVICE_DEFAULT_EXAM_TYPE."
  //   );
  // }

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

  const now = new Date();
  const monthKey = getMonthKey(now);
  const accessDoc = await ExamAccess.findOne({ userId, examId });
  const isUnlocked = accessDoc?.status === "unlocked";

  const isProfessionalUser = isActiveProfessionalSubscription(req.user, now);
  const subscriptionStartedAt =
    isProfessionalUser && req.user?.subscriptionStartedAt
      ? new Date(req.user.subscriptionStartedAt)
      : null;
  const subscriptionExpiresAt =
    isProfessionalUser && req.user?.subscriptionExpiresAt
      ? new Date(req.user.subscriptionExpiresAt)
      : null;
  const isStarterUser = !isProfessionalUser;

  if (isUnlocked && accessDoc?.purchaseType === "plan" && !isProfessionalUser) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Professional subscription expired. Please purchase again to continue."
    );
  }

  if (isStarterUser && !isUnlocked) {
    const hasSubmittedAttempt = await ExamAttempt.exists({
      userId,
      examId,
      status: "SUBMITTED",
    });
    if (hasSubmittedAttempt) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Starter users can submit this exam only once. Please subscribe to continue."
      );
    }
  }

  const maxQuestionsPerSession = isUnlocked
    ? 30
    : accessDoc?.maxQuestionsPerSession || 2;
  let effectiveQuestionCount = Math.min(nQuestion, maxQuestionsPerSession);

  const durationMinutes =
    parseDurationMinutes(
      req.body?.durationMinutes ??
        req.body?.duration ??
        req.query?.durationMinutes ??
        req.query?.duration ??
        null
    ) ?? exam.durationMinutes ?? null;

  const recreate = parseBoolean(
    req.body?.recreate ??
      req.query?.recreate ??
      req.body?.regenerate ??
      req.query?.regenerate ??
      false
  );

  const existingCache = await ExamQuestionCache.findOne({
    userId,
    examId,
  });

  const isSubscriptionLimited =
    isUnlocked &&
    isProfessionalUser &&
    Boolean(subscriptionStartedAt && subscriptionExpiresAt);
  const existingSubscriptionUsage = existingCache?.subscriptionUsage || {};
  const cacheUsageForActiveSubscription =
    isSubscriptionLimited &&
    dateValuesEqual(existingSubscriptionUsage.cycleStart, subscriptionStartedAt) &&
    dateValuesEqual(existingSubscriptionUsage.cycleEnd, subscriptionExpiresAt);
  const questionsGeneratedForWindow = cacheUsageForActiveSubscription
    ? toNumberOrZero(existingSubscriptionUsage.questionsGenerated)
    : 0;
  const currentQuestionUsage = buildQuestionUsage({
    isSubscriptionLimited,
    questionsGenerated: questionsGeneratedForWindow,
    subscriptionStartedAt,
    subscriptionExpiresAt,
  });

  if (isSubscriptionLimited) {
    const remainingQuestionsForWindow = Math.max(
      SUBSCRIPTION_QUESTION_LIMIT_PER_EXAM - questionsGeneratedForWindow,
      0
    );
    if (
      remainingQuestionsForWindow > 0 &&
      effectiveQuestionCount > remainingQuestionsForWindow
    ) {
      effectiveQuestionCount = remainingQuestionsForWindow;
    }
  }

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
        questions: applyQuestionIndex(existingCache.questions),
        startTime: existingCache.startTime,
        endTime: existingCache.endTime,
        durationMinutes: existingCache.durationMinutes,
        cachedAt: existingCache.updatedAt,
        progress: existingCache.progress || defaultProgress(),
        questionUsage: currentQuestionUsage,
      },
    });
  }

  if (!isUnlocked) {
    const perExamAgg = await QuestionUsage.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          examId: new mongoose.Types.ObjectId(examId),
        },
      },
      { $group: { _id: null, total: { $sum: "$questionsUsed" } } },
    ]);
    const totalUsedForExam = perExamAgg?.[0]?.total || 0;
    if (totalUsedForExam >= 2) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Free question limit reached for this exam. Please purchase to unlock more."
      );
    }
    if (totalUsedForExam + effectiveQuestionCount > 2) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You can only generate 2 free questions for this exam. Reduce count or purchase this exam."
      );
    }

    const usageAgg = await QuestionUsage.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), monthKey } },
      { $group: { _id: null, total: { $sum: "$questionsUsed" } } },
    ]);
    const totalUsedThisMonth = usageAgg?.[0]?.total || 0;
    if (totalUsedThisMonth >= 100) {
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

  let nextSubscriptionUsage = existingCache?.subscriptionUsage || {
    cycleStart: null,
    cycleEnd: null,
    questionsGenerated: 0,
    lastGeneratedAt: null,
  };
  let nextQuestionUsage = currentQuestionUsage;

  if (isSubscriptionLimited) {
    const projectedGeneratedCount =
      questionsGeneratedForWindow + effectiveQuestionCount;

    if (projectedGeneratedCount > SUBSCRIPTION_QUESTION_LIMIT_PER_EXAM) {
      if (
        existingCache &&
        Array.isArray(existingCache.questions) &&
        existingCache.questions.length > 0
      ) {
        return sendResponse(res, {
          statusCode: httpStatus.OK,
          success: true,
          message:
            "Subscription question limit reached. Returning previously cached questions.",
          data: {
            fromCache: true,
            status: existingCache.status,
            statusCode: existingCache.statusCode,
            questions: applyQuestionIndex(existingCache.questions),
            startTime: existingCache.startTime,
            endTime: existingCache.endTime,
            durationMinutes: existingCache.durationMinutes,
            cachedAt: existingCache.updatedAt,
            progress: existingCache.progress || defaultProgress(),
            questionUsage: currentQuestionUsage,
          },
        });
      }

      throw new AppError(
        httpStatus.FORBIDDEN,
        "Subscription question limit reached. Please purchase again to continue."
      );
    }

    nextSubscriptionUsage = {
      cycleStart: subscriptionStartedAt,
      cycleEnd: subscriptionExpiresAt,
      questionsGenerated: projectedGeneratedCount,
      lastGeneratedAt: now,
    };
    nextQuestionUsage = buildQuestionUsage({
      isSubscriptionLimited: true,
      questionsGenerated: projectedGeneratedCount,
      subscriptionStartedAt,
      subscriptionExpiresAt,
    });
  }

  const questionPayload = {
    ex_name: exam.name,
    sheet_content: exam.effectivitySheetContent || "",
    knowledge_content: exam.bodyOfKnowledgeContent || "",
    n_question: effectiveQuestionCount,
    exam_type,
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sendQuestionRequest = async (useForm, attempt) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      QUESTION_SERVICE_TIMEOUT_MS
    );
    if (useForm) {
      const params = new URLSearchParams();
      params.append("ex_name", questionPayload.ex_name || "");
      params.append("exam_type", questionPayload.exam_type);
      params.append("sheet_content", questionPayload.sheet_content || "");
      params.append("knowledge_content", questionPayload.knowledge_content || "");
      params.append("n_question", questionPayload.n_question.toString());

      try {
        return await fetch(QUESTION_SERVICE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    try {
      return await fetch(QUESTION_SERVICE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(questionPayload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let externalRes;
  let usedForm = QUESTION_SERVICE_MODE === "form";

 try {
  let attempt = 0;

  while (attempt <= QUESTION_SERVICE_RETRY_COUNT) {
    try {
      externalRes = await sendQuestionRequest(usedForm, attempt);
      break;
    } catch (error) {
      const cause = error?.cause; // <-- undici/fetch root cause lives here

      console.error("[QuestionService] attempt failed", {
        attempt,
        name: error?.name,
        message: error?.message,

        // fetch/undici details
        causeName: cause?.name,
        causeMessage: cause?.message,
        causeCode: cause?.code,       // ECONNRESET / ETIMEDOUT / ECONNREFUSED, etc.
        causeErrno: cause?.errno,
        causeSyscall: cause?.syscall,
        causeAddress: cause?.address,
        causePort: cause?.port,

        // generic fields (axios/etc)
        code: error?.code,
        status: error?.status ?? error?.response?.status,
        data: error?.data ?? error?.response?.data,
        body: error?.body,

        stack: error?.stack,
      });

      // Retry on timeouts + transient network errors (common for gunicorn resets)
      const transient = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
      const transientCode = cause?.code || error?.code;

      if (error?.name === "AbortError" || transient.has(transientCode)) {
        if (attempt >= QUESTION_SERVICE_RETRY_COUNT) {
          throw new AppError(
            httpStatus.REQUEST_TIMEOUT,
            `Question service failed (${transientCode || "timeout"})`
          );
        }
        await delay(QUESTION_SERVICE_RETRY_DELAY_MS);
        attempt += 1;
        continue;
      }

      // non-timeout errors: bubble up to outer catch
      throw error;
    }
  }
} catch (error) {
  const cause = error?.cause;

  console.error("[QuestionService] final failure", {
    name: error?.name,
    message: error?.message,

    causeName: cause?.name,
    causeMessage: cause?.message,
    causeCode: cause?.code,
    causeErrno: cause?.errno,
    causeSyscall: cause?.syscall,
    causeAddress: cause?.address,
    causePort: cause?.port,

    code: error?.code,
    status: error?.status ?? error?.response?.status,
    data: error?.data ?? error?.response?.data,
    body: error?.body,
    stack: error?.stack,
  });

  const transient = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
  const transientCode = cause?.code || error?.code;

  if (error?.name === "AbortError" || transient.has(transientCode)) {
    throw new AppError(
      httpStatus.REQUEST_TIMEOUT,
      `Question service failed (${transientCode || "timeout"})`
    );
  }

  throw new AppError(httpStatus.BAD_GATEWAY, "Failed to reach question service");
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
      let attempt = 0;
      while (attempt <= QUESTION_SERVICE_RETRY_COUNT) {
        try {
          externalRes = await sendQuestionRequest(!usedForm, attempt);
          usedForm = !usedForm;
          break;
        } catch (error) {
          if (error.name === "AbortError") {
            if (attempt >= QUESTION_SERVICE_RETRY_COUNT) {
              throw new AppError(
                httpStatus.REQUEST_TIMEOUT,
                "Question service timed out"
              );
            }
            await delay(QUESTION_SERVICE_RETRY_DELAY_MS);
            attempt += 1;
            continue;
          }
          throw error;
        }
      }
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
      progress: defaultProgress(),
      subscriptionUsage: nextSubscriptionUsage,
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
      questions: applyQuestionIndex(cacheDoc.questions),
      startTime: cacheDoc.startTime,
      endTime: cacheDoc.endTime,
      durationMinutes: cacheDoc.durationMinutes,
      fromCache: false,
      progress: cacheDoc.progress || defaultProgress(),
      questionUsage: nextQuestionUsage,
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
      timeSpentSec: toNumberOrZero(
        req.body?.timeSpent?.[index] ?? cache.progress?.timeSpentSec?.[index]
      ),
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
  cache.progress = {
    answers: [],
    timeSpentSec: [],
    currentIndex: 0,
    flaggedQuestionIds: [],
    lastSavedAt: null,
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
        correctAnswer: d.correctOptions,
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

export const saveExamProgress = catchAsync(async (req, res) => {
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

  const questionCount = Array.isArray(cache.questions)
    ? cache.questions.length
    : 0;

  const progress = cache.progress || {
    answers: [],
    timeSpentSec: [],
    currentIndex: 0,
    flaggedQuestionIds: [],
    lastSavedAt: null,
  };

  const incomingAnswers = Array.isArray(req.body?.answers)
    ? req.body.answers
    : null;
  const incomingTimeSpent = Array.isArray(req.body?.timeSpent)
    ? req.body.timeSpent.map(toNumberOrZero)
    : null;

  if (incomingAnswers) {
    progress.answers = mergeIndexedArray(progress.answers, incomingAnswers);
  }
  if (incomingTimeSpent) {
    progress.timeSpentSec = mergeIndexedArray(
      progress.timeSpentSec,
      incomingTimeSpent
    );
  }

  const indexValue = req.body?.questionIndex ?? req.body?.index;
  const numericIndex = Number.isFinite(Number(indexValue))
    ? Number(indexValue)
    : null;

  if (
    numericIndex !== null &&
    numericIndex >= 0 &&
    (questionCount === 0 || numericIndex < questionCount)
  ) {
    if (req.body?.answer !== undefined) {
      progress.answers = mergeIndexedArray(progress.answers, []);
      progress.answers[numericIndex] = req.body.answer;
    }
    if (req.body?.timeSpentSec !== undefined || req.body?.timeSpent !== undefined) {
      const timeValue =
        req.body?.timeSpentSec !== undefined
          ? req.body.timeSpentSec
          : req.body?.timeSpent;
      progress.timeSpentSec = mergeIndexedArray(progress.timeSpentSec, []);
      progress.timeSpentSec[numericIndex] = toNumberOrZero(timeValue);
    }
  }

  if (req.body?.currentIndex !== undefined) {
    const currentIndex = Number(req.body.currentIndex);
    if (!Number.isNaN(currentIndex) && currentIndex >= 0) {
      progress.currentIndex =
        questionCount > 0 ? Math.min(currentIndex, questionCount - 1) : currentIndex;
    }
  }

  if (Array.isArray(req.body?.flaggedQuestionIds)) {
    progress.flaggedQuestionIds = req.body.flaggedQuestionIds
      .map((f) => f?.toString())
      .filter(Boolean);
  }

  if (questionCount > 0) {
    progress.answers = Array.isArray(progress.answers)
      ? progress.answers.slice(0, questionCount)
      : [];
    progress.timeSpentSec = Array.isArray(progress.timeSpentSec)
      ? progress.timeSpentSec.slice(0, questionCount)
      : [];
  }

  progress.lastSavedAt = new Date();
  cache.progress = progress;
  await cache.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam progress saved",
    data: {
      progress,
      questionCount,
      cachedAt: cache.updatedAt,
    },
  });
});

export const submitExamReview = catchAsync(async (req, res) => {
  const userId = req.user?._id?.toString();
  const examId = req.params.id || req.body.examId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (!examId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Exam ID is required");
  }

  const stars = Number(req.body?.stars ?? req.body?.rating);
  if (Number.isNaN(stars)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Rating must be a number");
  }
  if (stars < 1 || stars > 5) {
    throw new AppError(httpStatus.BAD_REQUEST, "Rating must be between 1 and 5");
  }

  const feedbackText =
    req.body?.feedbackText ?? req.body?.testimonial ?? req.body?.review ?? "";
  const displayName =
    req.body?.name ??
    req.body?.displayName ??
    req.user?.name ??
    [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ??
    "";

  const review = await ExamRating.findOneAndUpdate(
    { userId, examId },
    {
      userId,
      examId,
      stars,
      feedbackText,
      displayName,
      status: "pending",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam review saved",
    data: {
      reviewId: review._id,
      examId: review.examId,
      stars: review.stars,
      feedbackText: review.feedbackText,
      displayName: review.displayName,
      status: review.status,
      updatedAt: review.updatedAt,
    },
  });
});

export const getPublishedExamReviews = catchAsync(async (req, res) => {
  const filter = { status: "published" };
  if (req.query.examId) filter.examId = req.query.examId;

  const data = await listExamReviews(filter, req.query.page, req.query.limit);

  const examIds = [
    ...new Set(data.reviews.map((r) => r.examId?.toString()).filter(Boolean)),
  ];
  const exams = examIds.length
    ? await Exam.find({ _id: { $in: examIds } }).select("name").lean()
    : [];
  const examMap = exams.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const reviews = data.reviews.map((review) => ({
    reviewId: review._id,
    examId: review.examId,
    examName: examMap[review.examId?.toString()] || null,
    stars: review.stars,
    feedbackText: review.feedbackText,
    displayName: review.displayName,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  }));

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Published exam reviews fetched",
    data: {
      reviews,
      meta: data.meta,
    },
  });
});

export const getAllExamReviewsAdmin = catchAsync(async (req, res) => {
  const filter = {};
  const statusFilter = parseReviewStatus(req.query.status);
  if (statusFilter) filter.status = statusFilter;
  if (req.query.examId) filter.examId = req.query.examId;
  if (req.query.userId) filter.userId = req.query.userId;

  const data = await listExamReviews(filter, req.query.page, req.query.limit);

  const examIds = [
    ...new Set(data.reviews.map((r) => r.examId?.toString()).filter(Boolean)),
  ];
  const userIds = [
    ...new Set(data.reviews.map((r) => r.userId?.toString()).filter(Boolean)),
  ];

  const [exams, users] = await Promise.all([
    examIds.length
      ? Exam.find({ _id: { $in: examIds } }).select("name").lean()
      : [],
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("name firstName lastName email")
          .lean()
      : [],
  ]);

  const examMap = exams.reduce((acc, exam) => {
    acc[exam._id.toString()] = exam.name;
    return acc;
  }, {});

  const userMap = users.reduce((acc, user) => {
    const name =
      user.name ||
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.email ||
      "";
    acc[user._id.toString()] = { name, email: user.email || "" };
    return acc;
  }, {});

  const reviews = data.reviews.map((review) => {
    const userInfo = userMap[review.userId?.toString()] || {
      name: "",
      email: "",
    };
    return {
      reviewId: review._id,
      examId: review.examId,
      examName: examMap[review.examId?.toString()] || null,
      userId: review.userId,
      userName: userInfo.name,
      userEmail: userInfo.email,
      stars: review.stars,
      feedbackText: review.feedbackText,
      displayName: review.displayName,
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Exam reviews fetched",
    data: {
      reviews,
      meta: data.meta,
    },
  });
});

export const updateExamReview = catchAsync(async (req, res) => {
  const reviewId = req.params.reviewId;
  if (!reviewId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Review ID is required");
  }

  const updates = {};

  if (req.body?.status !== undefined) {
    updates.status = parseReviewStatus(req.body.status);
  }

  if (req.body?.stars !== undefined) {
    const stars = Number(req.body.stars);
    if (Number.isNaN(stars)) {
      throw new AppError(httpStatus.BAD_REQUEST, "Rating must be a number");
    }
    if (stars < 1 || stars > 5) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Rating must be between 1 and 5"
      );
    }
    updates.stars = stars;
  }

  if (req.body?.feedbackText !== undefined) {
    updates.feedbackText = req.body.feedbackText ?? "";
  }

  if (req.body?.displayName !== undefined) {
    updates.displayName = req.body.displayName ?? "";
  }

  if (!Object.keys(updates).length) {
    throw new AppError(httpStatus.BAD_REQUEST, "No valid updates provided");
  }

  const review = await ExamRating.findByIdAndUpdate(
    reviewId,
    { $set: updates },
    { new: true }
  );

  if (!review) {
    throw new AppError(httpStatus.NOT_FOUND, "Review not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review updated",
    data: {
      reviewId: review._id,
      examId: review.examId,
      userId: review.userId,
      stars: review.stars,
      feedbackText: review.feedbackText,
      displayName: review.displayName,
      status: review.status,
      updatedAt: review.updatedAt,
    },
  });
});

export const deleteExamReview = catchAsync(async (req, res) => {
  const reviewId = req.params.reviewId;
  if (!reviewId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Review ID is required");
  }

  const review = await ExamRating.findByIdAndDelete(reviewId);
  if (!review) {
    throw new AppError(httpStatus.NOT_FOUND, "Review not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review deleted",
    data: null,
  });
});
