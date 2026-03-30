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
      enum: ["stripe", "paypal", "manual"],
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

export const ProfessionalPlanPurchase = mongoose.model(
  "ProfessionalPlanPurchase",
  professionalPlanPurchaseSchema
);
