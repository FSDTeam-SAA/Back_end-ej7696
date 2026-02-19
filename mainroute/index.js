import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import testimonialRoute from "../route/testimonial.route.js";
import examRoute from "../route/exam.route.js";
import announcementRoute from "../route/announcement.route.js";
import analyticsRoute from "../route/analytics.route.js";
import paymentRoute from "../route/payment.route.js";
import adminRoute from "../route/admin.route.js";
import supportRoute from "../route/support.route.js";
import configRoute from "../route/config.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/testimonial", testimonialRoute);
router.use("/exam", examRoute);
router.use("/announcement", announcementRoute);
router.use("/analytics", analyticsRoute);
router.use("/payments", paymentRoute);
router.use("/admin", adminRoute);
router.use("/support", supportRoute);

router.use("/", configRoute);

export default router;
