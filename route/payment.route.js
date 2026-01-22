import express from "express";
import {
  captureExamPayPalOrder,
  createExamPayPalOrder,
  getRevenueSummary,
  listPurchases,
} from "../controller/payment.controller.js";
import { protect, isAdmin } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/exam/:examId/paypal/create", protect, createExamPayPalOrder);
router.post("/exam/:examId/paypal/capture", protect, captureExamPayPalOrder);
router.get("/admin/summary", protect, isAdmin, getRevenueSummary);
router.get("/admin/purchases", protect, isAdmin, listPurchases);

export default router;
