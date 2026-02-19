import express from "express";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/config-model", async (req, res) => {
  const serviceUrl = process.env.CONFIG_SERVICE_URL;
  if (!serviceUrl) {
    return res.status(500).json({
      success: false,
      message: "CONFIG_SERVICE_URL is not configured",
    });
  }

  try {
    const upstream = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }

    return res.status(upstream.status).send(payload);
  } catch (error) {
    console.error("[config.route] QUESTION_SERVICE_URL error:", error);
    return res.status(502).json({
      success: false,
      message: "Failed to call question service",
    });
  }
});

export default router;
