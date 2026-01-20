import mongoose, { Schema } from "mongoose";

const testimonialSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    testimonial: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    image: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export const Testimonial = mongoose.model("Testimonial", testimonialSchema);
