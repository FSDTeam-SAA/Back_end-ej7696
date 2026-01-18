import express from "express";

import authRoute from "../route/auth.route.js";
import userRoute from "../route/user.route.js";

const router = express.Router();

// Mounting the routes
router.use("/auth", authRoute);
router.use("/user", userRoute);

export default router;
