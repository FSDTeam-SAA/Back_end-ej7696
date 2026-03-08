import crypto from "crypto";
import mongoose from "mongoose";
import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { ExamQuestionBank } from "../model/examQuestionBank.model.js";
import { ExamQuestionBatch } from "../model/examQuestionBatch.model.js";

const QUESTION_SERVICE_URL =
  process.env.QUESTION_SERVICE_URL?.toString().trim() || "";
const QUESTION_SERVICE_FALLBACK_URLS = (
  process.env.QUESTION_SERVICE_FALLBACK_URLS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const QUESTION_SERVICE_TIMEOUT_MS = Math.max(
  Number(process.env.QUESTION_SERVICE_TIMEOUT_MS) || 60000,
  10000
);
const QUESTION_SERVICE_TIMEOUT_PER_QUESTION_MS = Math.max(
  Number(process.env.QUESTION_SERVICE_TIMEOUT_PER_QUESTION_MS) || 2500,
  0
);
const QUESTION_SERVICE_TIMEOUT_MAX_MS = Math.max(
  Number(process.env.QUESTION_SERVICE_TIMEOUT_MAX_MS) || 600000,
  QUESTION_SERVICE_TIMEOUT_MS
);
const QUESTION_SERVICE_MODE =
  process.env.QUESTION_SERVICE_MODE?.toLowerCase() || "form";
const QUESTION_SERVICE_RETRY_COUNT =
  Number(process.env.QUESTION_SERVICE_RETRY_COUNT) || 2;
const QUESTION_SERVICE_RETRY_DELAY_MS =
  Number(process.env.QUESTION_SERVICE_RETRY_DELAY_MS) || 800;
const QUESTION_SERVICE_DEFAULT_EXAM_TYPE =
  process.env.QUESTION_SERVICE_DEFAULT_EXAM_TYPE?.toString().trim() ||
  "closed_book";

const QUESTION_BANK_MIN_BATCH_SIZE = 1;
const QUESTION_BANK_MAX_BATCH_SIZE = Math.max(
  Number(process.env.QUESTION_BANK_MAX_BATCH_SIZE) || 1000,
  QUESTION_BANK_MIN_BATCH_SIZE
);
export const QUESTION_BANK_DEFAULT_BATCH_SIZE = clampNumber(
  Number(process.env.QUESTION_BANK_BATCH_SIZE) || 100,
  QUESTION_BANK_MIN_BATCH_SIZE,
  QUESTION_BANK_MAX_BATCH_SIZE
);
export const QUESTION_BANK_DEFAULT_TARGET = Math.max(
  Number(process.env.QUESTION_BANK_TARGET_TOTAL) || 10000,
  1
);
export const QUESTION_BANK_DEFAULT_TOTAL_BATCHES = Math.max(
  Number(process.env.QUESTION_BANK_TOTAL_BATCHES) ||
    Math.ceil(
      QUESTION_BANK_DEFAULT_TARGET / Math.max(QUESTION_BANK_DEFAULT_BATCH_SIZE, 1)
    ),
  1
);

const QUESTION_AI_VALIDATION_ENABLED =
  parseBoolean(process.env.QUESTION_BANK_ENABLE_AI_VALIDATION);
const QUESTION_AI_VALIDATION_URL =
  process.env.QUESTION_VALIDATION_SERVICE_URL?.toString().trim() || "";
const QUESTION_AI_VALIDATION_TIMEOUT_MS =
  Number(process.env.QUESTION_VALIDATION_SERVICE_TIMEOUT_MS) || 20000;

const QUESTION_MIN_LENGTH = 10;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function ensureTrailingSlashVariants(url, collector) {
  const trimmed = (url || "").toString().trim();
  if (!trimmed) return;

  if (!trimmed.endsWith("/")) {
    collector.add(trimmed);
    collector.add(`${trimmed}/`);
    return;
  }

  collector.add(trimmed);
  collector.add(trimmed.replace(/\/+$/, ""));
}

function buildQuestionServiceUrlCandidates() {
  const set = new Set();
  const seedUrls = [QUESTION_SERVICE_URL, ...QUESTION_SERVICE_FALLBACK_URLS];
  seedUrls.forEach((url) => ensureTrailingSlashVariants(url, set));

  for (const candidate of Array.from(set)) {
    try {
      const parsed = new URL(candidate);
      const origin = `${parsed.protocol}//${parsed.host}`;
      if (!parsed.pathname || parsed.pathname === "/") {
        ensureTrailingSlashVariants(`${origin}/api/gen-question`, set);
      }
    } catch (error) {
      // Ignore invalid URL candidates and rely on valid ones.
    }
  }

  return Array.from(set);
}

const QUESTION_SERVICE_URL_CANDIDATES = buildQuestionServiceUrlCandidates();

function parseBoolean(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  const normalized = value.toString().trim().toLowerCase();
  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function normalizeWhitespace(value) {
  return (value ?? "").toString().replace(/\s+/g, " ").trim();
}

function normalizeComparable(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function normalizeOptionKey(value, fallbackIndex = 0) {
  const raw = normalizeWhitespace(value);
  if (!raw) {
    return alphabet[fallbackIndex] || `O${fallbackIndex + 1}`;
  }
  const stripped = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (stripped.length === 1) return stripped;
  if (stripped.length > 0 && stripped.length <= 4) return stripped;
  return alphabet[fallbackIndex] || `O${fallbackIndex + 1}`;
}

function normalizeAnswerToken(value) {
  return normalizeComparable(value).replace(/[^a-z0-9]/g, "");
}

function coerceOption(option, index) {
  if (typeof option === "string" || typeof option === "number") {
    return {
      key: normalizeOptionKey(null, index),
      option: normalizeWhitespace(option),
      is_correct: false,
    };
  }

  if (!option || typeof option !== "object") {
    return {
      key: normalizeOptionKey(null, index),
      option: "",
      is_correct: false,
    };
  }

  return {
    key: normalizeOptionKey(
      option.key ??
        option.id ??
        option.labelKey ??
        option.choiceKey ??
        option.choice,
      index
    ),
    option: normalizeWhitespace(
      option.option ??
        option.text ??
        option.value ??
        option.label ??
        option.answer ??
        option.content
    ),
    is_correct: parseBoolean(
      option.is_correct ?? option.isCorrect ?? option.correct ?? option.isAnswer
    ),
  };
}

function extractRawOptions(rawQuestion = {}) {
  if (Array.isArray(rawQuestion.options)) return rawQuestion.options;
  if (Array.isArray(rawQuestion.choices)) return rawQuestion.choices;
  if (Array.isArray(rawQuestion.answerOptions)) return rawQuestion.answerOptions;
  if (Array.isArray(rawQuestion.answers)) return rawQuestion.answers;

  const objectOptions =
    rawQuestion.options &&
    typeof rawQuestion.options === "object" &&
    !Array.isArray(rawQuestion.options)
      ? rawQuestion.options
      : null;

  if (objectOptions) {
    return Object.entries(objectOptions).map(([key, value]) => ({ key, value }));
  }

  const fallbackKeys = [
    "optionA",
    "optionB",
    "optionC",
    "optionD",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
  ];
  const fallbackOptions = fallbackKeys
    .map((key) => rawQuestion[key])
    .filter((value) => value !== undefined && value !== null && `${value}`.trim());

  return fallbackOptions;
}

function extractQuestionText(rawQuestion = {}) {
  return normalizeWhitespace(
    rawQuestion.question ??
      rawQuestion.text ??
      rawQuestion.prompt ??
      rawQuestion.title ??
      rawQuestion.statement
  );
}

function extractCorrectAnswerTokens(rawQuestion = {}) {
  const answers = [];
  const rawAnswer =
    rawQuestion.correctAnswer ??
    rawQuestion.correct_answer ??
    rawQuestion.correct ??
    rawQuestion.answer ??
    rawQuestion.correctOption ??
    rawQuestion.correct_option ??
    rawQuestion.correctOptions ??
    rawQuestion.correct_options ??
    rawQuestion.solution;

  toArray(rawAnswer).forEach((value) => {
    if (typeof value === "string" && value.includes(",")) {
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => answers.push(item));
      return;
    }
    if (value !== undefined && value !== null) answers.push(value);
  });

  return answers
    .map((value) => ({
      exact: normalizeComparable(value),
      normalized: normalizeAnswerToken(value),
    }))
    .filter((token) => token.exact || token.normalized);
}

function computeQuestionHash(question) {
  const base = normalizeComparable(question.question);
  const normalizedOptions = (question.options || [])
    .map((option) => ({
      option: normalizeComparable(option.option),
      is_correct: option.is_correct ? 1 : 0,
    }))
    .sort((left, right) => left.option.localeCompare(right.option));

  const payload = JSON.stringify({
    question: base,
    options: normalizedOptions,
  });

  return crypto.createHash("sha256").update(payload).digest("hex");
}

function normalizeQuestionCandidate(rawQuestion, index) {
  const issues = [];
  const question = extractQuestionText(rawQuestion);
  if (!question) {
    issues.push("missing_question_text");
  } else if (question.length < QUESTION_MIN_LENGTH) {
    issues.push("question_text_too_short");
  }

  const rawOptions = extractRawOptions(rawQuestion);
  let options = rawOptions.map((option, optionIndex) =>
    coerceOption(option, optionIndex)
  );

  options = options
    .filter((option) => option.option)
    .map((option, optionIndex) => ({
      ...option,
      key: normalizeOptionKey(option.key, optionIndex),
    }));

  const deduped = new Map();
  options.forEach((option) => {
    const key = normalizeComparable(option.option);
    if (!key) return;
    if (!deduped.has(key)) {
      deduped.set(key, { ...option });
      return;
    }
    const existing = deduped.get(key);
    existing.is_correct = existing.is_correct || option.is_correct;
    deduped.set(key, existing);
  });
  options = Array.from(deduped.values());

  const correctAnswerTokens = extractCorrectAnswerTokens(rawQuestion);
  if (correctAnswerTokens.length > 0) {
    options = options.map((option) => {
      const optionExact = normalizeComparable(option.option);
      const optionToken = normalizeAnswerToken(option.option);
      const keyExact = normalizeComparable(option.key);
      const keyToken = normalizeAnswerToken(option.key);
      const matches = correctAnswerTokens.some((token) => {
        if (token.exact && [optionExact, keyExact].includes(token.exact)) {
          return true;
        }
        if (
          token.normalized &&
          [optionToken, keyToken].includes(token.normalized)
        ) {
          return true;
        }
        return false;
      });
      return { ...option, is_correct: option.is_correct || matches };
    });
  }

  if (options.length < 2) {
    issues.push("insufficient_options");
  }

  if (options.length > 8) {
    options = options.slice(0, 8);
    issues.push("too_many_options_trimmed");
  }

  const correctCount = options.filter((option) => option.is_correct).length;
  if (correctCount === 0) {
    issues.push("missing_correct_option");
  }

  const canonicalQuestion = {
    question,
    options: options.map((option, optionIndex) => ({
      key: normalizeOptionKey(option.key, optionIndex),
      option: option.option,
      is_correct: option.is_correct,
    })),
    explanation: normalizeWhitespace(rawQuestion.explanation ?? rawQuestion.rationale),
    category: normalizeWhitespace(
      rawQuestion.category ?? rawQuestion.topic ?? rawQuestion.section
    ),
    tags: Array.isArray(rawQuestion.tags)
      ? rawQuestion.tags.map((tag) => normalizeWhitespace(tag)).filter(Boolean)
      : [],
    metadata: {
      sourceIndex: index,
      difficulty: normalizeWhitespace(rawQuestion.difficulty),
      type: normalizeWhitespace(rawQuestion.type ?? rawQuestion.questionType),
    },
  };

  const questionHash = computeQuestionHash(canonicalQuestion);
  return {
    isValid: issues.length === 0,
    issues,
    question: canonicalQuestion,
    questionHash,
    questionTextNormalized: normalizeComparable(canonicalQuestion.question),
    preview: canonicalQuestion.question.slice(0, 180),
  };
}

function extractQuestionsArray(payload) {
  let current = payload;
  for (let depth = 0; depth < 5; depth += 1) {
    if (Array.isArray(current)) return current;

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) return [];
      try {
        current = JSON.parse(trimmed);
        continue;
      } catch (error) {
        return [];
      }
    }

    if (!current || typeof current !== "object") return [];

    if (Array.isArray(current.questions)) return current.questions;
    if (Array.isArray(current.data)) return current.data;
    if (Array.isArray(current.items)) return current.items;

    if (current.text !== undefined) {
      current = current.text;
      continue;
    }

    return [];
  }
  return [];
}

function isTransientError(error) {
  const code = error?.cause?.code || error?.code;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveQuestionServiceTimeoutMs(nQuestion) {
  const safeQuestionCount = Math.max(Math.ceil(Number(nQuestion) || 0), 0);
  const computed =
    QUESTION_SERVICE_TIMEOUT_MS +
    safeQuestionCount * QUESTION_SERVICE_TIMEOUT_PER_QUESTION_MS;
  return Math.min(
    Math.max(computed, QUESTION_SERVICE_TIMEOUT_MS),
    QUESTION_SERVICE_TIMEOUT_MAX_MS
  );
}

async function sendGenerationRequest(payload, useForm, serviceUrl, timeoutMs) {
  if (!QUESTION_SERVICE_URL_CANDIDATES.length) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "QUESTION_SERVICE_URL is not configured"
    );
  }
  if (!serviceUrl) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Question service URL candidate is missing"
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (useForm) {
      const params = new URLSearchParams();
      params.append("ex_name", payload.ex_name || "");
      params.append("exam_type", payload.exam_type || "");
      params.append("sheet_content", payload.sheet_content || "");
      params.append("knowledge_content", payload.knowledge_content || "");
      params.append("n_question", `${payload.n_question}`);

      return await fetch(serviceUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: controller.signal,
      });
    }

    return await fetch(serviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendGenerationRequestWithRetry(
  payload,
  useForm,
  serviceUrl,
  timeoutMs
) {
  let lastError = null;
  for (let attempt = 0; attempt <= QUESTION_SERVICE_RETRY_COUNT; attempt += 1) {
    try {
      return await sendGenerationRequest(payload, useForm, serviceUrl, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" || isTransientError(error)) {
        if (attempt >= QUESTION_SERVICE_RETRY_COUNT) break;
        const retryDelay = QUESTION_SERVICE_RETRY_DELAY_MS * (attempt + 1);
        await delay(retryDelay);
        continue;
      }
      throw error;
    }
  }

  if (lastError?.name === "AbortError" || isTransientError(lastError)) {
    throw new AppError(
      httpStatus.REQUEST_TIMEOUT,
      `Question service request timed out after ${timeoutMs}ms`
    );
  }

  throw new AppError(httpStatus.BAD_GATEWAY, "Failed to reach question service");
}

async function parseResponseContent(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await response.json().catch(() => null);
    return { result: json, rawText: null };
  }

  const rawText = await response.text().catch(() => null);
  if (!rawText) return { result: null, rawText: null };
  try {
    const json = JSON.parse(rawText);
    return { result: json, rawText };
  } catch (error) {
    return { result: null, rawText };
  }
}

function isBodyParseError(responseStatus, result, rawText) {
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
    responseStatus === 400 &&
    (rawText?.includes("error parsing the body") ||
      JSON.stringify(result || {}).includes("error parsing the body"));

  return parsingError || (responseStatus === 422 && missingFields);
}

export async function requestQuestionBatchFromAI({
  exam,
  nQuestion,
  examType = QUESTION_SERVICE_DEFAULT_EXAM_TYPE || "closed_book",
}) {
  const timeoutMs = resolveQuestionServiceTimeoutMs(nQuestion);
  const payload = {
    ex_name: exam?.name || "",
    sheet_content: exam?.effectivitySheetContent || "",
    knowledge_content: exam?.bodyOfKnowledgeContent || "",
    n_question: nQuestion,
    exam_type: examType || "closed_book",
  };

  const useFormFirst = QUESTION_SERVICE_MODE !== "json";
  if (!QUESTION_SERVICE_URL_CANDIDATES.length) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "QUESTION_SERVICE_URL is not configured"
    );
  }

  let lastError = null;
  let lastNotFoundMessage = "";

  for (const serviceUrl of QUESTION_SERVICE_URL_CANDIDATES) {
    try {
      let response = await sendGenerationRequestWithRetry(
        payload,
        useFormFirst,
        serviceUrl,
        timeoutMs
      );
      let { result, rawText } = await parseResponseContent(response);

      if (!response.ok && isBodyParseError(response.status, result, rawText)) {
        response = await sendGenerationRequestWithRetry(
          payload,
          !useFormFirst,
          serviceUrl,
          timeoutMs
        );
        const retryParsed = await parseResponseContent(response);
        result = retryParsed.result;
        rawText = retryParsed.rawText;
      }

      if (!response.ok) {
        const snippet =
          (rawText || (result ? JSON.stringify(result) : "")).slice(0, 500) || "";
        const message = `Question service error (${response.status}). ${snippet}`.trim();

        if (response.status === httpStatus.NOT_FOUND) {
          lastNotFoundMessage = message;
          continue;
        }

        throw new AppError(httpStatus.BAD_GATEWAY, message);
      }

      if (!result && !rawText) {
        throw new AppError(
          httpStatus.BAD_GATEWAY,
          "Question service returned an empty response"
        );
      }

      const payloadData = result?.text ?? result?.questions ?? result ?? rawText;
      const questions = extractQuestionsArray(payloadData);

      if (!Array.isArray(questions) || questions.length === 0) {
        throw new AppError(
          httpStatus.BAD_GATEWAY,
          "Question service returned an invalid questions payload"
        );
      }

      return {
        status: result?.status ?? "success",
        statusCode: result?.status_code ?? response.status,
        rawResponse: result ?? rawText,
        questions,
        serviceUrl,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof AppError) {
        const isGatewayError =
          error.statusCode === httpStatus.BAD_GATEWAY ||
          error.statusCode === httpStatus.REQUEST_TIMEOUT;
        if (isGatewayError) continue;
      }
    }
  }

  if (lastNotFoundMessage) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `${lastNotFoundMessage} Check QUESTION_SERVICE_URL and include a valid endpoint path.`
    );
  }

  if (lastError) throw lastError;

  throw new AppError(httpStatus.BAD_GATEWAY, "Failed to reach question service");
}

function parseAiValidationResponse(payload, totalCount) {
  if (!payload) return null;

  const mapByIndex = new Map();
  const assignEntry = (index, valid, reason = "", score = null) => {
    if (!Number.isInteger(index) || index < 0 || index >= totalCount) return;
    mapByIndex.set(index, {
      valid: Boolean(valid),
      reason: reason ? normalizeWhitespace(reason) : "",
      score: Number.isFinite(Number(score)) ? Number(score) : null,
    });
  };

  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => {
      const valid = entry?.valid ?? entry?.isValid ?? entry?.approved ?? true;
      assignEntry(index, valid, entry?.reason ?? entry?.message, entry?.score);
    });
    return mapByIndex;
  }

  if (Array.isArray(payload?.results)) {
    payload.results.forEach((entry, index) => {
      const mappedIndex =
        Number.isInteger(entry?.index) && entry.index >= 0 ? entry.index : index;
      const valid = entry?.valid ?? entry?.isValid ?? entry?.approved ?? true;
      assignEntry(
        mappedIndex,
        valid,
        entry?.reason ?? entry?.message,
        entry?.score
      );
    });
    return mapByIndex;
  }

  if (
    Array.isArray(payload?.validIndices) ||
    Array.isArray(payload?.invalidIndices)
  ) {
    const validSet = new Set(
      (payload.validIndices || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    );
    const invalidSet = new Set(
      (payload.invalidIndices || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    );
    for (let index = 0; index < totalCount; index += 1) {
      if (invalidSet.has(index)) {
        assignEntry(index, false, "ai_validation_failed");
      } else if (validSet.size > 0) {
        assignEntry(index, validSet.has(index), "ai_validation_filtered");
      }
    }
    return mapByIndex;
  }

  return null;
}

async function runAiValidation(questions, exam) {
  if (!questions.length) return new Map();

  if (!QUESTION_AI_VALIDATION_ENABLED || !QUESTION_AI_VALIDATION_URL) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    QUESTION_AI_VALIDATION_TIMEOUT_MS
  );

  try {
    const response = await fetch(QUESTION_AI_VALIDATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exam: {
          name: exam?.name || "",
          effectivitySheetContent: exam?.effectivitySheetContent || "",
          bodyOfKnowledgeContent: exam?.bodyOfKnowledgeContent || "",
        },
        questions: questions.map((candidate) => candidate.question),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json().catch(() => null);
    return parseAiValidationResponse(json, questions.length);
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function validateBatchCandidates(rawQuestions) {
  const batchHashSet = new Set();
  const candidates = [];
  const rejected = [];
  let duplicateInBatchCount = 0;
  let invalidCount = 0;

  rawQuestions.forEach((rawQuestion, index) => {
    const normalized = normalizeQuestionCandidate(rawQuestion, index);
    if (!normalized.isValid) {
      invalidCount += 1;
      rejected.push({
        index,
        questionHash: normalized.questionHash,
        reason: "rule_validation_failed",
        issues: normalized.issues,
        preview: normalized.preview,
      });
      return;
    }

    if (batchHashSet.has(normalized.questionHash)) {
      duplicateInBatchCount += 1;
      rejected.push({
        index,
        questionHash: normalized.questionHash,
        reason: "duplicate_in_batch",
        issues: ["duplicate_in_batch"],
        preview: normalized.preview,
      });
      return;
    }

    batchHashSet.add(normalized.questionHash);
    candidates.push({ ...normalized, sourceIndex: index });
  });

  return {
    candidates,
    rejected,
    duplicateInBatchCount,
    invalidCount,
  };
}

async function getNextBatchNumber(examId, contentHash) {
  const latest = await ExamQuestionBatch.findOne({ examId, contentHash })
    .sort({ batchNumber: -1 })
    .select("batchNumber")
    .lean();
  return (latest?.batchNumber || 0) + 1;
}

export async function stageAndProcessQuestionBatch({
  exam,
  contentHash,
  batchSize = QUESTION_BANK_DEFAULT_BATCH_SIZE,
  batchNumber = null,
  trigger = "manual",
  initiatedBy = null,
  examType = QUESTION_SERVICE_DEFAULT_EXAM_TYPE || "closed_book",
}) {
  const safeBatchSize = clampNumber(
    Number(batchSize) || QUESTION_BANK_DEFAULT_BATCH_SIZE,
    QUESTION_BANK_MIN_BATCH_SIZE,
    QUESTION_BANK_MAX_BATCH_SIZE
  );
  const effectiveBatchNumber =
    Number(batchNumber) > 0
      ? Number(batchNumber)
      : await getNextBatchNumber(exam._id, contentHash);

  const batchDoc = await ExamQuestionBatch.create({
    examId: exam._id,
    contentHash,
    batchNumber: effectiveBatchNumber,
    trigger,
    status: "requested",
    examSnapshot: {
      name: exam.name || "",
      effectivitySheetContent: exam.effectivitySheetContent || "",
      bodyOfKnowledgeContent: exam.bodyOfKnowledgeContent || "",
      examType: examType || "",
    },
    generationRequest: {
      n_question: safeBatchSize,
    },
    initiatedBy,
    startedAt: new Date(),
    summary: {
      requestedCount: safeBatchSize,
      generatedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      duplicateInBatchCount: 0,
      duplicateInBankCount: 0,
      invalidCount: 0,
      aiRejectedCount: 0,
    },
  });

  try {
    const generated = await requestQuestionBatchFromAI({
      exam,
      nQuestion: safeBatchSize,
      examType,
    });

    const rawQuestions = Array.isArray(generated.questions) ? generated.questions : [];

    batchDoc.status = "staged";
    batchDoc.generationResponse = {
      status: generated.status,
      statusCode: generated.statusCode,
      rawResponse: generated.rawResponse,
      rawQuestions,
    };
    batchDoc.summary.generatedCount = rawQuestions.length;
    await batchDoc.save();

    const validation = validateBatchCandidates(rawQuestions);
    let workingCandidates = validation.candidates;
    const rejectedQuestions = [...validation.rejected];

    const candidateHashes = workingCandidates.map((candidate) => candidate.questionHash);
    const existingHashesSet = new Set();
    if (candidateHashes.length) {
      const existing = await ExamQuestionBank.find({
        examId: exam._id,
        contentHash,
        questionHash: { $in: candidateHashes },
      })
        .select("questionHash")
        .lean();
      existing.forEach((doc) => existingHashesSet.add(doc.questionHash));
    }

    let duplicateInBankCount = 0;
    if (existingHashesSet.size > 0) {
      workingCandidates = workingCandidates.filter((candidate) => {
        const duplicate = existingHashesSet.has(candidate.questionHash);
        if (duplicate) {
          duplicateInBankCount += 1;
          rejectedQuestions.push({
            index: candidate.sourceIndex,
            questionHash: candidate.questionHash,
            reason: "duplicate_in_bank",
            issues: ["duplicate_in_bank"],
            preview: candidate.preview,
          });
        }
        return !duplicate;
      });
    }

    const aiValidationMap = await runAiValidation(workingCandidates, exam);
    let aiRejectedCount = 0;
    if (aiValidationMap && aiValidationMap.size > 0) {
      const aiFiltered = [];
      workingCandidates.forEach((candidate, index) => {
        const aiDecision = aiValidationMap.get(index);
        const aiValid = aiDecision ? Boolean(aiDecision.valid) : true;
        if (!aiValid) {
          aiRejectedCount += 1;
          rejectedQuestions.push({
            index: candidate.sourceIndex,
            questionHash: candidate.questionHash,
            reason: "ai_validation_failed",
            issues: [aiDecision?.reason || "ai_validation_failed"].filter(Boolean),
            preview: candidate.preview,
          });
          return;
        }

        aiFiltered.push({
          ...candidate,
          aiPassed: true,
          aiSkipped: false,
          aiIssues: aiDecision?.reason ? [aiDecision.reason] : [],
        });
      });
      workingCandidates = aiFiltered;
    } else {
      workingCandidates = workingCandidates.map((candidate) => ({
        ...candidate,
        aiPassed: true,
        aiSkipped: true,
        aiIssues: [],
      }));
    }

    const now = new Date();
    const bulkOperations = workingCandidates.map((candidate) => ({
      updateOne: {
        filter: {
          examId: exam._id,
          contentHash,
          questionHash: candidate.questionHash,
        },
        update: {
          $setOnInsert: {
            examId: exam._id,
            contentHash,
            questionHash: candidate.questionHash,
            questionTextNormalized: candidate.questionTextNormalized,
            question: candidate.question,
            sourceBatchId: batchDoc._id,
            status: "approved",
            approvedAt: now,
            validation: {
              rulesPassed: true,
              aiPassed: candidate.aiPassed,
              aiSkipped: candidate.aiSkipped,
              issues: candidate.aiIssues,
              validatedAt: now,
            },
          },
        },
        upsert: true,
      },
    }));

    let insertedCount = 0;
    if (bulkOperations.length > 0) {
      const bulkResult = await ExamQuestionBank.bulkWrite(bulkOperations, {
        ordered: false,
      });
      insertedCount = Number(bulkResult?.upsertedCount || 0);
    }

    const concurrentDuplicateCount = Math.max(
      workingCandidates.length - insertedCount,
      0
    );
    duplicateInBankCount += concurrentDuplicateCount;

    const summary = {
      requestedCount: safeBatchSize,
      generatedCount: rawQuestions.length,
      approvedCount: insertedCount,
      rejectedCount: rejectedQuestions.length + concurrentDuplicateCount,
      duplicateInBatchCount: validation.duplicateInBatchCount,
      duplicateInBankCount,
      invalidCount: validation.invalidCount,
      aiRejectedCount,
    };

    batchDoc.summary = summary;
    batchDoc.approvedQuestionHashes = workingCandidates
      .slice(0, insertedCount)
      .map((candidate) => candidate.questionHash);
    batchDoc.rejectedQuestions = rejectedQuestions.slice(0, 200);
    batchDoc.status =
      insertedCount > 0 && summary.rejectedCount === 0
        ? "approved"
        : insertedCount > 0
        ? "partial"
        : "validated";
    batchDoc.completedAt = new Date();
    await batchDoc.save();

    return {
      batchId: batchDoc._id,
      batchNumber: batchDoc.batchNumber,
      status: batchDoc.status,
      ...summary,
    };
  } catch (error) {
    batchDoc.status = "failed";
    batchDoc.errorMessage = error?.message || "Batch generation failed";
    batchDoc.completedAt = new Date();
    await batchDoc.save();
    throw error;
  }
}

export function buildExamContentHash(exam = {}) {
  const payload = JSON.stringify({
    name: normalizeComparable(exam.name),
    effectivitySheetContent: normalizeComparable(exam.effectivitySheetContent),
    bodyOfKnowledgeContent: normalizeComparable(exam.bodyOfKnowledgeContent),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function countApprovedQuestionBankItems({ examId, contentHash }) {
  return ExamQuestionBank.countDocuments({
    examId,
    contentHash,
    status: "approved",
  });
}

export async function generateQuestionBankInBatches({
  exam,
  contentHash = null,
  targetCount = QUESTION_BANK_DEFAULT_TARGET,
  batchSize = QUESTION_BANK_DEFAULT_BATCH_SIZE,
  totalBatches = null,
  maxBatchesPerRun = null,
  initiatedBy = null,
  trigger = "manual",
  examType = QUESTION_SERVICE_DEFAULT_EXAM_TYPE || "closed_book",
}) {
  const resolvedContentHash = contentHash || buildExamContentHash(exam);
  const safeBatchSize = clampNumber(
    Number(batchSize) || QUESTION_BANK_DEFAULT_BATCH_SIZE,
    QUESTION_BANK_MIN_BATCH_SIZE,
    QUESTION_BANK_MAX_BATCH_SIZE
  );
  const safeTargetCount = Math.max(
    Number(targetCount) || QUESTION_BANK_DEFAULT_TARGET,
    1
  );
  const computedTotalBatches = Math.max(
    Math.ceil(safeTargetCount / Math.max(safeBatchSize, 1)),
    1
  );
  const safeTotalBatches = Math.max(
    Number(totalBatches) || computedTotalBatches,
    1
  );
  const safeMaxBatchesPerRun =
    maxBatchesPerRun !== undefined && maxBatchesPerRun !== null
      ? Math.max(Number(maxBatchesPerRun) || 1, 1)
      : safeTotalBatches;

  const approvedBefore = await countApprovedQuestionBankItems({
    examId: exam._id,
    contentHash: resolvedContentHash,
  });

  if (approvedBefore >= safeTargetCount) {
    return {
      contentHash: resolvedContentHash,
      targetCount: safeTargetCount,
      batchSize: safeBatchSize,
      requestedBatches: safeTotalBatches,
      executedBatches: 0,
      approvedBefore,
      approvedAfter: approvedBefore,
      insertedThisRun: 0,
      batches: [],
      completedTarget: true,
      failed: false,
      failureMessage: null,
    };
  }

  const batches = [];
  let insertedThisRun = 0;
  let executedBatches = 0;
  let failure = null;

  const missingCount = safeTargetCount - approvedBefore;
  const plannedBatches = Math.min(
    safeTotalBatches,
    safeMaxBatchesPerRun,
    Math.max(1, Math.ceil(missingCount / safeBatchSize))
  );
  let nextBatchNumber = await getNextBatchNumber(exam._id, resolvedContentHash);

  for (let batchIndex = 0; batchIndex < plannedBatches; batchIndex += 1) {
    try {
      const batchSummary = await stageAndProcessQuestionBatch({
        exam,
        contentHash: resolvedContentHash,
        batchSize: safeBatchSize,
        batchNumber: nextBatchNumber,
        initiatedBy,
        trigger,
        examType,
      });
      executedBatches += 1;
      insertedThisRun += batchSummary.approvedCount;
      batches.push(batchSummary);
      nextBatchNumber += 1;

      const approvedCurrent = await countApprovedQuestionBankItems({
        examId: exam._id,
        contentHash: resolvedContentHash,
      });
      if (approvedCurrent >= safeTargetCount) break;
    } catch (error) {
      failure = error;
      break;
    }
  }

  const approvedAfter = await countApprovedQuestionBankItems({
    examId: exam._id,
    contentHash: resolvedContentHash,
  });

  return {
    contentHash: resolvedContentHash,
    targetCount: safeTargetCount,
    batchSize: safeBatchSize,
    requestedBatches: safeTotalBatches,
    executedBatches,
    approvedBefore,
    approvedAfter,
    insertedThisRun,
    completedTarget: approvedAfter >= safeTargetCount,
    failed: Boolean(failure),
    failureMessage: failure?.message || null,
    batches,
  };
}

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(value);
}

async function countAvailableForSelection({ examId, contentHash, excludeHashes = [] }) {
  const match = {
    examId: toObjectId(examId),
    contentHash,
    status: "approved",
  };
  if (Array.isArray(excludeHashes) && excludeHashes.length > 0) {
    match.questionHash = { $nin: excludeHashes };
  }
  const [result] = await ExamQuestionBank.aggregate([
    { $match: match },
    { $count: "total" },
  ]);
  return result?.total || 0;
}

export async function selectQuestionsFromBank({
  examId,
  contentHash,
  count,
  excludeHashes = [],
}) {
  const safeCount = Math.max(Number(count) || 0, 0);
  if (!safeCount) return [];

  const match = {
    examId: toObjectId(examId),
    contentHash,
    status: "approved",
  };
  if (Array.isArray(excludeHashes) && excludeHashes.length > 0) {
    match.questionHash = { $nin: excludeHashes };
  }

  const pipeline = [{ $match: match }, { $sample: { size: safeCount } }];
  return ExamQuestionBank.aggregate(pipeline);
}

export async function ensureQuestionBankCapacity({
  exam,
  contentHash,
  requiredCount,
  excludeHashes = [],
  initiatedBy = null,
  trigger = "auto_refill",
  examType = QUESTION_SERVICE_DEFAULT_EXAM_TYPE || "closed_book",
}) {
  const safeRequiredCount = Math.max(Number(requiredCount) || 0, 0);
  if (!safeRequiredCount) {
    return {
      generated: false,
      availableCount: 0,
      summary: null,
    };
  }

  const availableCount = await countAvailableForSelection({
    examId: exam._id,
    contentHash,
    excludeHashes,
  });

  if (availableCount >= safeRequiredCount) {
    return {
      generated: false,
      availableCount,
      summary: null,
    };
  }

  const approvedTotal = await countApprovedQuestionBankItems({
    examId: exam._id,
    contentHash,
  });
  const missing = safeRequiredCount - availableCount;
  const batchesNeeded = Math.max(
    1,
    Math.ceil(missing / QUESTION_BANK_DEFAULT_BATCH_SIZE)
  );
  const summary = await generateQuestionBankInBatches({
    exam,
    contentHash,
    targetCount: approvedTotal + Math.max(missing, QUESTION_BANK_DEFAULT_BATCH_SIZE),
    batchSize: QUESTION_BANK_DEFAULT_BATCH_SIZE,
    totalBatches: batchesNeeded,
    maxBatchesPerRun: batchesNeeded,
    initiatedBy,
    trigger,
    examType,
  });

  const availableAfter = await countAvailableForSelection({
    examId: exam._id,
    contentHash,
    excludeHashes,
  });

  return {
    generated: true,
    availableCount: availableAfter,
    summary,
  };
}

export async function getQuestionBankStatus({ examId, contentHash }) {
  const [approvedCount, totalCount, lastBatch, batchStatusAgg] = await Promise.all([
    ExamQuestionBank.countDocuments({
      examId,
      contentHash,
      status: "approved",
    }),
    ExamQuestionBank.countDocuments({ examId, contentHash }),
    ExamQuestionBatch.findOne({ examId, contentHash })
      .sort({ batchNumber: -1 })
      .lean(),
    ExamQuestionBatch.aggregate([
      { $match: { examId: toObjectId(examId), contentHash } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const batchStatus = {};
  batchStatusAgg.forEach((item) => {
    batchStatus[item._id] = item.count;
  });

  return {
    contentHash,
    approvedCount,
    totalCount,
    lastBatchNumber: lastBatch?.batchNumber || 0,
    lastBatchStatus: lastBatch?.status || null,
    lastBatchSummary: lastBatch?.summary || null,
    batchStatus,
  };
}

export async function listQuestionBankQuestions({
  examId,
  contentHash,
  page = 1,
  limit = 20,
  search = "",
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const normalizedSearch = normalizeWhitespace(search);

  const filter = {
    examId: toObjectId(examId),
    contentHash,
    status: "approved",
  };

  if (normalizedSearch) {
    const regex = new RegExp(escapeRegex(normalizedSearch), "i");
    filter.$or = [
      { "question.question": regex },
      { "question.category": regex },
      { "question.tags": regex },
    ];
  }

  const skip = (safePage - 1) * safeLimit;
  const [items, total] = await Promise.all([
    ExamQuestionBank.find(filter)
      .sort({ approvedAt: -1, createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select(
        "questionHash question approvedAt createdAt updatedAt sourceBatchId validation"
      )
      .lean(),
    ExamQuestionBank.countDocuments(filter),
  ]);

  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);

  return {
    questions: items.map((item) => ({
      questionId: item?._id,
      questionHash: item?.questionHash || "",
      question: item?.question?.question || "",
      options: Array.isArray(item?.question?.options) ? item.question.options : [],
      explanation: item?.question?.explanation || "",
      category: item?.question?.category || "",
      tags: Array.isArray(item?.question?.tags) ? item.question.tags : [],
      metadata: item?.question?.metadata || {},
      approvedAt: item?.approvedAt || null,
      sourceBatchId: item?.sourceBatchId || null,
      validation: item?.validation || null,
    })),
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasPrevPage: safePage > 1,
      hasNextPage: safePage < totalPages,
    },
  };
}
