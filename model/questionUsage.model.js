import mongoose, { Schema } from "mongoose";

const questionUsageSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    monthKey: { type: String, required: true }, // e.g., 2026-01
    questionsUsed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

questionUsageSchema.index({ userId: 1, monthKey: 1, examId: 1 }, { unique: true });

export const QuestionUsage = mongoose.model("QuestionUsage", questionUsageSchema);
