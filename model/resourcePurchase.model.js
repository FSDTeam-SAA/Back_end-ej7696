import mongoose, { Schema } from "mongoose";

const resourcePurchaseSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResourceCategory",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResourceProduct",
      required: true,
      index: true,
    },
    productCode: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    purchaseType: {
      type: String,
      enum: [
        "single",
        "bundle",
        "professional_upgrade_addon",
        "exam_unlock_addon",
        "manual",
      ],
      default: "single",
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
    },
    revenueTag: {
      type: String,
      trim: true,
      default: "ebook_single",
      index: true,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    basePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    finalPrice: {
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
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
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
      default: "",
      index: true,
    },
    paypalOrderId: {
      type: String,
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
  },
  { timestamps: true }
);

resourcePurchaseSchema.index({ userId: 1, productCode: 1, status: 1, createdAt: -1 });

export const ResourcePurchase = mongoose.model("ResourcePurchase", resourcePurchaseSchema);
