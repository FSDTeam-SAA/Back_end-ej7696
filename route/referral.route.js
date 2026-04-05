import express from "express";
import {
  convertReferralBalanceToCredit,
  deleteReferralRelationshipAdmin,
  getMyReferralLedger,
  getMyReferralProfile,
  getMyReferralProgram,
  getMyReferredUsers,
  getPublicReferralCode,
  getReferralOverviewAdmin,
  getReferralTemplateAdmin,
  listReferralUsageAdmin,
  listReferralPayoutRequestsAdmin,
  requestReferralCashPayout,
  updateReferralTemplateAdmin,
  updateReferralPayoutRequestStatusAdmin,
} from "../controller/referral.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/public/:code", getPublicReferralCode);
router.get("/r/:code", getPublicReferralCode);

router.get("/me", protect, getMyReferralProfile);
router.get("/program", protect, getMyReferralProgram);
router.get("/referred-users", protect, getMyReferredUsers);
router.get("/ledger", protect, getMyReferralLedger);
router.post("/convert-to-credit", protect, convertReferralBalanceToCredit);
router.post("/cash-payout-request", protect, requestReferralCashPayout);

router.get(
  "/admin/overview",
  protect,
  requirePermission("view_referral_analytics"),
  getReferralOverviewAdmin
);
router.get(
  "/admin/template",
  protect,
  requirePermission("manage_referral_payouts"),
  getReferralTemplateAdmin
);
router.patch(
  "/admin/template",
  protect,
  requirePermission("manage_referral_payouts"),
  updateReferralTemplateAdmin
);
router.get(
  "/admin/relationships",
  protect,
  requirePermission("view_referral_analytics"),
  listReferralUsageAdmin
);
router.delete(
  "/admin/relationships/:relationshipId",
  protect,
  requirePermission("manage_referral_payouts"),
  deleteReferralRelationshipAdmin
);
router.get(
  "/admin/payout-requests",
  protect,
  requirePermission("manage_referral_payouts"),
  listReferralPayoutRequestsAdmin
);
router.patch(
  "/admin/payout-requests/:requestId",
  protect,
  requirePermission("manage_referral_payouts"),
  updateReferralPayoutRequestStatusAdmin
);

export default router;
