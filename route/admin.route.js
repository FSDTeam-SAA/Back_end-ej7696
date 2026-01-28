import express from "express";
import { getDashboardOverview } from "../controller/admin.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/dashboard", protect, requirePermission("access_performance_analytics"), getDashboardOverview);

export default router;
