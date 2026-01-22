import express from "express";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementsAdmin,
  getPublicAnnouncements,
  updateAnnouncementStatus,
} from "../controller/announcement.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", getPublicAnnouncements);
router.get("/all", protect, isAdmin, getAnnouncementsAdmin);
router.post("/", protect, isAdmin, createAnnouncement);
router.patch("/:id/status", protect, isAdmin, updateAnnouncementStatus);
router.delete("/:id", protect, isAdmin, deleteAnnouncement);

export default router;
