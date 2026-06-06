import express from "express";
import {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
} from "../controller/plan.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/", listPlans);
router.post(
  "/",
  protect,
  requirePermission("manage_subscription"),
  createPlan
);
router.patch(
  "/:id",
  protect,
  requirePermission("manage_subscription"),
  updatePlan
);
router.delete(
  "/:id",
  protect,
  requirePermission("manage_subscription"),
  deletePlan
);

export default router;
