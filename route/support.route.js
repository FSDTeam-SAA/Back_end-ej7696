import express from "express";
import {
  bulkDeleteSupportTickets,
  createSupportTicket,
  deleteSupportTicket,
  getSupportTicketDetails,
  getSupportTickets,
  receiveInboundSupportReply,
  replyToSupportTicket,
} from "../controller/support.controller.js";
import upload from "../middleware/multer.middleware.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/", protect, upload.single("attachment"), createSupportTicket);
router.get("/", protect, getSupportTickets);
router.post("/inbound/email", upload.none(), receiveInboundSupportReply);
router.delete("/bulk", protect, bulkDeleteSupportTickets);
router.get("/:ticketId", protect, getSupportTicketDetails);
router.delete("/:ticketId", protect, deleteSupportTicket);
router.post(
  "/:ticketId/reply",
  protect,
  upload.single("attachment"),
  replyToSupportTicket
);

export default router; 
