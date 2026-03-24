import express from "express";
import {
  createSupportTicket,
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
router.get("/:ticketId", protect, getSupportTicketDetails);
router.get("/:ticketId/reply", protect, replyToSupportTicket);
router.post(
  "/:ticketId/reply",
  protect,
  upload.single("attachment"),
  replyToSupportTicket
);

export default router; 
