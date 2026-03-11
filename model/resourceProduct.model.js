import mongoose, { Schema } from "mongoose";

const resourceProductSchema = new Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResourceCategory",
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    shortDescription: {
      type: String,
      trim: true,
      default: "",
    },
    fullDescription: {
      type: String,
      trim: true,
      default: "",
    },
    coverImageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    contentUrl: {
      type: String,
      trim: true,
      default: "",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    upgradeDiscountPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "USD",
    },
    isBundle: {
      type: Boolean,
      default: false,
    },
    bundleIncludes: {
      type: [String],
      default: [],
    },
    previewAvailable: {
      type: Boolean,
      default: true,
    },
    previewTitle: {
      type: String,
      trim: true,
      default: "Introduction",
    },
    previewContent: {
      type: String,
      trim: true,
      default: "",
    },
    previewUrl: {
      type: String,
      trim: true,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    showInUpgradeAddOn: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

resourceProductSchema.index({ categoryId: 1, sortOrder: 1, createdAt: 1 });

export const ResourceProduct = mongoose.model("ResourceProduct", resourceProductSchema);
