import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";
import testimonialRoute from "../route/testimonial.route.js";
import examRoute from "../route/exam.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);
router.use("/testimonial", testimonialRoute);
router.use("/exam", examRoute);

export default router;
