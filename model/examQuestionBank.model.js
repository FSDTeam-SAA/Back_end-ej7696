import mongoose, { Schema } from "mongoose";

const questionOptionSchema = new Schema(
  {
    key: { type: String, default: "" },
    option: { type: String, required: true, trim: true },
    is_correct: { type: Boolean, default: false },
  },
  { _id: false }
);

const questionValidationSchema = new Schema(
  {
    rulesPassed: { type: Boolean, default: false },
    aiPassed: { type: Boolean, default: true },
    aiSkipped: { type: Boolean, default: true },
    issues: { type: [String], default: [] },
    validatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const examQuestionBankSchema = new Schema(
  {
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    contentHash: { type: String, required: true, trim: true, index: true },
    questionHash: { type: String, required: true, trim: true },
    questionTextNormalized: { type: String, required: true, trim: true },
    question: {
      question: { type: String, required: true, trim: true },
      questionType: {
        type: String,
        enum: ["single", "multi", "true_false"],
        default: "single",
      },
      options: { type: [questionOptionSchema], default: [] },
      explanation: { type: String, default: "" },
      category: { type: String, default: "" },
      tags: { type: [String], default: [] },
      metadata: { type: Schema.Types.Mixed, default: {} },
    },
    validation: { type: questionValidationSchema, default: () => ({}) },
    sourceBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamQuestionBatch",
      default: null,
    },
    status: {
      type: String,
      enum: ["approved", "archived"],
      default: "approved",
      index: true,
    },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

examQuestionBankSchema.index(
  { examId: 1, contentHash: 1, questionHash: 1 },
  { unique: true }
);
examQuestionBankSchema.index({ examId: 1, contentHash: 1, status: 1 });

export const ExamQuestionBank = mongoose.model(
  "ExamQuestionBank",
  examQuestionBankSchema
);
