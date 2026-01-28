import express from "express";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementsAdmin,
  getPublicAnnouncements,
  updateAnnouncementStatus,
} from "../controller/announcement.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", getPublicAnnouncements);
router.get("/all", protect, requirePermission("manage_announcements"), getAnnouncementsAdmin);
router.post("/", protect, requirePermission("manage_announcements"), createAnnouncement);
router.patch("/:id/status", protect, requirePermission("manage_announcements"), updateAnnouncementStatus);
router.delete("/:id", protect, requirePermission("manage_announcements"), deleteAnnouncement);

export default router;
