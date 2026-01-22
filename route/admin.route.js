import express from "express";
import { getDashboardOverview } from "../controller/admin.controller.js";
import { isAdmin, protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/dashboard", protect, isAdmin, getDashboardOverview);

export default router;
