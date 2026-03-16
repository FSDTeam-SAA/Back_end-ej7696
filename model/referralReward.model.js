import mongoose, { Schema } from "mongoose";

const referralRewardSchema = new Schema(
  {
    relationshipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralRelationship",
      required: true,
      index: true,
    },
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
      index: true,
    },
    planPurchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfessionalPlanPurchase",
      default: null,
    },
    resourcePurchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResourcePurchase",
      default: null,
    },
    examAccessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExamAccess",
      default: null,
    },
    signupRelationshipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralRelationship",
      default: null,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.1,
    },
    commissionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "available", "paid_out", "voided"],
      default: "pending",
      index: true,
    },
    pendingUntil: {
      type: Date,
      required: true,
      index: true,
    },
    availableAt: {
      type: Date,
      default: null,
    },
    paidOutAt: {
      type: Date,
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidReason: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

referralRewardSchema.index({ referrerUserId: 1, status: 1, pendingUntil: 1 });
referralRewardSchema.index({ planPurchaseId: 1 }, { unique: true, sparse: true });
referralRewardSchema.index({ resourcePurchaseId: 1 }, { unique: true, sparse: true });
referralRewardSchema.index({ examAccessId: 1 }, { unique: true, sparse: true });
referralRewardSchema.index({ signupRelationshipId: 1 }, { unique: true, sparse: true });

export const ReferralReward = mongoose.model("ReferralReward", referralRewardSchema);
