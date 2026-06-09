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
  verifyAppleExamPurchase,
  verifyAppleProfessionalPlanPurchase,
  getRevenueSummary,
  getProfessionalPlan,
  getPricingSettings,
  listPurchases,
  listProfessionalPlanPurchases,
  manualLockExam,
  manualLockExamsBulk,
  manualUnlockExam,
  manualUnlockExamsBulk,
  updateProfessionalPlanPurchaseStatus,
  updatePricingSettings,
  getUserTransactions,
  processRefund,
  getTransactionRefunds,
} from "../controller/payment.controller.js";
import {
  optionalProtect,
  protect,
  requirePermission,
} from "../middleware/auth.middleware.js";

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
router.post("/apple/exam/:examId/verify", protect, verifyAppleExamPurchase);
router.post(
  "/apple/plan/professional/verify",
  protect,
  verifyAppleProfessionalPlanPurchase
);
router.get("/plan/professional", optionalProtect, getProfessionalPlan);
router.post("/admin/exams/unlock-bulk", protect, requirePermission("manual_exam_unlocks"), manualUnlockExamsBulk);
router.post("/admin/exams/lock-bulk", protect, requirePermission("manual_exam_unlocks"), manualLockExamsBulk);
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
router.get(
  "/admin/users/:userId/transactions",
  protect,
  requirePermission("view_billing_summary"),
  getUserTransactions
);
router.post(
  "/admin/transactions/:transactionId/refund",
  protect,
  requirePermission("manage_subscription"),
  processRefund
);
router.get(
  "/admin/transactions/:transactionId/refunds",
  protect,
  requirePermission("view_billing_summary"),
  getTransactionRefunds
);

export default router;
