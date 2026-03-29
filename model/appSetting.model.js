import mongoose, { Schema } from "mongoose";

const appSettingSchema = new Schema(
  {
    professionalPlanPrice: { type: Number, default: 180 },
    examUnlockPrice: { type: Number, default: 150 },
    referralCommissionRate: { type: Number, default: 0.1, min: 0, max: 1 },
    currency: { type: String, default: "USD" },
    professionalPlanIntervalCount: { type: Number, default: 3 },
    professionalPlanIntervalUnit: { type: String, default: "months" },
    professionalPlanDescription: {
      type: String,
      default: "What's included in your plan",
    },
    professionalPlanFeatures: {
      type: [String],
      default: [
        "Access to selected free exams",
        "Full-length mock exams",
        "Timed & full simulation modes",
        "Interactive study mode",
        "Progress tracking, performance dashboard & exam history",
        "Detailed explanations with code references",
        "All smart study tools",
      ],
    },
  },
  { timestamps: true }
);

export const AppSetting = mongoose.model("AppSetting", appSettingSchema);
