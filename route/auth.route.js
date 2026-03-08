import express from "express";
import {
  clearDeviceSession,
  changePassword,
  forgetPassword,
  login,
  logout,
  refreshToken,
  register,
  resetPassword,
  updateUserRole,
  verifyEmail,
} from "../controller/auth.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify", verifyEmail);
router.post("/forget", forgetPassword);
router.post("/reset-password", resetPassword);
router.post("/device-session/clear", clearDeviceSession);
router.post("/change-password", protect, changePassword);
router.post("/refresh-token", refreshToken);
router.post("/logout", protect, logout);
router.patch("/users/:id/role", protect, isAdmin, updateUserRole);

export default router;
