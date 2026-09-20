import mongoose, { Schema } from "mongoose";

const providerItemSchema = new Schema(
  {
    productId: { type: String, required: true },
    basePlanId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "updating", "confirmed", "failed"],
      default: "pending",
    },
    storeProductStatus: { type: String, default: "" },
    externalId: { type: String, default: "" },
    error: { type: String, default: "" },
    confirmedAt: { type: Date, default: null },
  },
  { _id: false }
);

const providerSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["pending", "updating", "confirmed", "partial", "failed", "skipped"],
      default: "pending",
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: "" },
    items: { type: [providerItemSchema], default: [] },
  },
  { _id: false }
);

const storePriceUpdateSchema = new Schema(
  {
    target: {
      type: String,
      enum: ["professional_plan", "exam_unlock"],
      required: true,
      index: true,
    },
    currency: { type: String, enum: ["USD"], default: "USD" },
    oldPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "partial", "completed", "failed"],
      default: "queued",
      index: true,
    },
    apple: { type: providerSchema, default: () => ({}) },
    google: { type: providerSchema, default: () => ({}) },
    database: { type: providerSchema, default: () => ({}) },
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    retryCount: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

storePriceUpdateSchema.index({ target: 1, createdAt: -1 });

export const StorePriceUpdate = mongoose.model(
  "StorePriceUpdate",
  storePriceUpdateSchema
);
