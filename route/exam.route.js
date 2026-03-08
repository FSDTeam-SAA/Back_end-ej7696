import express from "express";
import {
  createExam,
  deleteExam,
  deleteExamReview,
  getActiveExams,
  getAllExamsAdmin,
  getAllExamReviewsAdmin,
  getPublishedExamReviews,
  getExamQuestionBankQuestionsAdmin,
  getExamQuestionBankAdminStatus,
  saveExamProgress,
  submitExamAnswers,
  submitExamReview,
  startExam,
  generateExamQuestionBank,
  updateExamReview,
  updateExam,
  updateExamStatus,
} from "../controller/exam.controller.js";
import { optionalProtect, protect, requirePermission } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/", optionalProtect, getActiveExams);
router.get("/all", protect, requirePermission("manage_exams_questions"), getAllExamsAdmin);
router.get("/reviews", protect, getPublishedExamReviews);
router.get(
  "/reviews/admin",
  protect,
  requirePermission("manage_exams_questions"),
  getAllExamReviewsAdmin
);
router.patch(
  "/reviews/:reviewId",
  protect,
  requirePermission("manage_exams_questions"),
  updateExamReview
);
router.delete(
  "/reviews/:reviewId",
  protect,
  requirePermission("manage_exams_questions"),
  deleteExamReview
);

// -----------generate Exam Question Bank------------------
router.get(
  "/:id/question-bank/status",
  protect,
  requirePermission("manage_exams_questions"),
  getExamQuestionBankAdminStatus
);
router.get(
  "/:id/question-bank/questions",
  protect,
  requirePermission("manage_exams_questions"),
  getExamQuestionBankQuestionsAdmin
);
router.post(
  "/:id/question-bank/generate",
  protect,
  requirePermission("manage_exams_questions"),
  generateExamQuestionBank
);
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
