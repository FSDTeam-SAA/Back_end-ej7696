import express from "express";
import {
  createTestimonial,
  deleteTestimonial,
  getTestimonials,
  updateTestimonial,
} from "../controller/testimonial.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/", getTestimonials);
router.post("/", protect, upload.single("image"), createTestimonial);
router.put("/:id", protect, upload.single("image"), updateTestimonial);
router.delete("/:id", protect, deleteTestimonial);

export default router;
