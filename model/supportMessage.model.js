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
    senderEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    message: { type: String, trim: true, required: true },
    source: {
      type: String,
      enum: ["app", "email_inbound"],
      default: "app",
    },
    externalMessageId: {
      type: String,
      trim: true,
    },
    attachment: {
      public_id: { type: String, default: "" },
      url: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });
supportMessageSchema.index({ externalMessageId: 1 }, { unique: true, sparse: true });

export const SupportMessage = mongoose.model(
  "SupportMessage",
  supportMessageSchema
);
