import express from "express";
import {
  createSupportTicket,
  replyToSupportTicket,
} from "../controller/support.controller.js";
import upload from "../middleware/multer.middleware.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/", protect, upload.single("attachment"), createSupportTicket);
router.post(
  "/:ticketId/reply",
  protect,
  requirePermission("manage_support_tickets"),
  upload.single("attachment"),
  replyToSupportTicket
);

export default router;
