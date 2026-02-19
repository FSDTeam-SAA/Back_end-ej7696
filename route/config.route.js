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

  if (!Object.keys(req.body || {}).length) {
    return res.status(400).json({
      success: false,
      message: "Request body is required",
    });
  }

  if (!req.body?.model_name) {
    return res.status(400).json({
      success: false,
      message: "model_name is required",
    });
  }

  const formParams = new URLSearchParams();
  Object.entries(req.body || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    formParams.append(key, String(value));
  });

  console.log("[config.route] Forwarding to CONFIG_SERVICE_URL", {
    url: serviceUrl,
    body: req.body,
    contentType: "application/x-www-form-urlencoded",
  });

  try {
    const upstream = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formParams,
    });

    const payload = await upstream.json();
    return res.status(upstream.status).json(payload);
  } catch (error) {
    console.error("[config.route] CONFIG_SERVICE_URL error:", error);
    return res.status(502).json({
      success: false,
      message: "Failed to call question service",
    });
  }
});

export default router;
