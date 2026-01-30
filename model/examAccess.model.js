import mongoose, { Schema } from "mongoose";

const examAccessSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    status: {
      type: String,
      enum: ["free", "unlocked"],
      default: "free",
    },
    purchaseType: {
      type: String,
      enum: ["exam", "plan", "manual"],
      default: "exam",
    },
    maxQuestionsPerSession: { type: Number, default: 2 },
    purchasePrice: { type: Number, default: 0 },
    paypalOrderId: { type: String, default: "" },
    stripePaymentIntentId: { type: String, default: "" },
    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded", "voided", "manual"],
      default: "pending",
    },
    purchasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

examAccessSchema.index({ userId: 1, examId: 1 }, { unique: true });

export const ExamAccess = mongoose.model("ExamAccess", examAccessSchema);
