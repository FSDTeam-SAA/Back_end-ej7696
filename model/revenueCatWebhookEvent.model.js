import mongoose, { Schema } from "mongoose";

const revenueCatWebhookEventSchema = new Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    appUserId: { type: String, trim: true, default: "", index: true },
    originalAppUserId: { type: String, trim: true, default: "" },
    appId: { type: String, trim: true, default: "" },
    environment: {
      type: String,
      enum: ["SANDBOX", "PRODUCTION", "UNKNOWN"],
      default: "UNKNOWN",
      index: true,
    },
    store: { type: String, trim: true, uppercase: true, default: "" },
    productId: { type: String, trim: true, default: "", index: true },
    transactionId: { type: String, trim: true, default: "", index: true },
    originalTransactionId: { type: String, trim: true, default: "", index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["processing", "processed", "ignored", "failed"],
      default: "processing",
      index: true,
    },
    processingAttempts: { type: Number, default: 1, min: 1 },
    processedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const RevenueCatWebhookEvent = mongoose.model(
  "RevenueCatWebhookEvent",
  revenueCatWebhookEventSchema
);
