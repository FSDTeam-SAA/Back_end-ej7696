import express from "express";
import {
  changePassword,
  deleteUser,
  getProfile,
  getUserDetails,
  getUsers,
  updateUserStatus,
  updateProfile,
} from "../controller/user.controller.js";

import { isAdmin, protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";
const router = express.Router();

router.get("/", protect, isAdmin, getUsers);
router.get("/profile", protect, getProfile);
router.put("/profile", protect, upload.single("avatar"), updateProfile);
router.put("/password", protect, changePassword);
router.get("/:id", protect, isAdmin, getUserDetails);
router.patch("/:id/status", protect, isAdmin, updateUserStatus);
router.delete("/:id", protect, isAdmin, deleteUser);

export default router;
