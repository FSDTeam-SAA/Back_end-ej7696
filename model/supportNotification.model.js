import mongoose, { Schema } from "mongoose";

const supportNotificationSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "support_new_ticket",
        "support_admin_reply",
        "support_user_reply",
      ],
      required: true,
    },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

supportNotificationSchema.index({ userId: 1, createdAt: -1 });

export const SupportNotification = mongoose.model(
  "SupportNotification",
  supportNotificationSchema
);
