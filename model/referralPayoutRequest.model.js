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

const referralPayoutRequestSchema = new Schema(
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
    payoutMethod: {
      type: String,
      enum: ["cash"],
      default: "cash",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paid"],
      default: "pending",
      index: true,
    },
    rewardAllocations: {
      type: [allocationSchema],
      default: [],
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

referralPayoutRequestSchema.index({ userId: 1, createdAt: -1 });

export const ReferralPayoutRequest = mongoose.model(
  "ReferralPayoutRequest",
  referralPayoutRequestSchema
);
