import mongoose, { Schema } from "mongoose";

const referralRelationshipSchema = new Schema(
  {
    referrerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referredUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    referralCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ["active", "disqualified"],
      default: "active",
      index: true,
    },
    disqualifiedReason: {
      type: String,
      trim: true,
      default: "",
    },
    fraudChecks: {
      selfReferral: { type: Boolean, default: false },
      sameEmail: { type: Boolean, default: false },
      sameDeviceId: { type: Boolean, default: false },
      samePaymentAccount: { type: Boolean, default: false },
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    upgradedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

referralRelationshipSchema.index({ referrerUserId: 1, createdAt: -1 });

export const ReferralRelationship = mongoose.model(
  "ReferralRelationship",
  referralRelationshipSchema
);
