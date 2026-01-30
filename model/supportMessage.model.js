import mongoose, { Schema } from "mongoose";

const supportMessageSchema = new Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "admin", "sub-admin"],
      default: "user",
    },
    message: { type: String, trim: true, required: true },
    attachment: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });

export const SupportMessage = mongoose.model(
  "SupportMessage",
  supportMessageSchema
);
