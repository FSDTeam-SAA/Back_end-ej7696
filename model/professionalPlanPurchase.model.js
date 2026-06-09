import mongoose, { Schema } from "mongoose";

const professionalPlanPurchaseSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["stripe", "paypal", "apple", "manual"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded", "cancelled"],
      default: "pending",
      index: true,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    planBasePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    referralDiscountRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    referralDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    planFinalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    addonProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResourceProduct",
      default: null,
      index: true,
    },
    addonProductCode: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    addonBasePrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    addonFinalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    revenueTags: {
      type: [String],
      default: ["professional_plan"],
    },
    referralCodeApplied: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    referralRelationshipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralRelationship",
      default: null,
      index: true,
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: undefined,
    },
    paypalOrderId: {
      type: String,
      trim: true,
      default: undefined,
    },
    appleProductId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    appleTransactionId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    appleOriginalTransactionId: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    paymentAccountFingerprint: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    purchasedAt: {
      type: Date,
      default: null,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundStatus: {
      type: String,
      enum: ["none", "partial", "full"],
      default: "none",
    },
    refundHistory: {
      type: [
        {
          refundedAt: { type: Date, default: Date.now },
          amount: { type: Number, required: true, min: 0 },
          reason: { type: String, trim: true, default: "" },
          adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          type: { type: String, enum: ["full", "partial"], required: true },
          stripeRefundId: { type: String, trim: true, default: "" },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

professionalPlanPurchaseSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripePaymentIntentId: { $exists: true, $type: "string", $ne: "" },
    },
  }
);
professionalPlanPurchaseSchema.index(
  { paypalOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paypalOrderId: { $exists: true, $type: "string", $ne: "" },
    },
  }
);
professionalPlanPurchaseSchema.index(
  { appleTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      appleTransactionId: { $exists: true, $type: "string", $ne: "" },
    },
  }
);

export const ProfessionalPlanPurchase = mongoose.model(
  "ProfessionalPlanPurchase",
  professionalPlanPurchaseSchema
);
