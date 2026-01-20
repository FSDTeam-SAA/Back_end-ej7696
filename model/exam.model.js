import mongoose, { Schema } from "mongoose";

const examSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    effectivitySheetContent: {
      type: String,
      default: "",
      trim: true,
    },
    bodyOfKnowledgeContent: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    image: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export const Exam = mongoose.model("Exam", examSchema);
