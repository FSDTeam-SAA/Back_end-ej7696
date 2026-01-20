import express from "express";
import {
  createExam,
  deleteExam,
  getActiveExams,
  getAllExamsAdmin,
  updateExam,
} from "../controller/exam.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/", getActiveExams);
router.get("/all", protect, isAdmin, getAllExamsAdmin);
router.post("/", protect, isAdmin, upload.single("image"), createExam);
router.put("/:id", protect, isAdmin, upload.single("image"), updateExam);
router.delete("/:id", protect, isAdmin, deleteExam);

export default router;
