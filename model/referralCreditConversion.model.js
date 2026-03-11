import mongoose, { Schema } from "mongoose";

const allocationSchema = new Schema(
  {
    rewardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralReward",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const referralCreditConversionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    rewardAllocations: {
      type: [allocationSchema],
      default: [],
    },
    creditBalanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    creditBalanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    convertedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

referralCreditConversionSchema.index({ userId: 1, createdAt: -1 });

export const ReferralCreditConversion = mongoose.model(
  "ReferralCreditConversion",
  referralCreditConversionSchema
);
