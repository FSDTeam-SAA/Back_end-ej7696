import mongoose, { Schema } from "mongoose";

const examAttemptSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["IN_PROGRESS", "SUBMITTED", "TIMEOUT"],
      default: "IN_PROGRESS",
    },
    score: { type: Number, default: null },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    unansweredCount: { type: Number, default: 0 },
    flaggedQuestionIds: { type: [String], default: [] },
    answers: [
      {
        questionId: { type: String, default: "" },
        selectedKey: { type: Schema.Types.Mixed, default: null },
        correctAnswer: { type: Schema.Types.Mixed, default: null },
        isCorrect: { type: Boolean, default: false },
        timeSpentSec: { type: Number, default: 0 },
      },
    ],
    reviewData: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

examAttemptSchema.index({ userId: 1, examId: 1, startedAt: -1 });

export const ExamAttempt = mongoose.model("ExamAttempt", examAttemptSchema);
