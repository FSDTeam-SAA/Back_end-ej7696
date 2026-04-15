import mongoose, { Schema } from "mongoose";

const batchSummarySchema = new Schema(
  {
    requestedCount: { type: Number, default: 0, min: 0 },
    generatedCount: { type: Number, default: 0, min: 0 },
    approvedCount: { type: Number, default: 0, min: 0 },
    rejectedCount: { type: Number, default: 0, min: 0 },
    duplicateInBatchCount: { type: Number, default: 0, min: 0 },
    duplicateInBankCount: { type: Number, default: 0, min: 0 },
    invalidCount: { type: Number, default: 0, min: 0 },
    aiRejectedCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const rejectedQuestionSchema = new Schema(
  {
    index: { type: Number, default: 0, min: 0 },
    questionHash: { type: String, default: "" },
    reason: { type: String, default: "" },
    issues: { type: [String], default: [] },
    preview: { type: String, default: "" },
  },
  { _id: false }
);

const stagedQuestionSchema = new Schema(
  {
    questionHash: { type: String, default: "" },
    questionTextNormalized: { type: String, default: "" },
    question: {
      question: { type: String, default: "" },
      options: {
        type: [
          new Schema(
            {
              key: { type: String, default: "" },
              option: { type: String, default: "" },
              is_correct: { type: Boolean, default: false },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      explanation: { type: String, default: "" },
      category: { type: String, default: "" },
      tags: { type: [String], default: [] },
      metadata: { type: Schema.Types.Mixed, default: {} },
    },
    validation: {
      rulesPassed: { type: Boolean, default: false },
      aiPassed: { type: Boolean, default: true },
      aiSkipped: { type: Boolean, default: true },
      issues: { type: [String], default: [] },
      validatedAt: { type: Date, default: null },
    },
  },
  { _id: false }
);

const examQuestionBatchSchema = new Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    contentHash: { type: String, required: true, trim: true, index: true },
    batchNumber: { type: Number, required: true, min: 1 },
    trigger: {
      type: String,
      enum: ["manual", "exam_update", "auto_refill", "user_regenerate", "system"],
      default: "manual",
    },
    status: {
      type: String,
      enum: ["requested", "staged", "validated", "approved", "partial", "failed"],
      default: "requested",
      index: true,
    },
    examSnapshot: {
      name: { type: String, default: "" },
      effectivitySheetContent: { type: String, default: "" },
      bodyOfKnowledgeContent: { type: String, default: "" },
      examType: { type: String, default: "" },
    },
    generationRequest: {
      n_question: { type: Number, default: 0, min: 0 },
    },
    generationResponse: {
      status: { type: Schema.Types.Mixed, default: null },
      statusCode: { type: Schema.Types.Mixed, default: null },
      rawResponse: { type: Schema.Types.Mixed, default: null },
      rawQuestions: { type: [Schema.Types.Mixed], default: [] },
    },
    summary: { type: batchSummarySchema, default: () => ({}) },
    stagedQuestions: { type: [stagedQuestionSchema], default: [] },
    approvedQuestionHashes: { type: [String], default: [] },
    rejectedQuestions: { type: [rejectedQuestionSchema], default: [] },
    errorMessage: { type: String, default: "" },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

examQuestionBatchSchema.index(
  { examId: 1, contentHash: 1, batchNumber: 1 },
  { unique: true }
);
examQuestionBatchSchema.index({ examId: 1, contentHash: 1, status: 1 });

export const ExamQuestionBatch = mongoose.model(
  "ExamQuestionBatch",
  examQuestionBatchSchema
);
