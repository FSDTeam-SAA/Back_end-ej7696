import express from "express";
import {
  createExam,
  deleteExam,
  getActiveExams,
  getAllExamsAdmin,
  saveExamProgress,
  submitExamAnswers,
  submitExamReview,
  startExam,
  updateExam,
  updateExamStatus,
} from "../controller/exam.controller.js";
import { optionalProtect, protect, requirePermission } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/", optionalProtect, getActiveExams);
router.get("/all", protect, requirePermission("manage_exams_questions"), getAllExamsAdmin);
router.post("/:id/start", protect, startExam);
router.get("/:id/start", protect, startExam);
router.post("/:id/progress", protect, saveExamProgress);
router.post("/:id/submit", protect, submitExamAnswers); 
router.post("/:id/review", protect, submitExamReview);
router.post("/", protect, requirePermission("manage_exams_questions"), upload.single("image"), createExam);
router.put("/:id", protect, requirePermission("manage_exams_questions"), upload.single("image"), updateExam);
router.patch("/:id/status", protect, requirePermission("manage_exams_questions"), updateExamStatus);
router.delete("/:id", protect, requirePermission("manage_exams_questions"), deleteExam);

export default router;
