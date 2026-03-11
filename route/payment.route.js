import express from "express";
import {
  confirmExamStripePayment,
  confirmProfessionalPlanStripePayment,
  captureExamPayPalOrder,
  createExamStripePaymentIntent,
  createExamPayPalOrder,
  createProfessionalPlanOrder,
  createProfessionalPlanStripePaymentIntent,
  captureProfessionalPlanOrder,
  getRevenueSummary,
  getProfessionalPlan,
  getPricingSettings,
  listPurchases,
  listProfessionalPlanPurchases,
  manualLockExam,
  manualUnlockExam,
  updateProfessionalPlanPurchaseStatus,
  updatePricingSettings,
} from "../controller/payment.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/exam/:examId/paypal/create", protect, createExamPayPalOrder);
router.post("/exam/:examId/paypal/capture", protect, captureExamPayPalOrder);

router.post("/exam/:examId/stripe/create", protect, createExamStripePaymentIntent);
router.post("/exam/:examId/stripe/confirm", protect, confirmExamStripePayment);

router.post("/plan/professional/paypal/create", protect, createProfessionalPlanOrder);
router.post("/plan/professional/paypal/capture", protect, captureProfessionalPlanOrder);
router.post(
  "/plan/professional/stripe/create",
  protect,
  createProfessionalPlanStripePaymentIntent
);
router.post(
  "/plan/professional/stripe/confirm",
  protect,
  confirmProfessionalPlanStripePayment
);
router.get("/plan/professional", getProfessionalPlan);
router.post("/admin/exam/:examId/unlock", protect, requirePermission("manual_exam_unlocks"), manualUnlockExam);
router.post("/admin/exam/:examId/lock", protect, requirePermission("manual_exam_unlocks"), manualLockExam);
router.get("/admin/pricing", protect, requirePermission("manage_subscription"), getPricingSettings);
router.patch("/admin/pricing", protect, requirePermission("manage_subscription"), updatePricingSettings);
router.get("/admin/summary", protect, requirePermission("view_billing_summary"), getRevenueSummary);
router.get("/admin/purchases", protect, requirePermission("view_billing_summary"), listPurchases);
router.get(
  "/admin/plan-purchases",
  protect,
  requirePermission("view_billing_summary"),
  listProfessionalPlanPurchases
);
router.patch(
  "/admin/plan-purchases/:purchaseId/status",
  protect,
  requirePermission("manage_subscription"),
  updateProfessionalPlanPurchaseStatus
);

export default router;
