import express from "express";
import {
  convertReferralBalanceToCredit,
  getMyReferralLedger,
  getMyReferralProfile,
  getMyReferredUsers,
  getPublicReferralCode,
  getReferralOverviewAdmin,
  listReferralPayoutRequestsAdmin,
  requestReferralCashPayout,
  updateReferralPayoutRequestStatusAdmin,
} from "../controller/referral.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/public/:code", getPublicReferralCode);
router.get("/r/:code", getPublicReferralCode);

router.get("/me", protect, getMyReferralProfile);
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
