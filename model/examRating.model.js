import mongoose, { Schema } from "mongoose";

const examRatingSchema = new Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam", required: true },
    stars: { type: Number, min: 1, max: 5, required: true },
    feedbackText: { type: String, default: "" },
    displayName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "published"],
      default: "pending",
    },
  },
  { timestamps: true }
);

examRatingSchema.index({ userId: 1, examId: 1 }, { unique: true });
examRatingSchema.index({ status: 1, createdAt: -1 });

export const ExamRating = mongoose.model("ExamRating", examRatingSchema);
