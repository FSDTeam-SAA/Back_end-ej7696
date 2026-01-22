import express from "express";
import {
  getAttemptDetails,
  getOverview,
  getPerformance,
  listAttempts,
} from "../controller/analytics.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/me/overview", protect, getOverview);
router.get("/me/performance", protect, getPerformance);
router.get("/history/attempts", protect, listAttempts);
router.get("/history/attempts/:attemptId", protect, getAttemptDetails);

export default router;
