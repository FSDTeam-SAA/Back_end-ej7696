import mongoose, { Schema } from "mongoose";

const resourceCategorySchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    shortCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
    },
    description: {
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
  },
  { timestamps: true }
);

resourceCategorySchema.index({ sortOrder: 1, createdAt: 1 });

export const ResourceCategory = mongoose.model("ResourceCategory", resourceCategorySchema);
