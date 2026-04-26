import express from "express";
import {
  changePassword,
  deleteUser,
  bulkDeleteUsers,
  getProfile,
  getUserDetails,
  getUsers,
  getRefundedUsers,
  updateSubAdminPermissions,
  updateUserStatus,
  updateUserSubscription,
  adminSendPasswordResetEmail,
  adminSetTemporaryPassword,
  clearUserInstallationSession,
  getUserExamReviews,
  getMyInstallationSession,
  getMyUnlocks,
  updateProfile,
  getUserInstallationSession,
} from "../controller/user.controller.js";

import { isAdmin, protect, requirePermission } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
const router = express.Router();

router.get("/", protect, requirePermission("view_user_list"), getUsers);
router.get("/refunded", protect, requirePermission("view_user_list"), getRefundedUsers);
router.delete("/bulk", protect, isAdmin, bulkDeleteUsers);
router.get("/profile", protect, getProfile);
router.get("/profile/installation-session", protect, getMyInstallationSession);
router.get("/profile/unlocks", protect, getMyUnlocks);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);
router.get(
  "/:id/installation-session",
  protect,
  requirePermission("view_user_list"),
  getUserInstallationSession
);
router.get("/:id", protect, requirePermission("view_user_list"), getUserDetails);
router.delete(
  "/:id/installation-session",
  protect,
  isAdmin,
  clearUserInstallationSession
);
router.patch("/:id/status", protect, requirePermission("suspend_users"), updateUserStatus);
router.patch("/:id/subscription", protect, requirePermission("manage_subscription"), updateUserSubscription);
router.patch("/:id/permissions", protect, isAdmin, updateSubAdminPermissions);
router.post("/:id/password-reset-email", protect, requirePermission("send_password_reset_email"), adminSendPasswordResetEmail);
router.patch("/:id/password", protect, requirePermission("credential_management"), adminSetTemporaryPassword);
router.get("/:id/exam-reviews", protect, requirePermission("view_user_list"), getUserExamReviews);
router.delete("/:id", protect, isAdmin, deleteUser);

export default router;
