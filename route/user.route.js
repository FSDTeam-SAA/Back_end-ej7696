import express from "express";
import {
  changePassword,
  deleteUser,
  getProfile,
  getUserDetails,
  getUsers,
  updateSubAdminPermissions,
  updateUserStatus,
  updateUserSubscription,
  adminSendPasswordResetEmail,
  adminSetTemporaryPassword,
  updateProfile,
} from "../controller/user.controller.js";

import { isAdmin, protect, requirePermission } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
const router = express.Router();

router.get("/", protect, requirePermission("view_user_list"), getUsers);
router.get("/profile", protect, getProfile);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);
router.get("/:id", protect, requirePermission("view_user_list"), getUserDetails);
router.patch("/:id/status", protect, requirePermission("suspend_users"), updateUserStatus);
router.patch("/:id/subscription", protect, requirePermission("manage_subscription"), updateUserSubscription);
router.patch("/:id/permissions", protect, isAdmin, updateSubAdminPermissions);
router.post("/:id/password-reset-email", protect, requirePermission("send_password_reset_email"), adminSendPasswordResetEmail);
router.patch("/:id/password", protect, requirePermission("credential_management"), adminSetTemporaryPassword);
router.delete("/:id", protect, isAdmin, deleteUser);

export default router;
