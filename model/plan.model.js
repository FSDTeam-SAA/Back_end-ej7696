import mongoose, { Schema } from "mongoose";

// Allowed plan durations. One plan per duration (max 3 plans total).
export const PLAN_DURATIONS = {
  "One Month": { intervalCount: 1, intervalUnit: "months" },
  "Three Months": { intervalCount: 3, intervalUnit: "months" },
  "Six Months": { intervalCount: 6, intervalUnit: "months" },
};

export const PLAN_DURATION_LABELS = Object.keys(PLAN_DURATIONS);

const planSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    durationLabel: {
      type: String,
      required: true,
      enum: PLAN_DURATION_LABELS,
      unique: true,
    },
    intervalCount: { type: Number, required: true, min: 1 },
    intervalUnit: { type: String, default: "months" },
    description: {
      type: String,
      default: "What's included in your plan",
    },
    features: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
  },
  { timestamps: true }
);

export const Plan = mongoose.model("Plan", planSchema);
