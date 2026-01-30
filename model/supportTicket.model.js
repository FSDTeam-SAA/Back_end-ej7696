import mongoose, { Schema } from "mongoose";

const supportTicketSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: { type: String, trim: true, required: true },
    phone: { type: String, trim: true },
    subject: { type: String, trim: true, required: true },
    description: { type: String, trim: true, required: true },
    status: {
      type: String,
      enum: ["open", "pending", "closed"],
      default: "open",
    },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });

export const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);
