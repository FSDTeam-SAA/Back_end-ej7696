import express from "express";
import {
  changePassword,
  forgetPassword,
  login,
  logout,
  refreshToken,
  register,
  resetPassword,
  verifyEmail,
} from "../controller/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify", verifyEmail);
router.post("/forget", forgetPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", protect, changePassword);
router.post("/refresh-token", refreshToken);
router.post("/logout", protect, logout);

export default router;
