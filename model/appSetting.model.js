import mongoose, { Schema } from "mongoose";

const appSettingSchema = new Schema(
  {
    professionalPlanPrice: { type: Number, default: 180 },
    examUnlockPrice: { type: Number, default: 150 },
    currency: { type: String, default: "USD" },
  },
  { timestamps: true }
);

export const AppSetting = mongoose.model("AppSetting", appSettingSchema);