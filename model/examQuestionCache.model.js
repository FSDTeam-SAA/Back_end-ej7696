import mongoose, { Schema } from "mongoose";

const examQuestionCacheSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    examName: { type: String, default: "" },
    sheetContent: { type: String, default: "" },
    knowledgeContent: { type: String, default: "" },
    n_question: { type: Number, default: 1, min: 1 },
    durationMinutes: { type: Number, default: null },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    status: { type: Schema.Types.Mixed, default: null },
    statusCode: { type: Schema.Types.Mixed, default: null },
    questions: { type: Schema.Types.Mixed, default: [] },
    rawResponse: { type: Schema.Types.Mixed, default: {} },
    progress: {
      answers: { type: Schema.Types.Mixed, default: [] },
      timeSpentSec: { type: [Number], default: [] },
      currentIndex: { type: Number, default: 0 },
      flaggedQuestionIds: { type: [String], default: [] },
      lastSavedAt: { type: Date, default: null },
    },
    lastSubmission: {
      answers: { type: Schema.Types.Mixed, default: [] },
      score: { type: Schema.Types.Mixed, default: null },
      submittedAt: { type: Date, default: null },
    },
    subscriptionUsage: {
      cycleStart: { type: Date, default: null },
      cycleEnd: { type: Date, default: null },
      questionsGenerated: { type: Number, default: 0, min: 0 },
      lastGeneratedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

examQuestionCacheSchema.index({ userId: 1, examId: 1 }, { unique: true });

export const ExamQuestionCache = mongoose.model(
  "ExamQuestionCache",
  examQuestionCacheSchema
);
