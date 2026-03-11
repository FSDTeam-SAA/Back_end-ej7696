import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import router from "./mainroute/index.js";
import { createServer } from "http";
import { Server } from "socket.io";

import globalErrorHandler from "./middleware/globalErrorHandler.js";
import notFound from "./middleware/notFound.js";

const app = express();

app.set("trust proxy", true);

const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
app.set("io", io);

const allowedOrigins = [
  "http://localhost:3000",
  "http://10.10.5.49:3000",
  "http://10.10.5.49",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-app-installation-id",
      "x-installation-id",
    ],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/public", express.static("public"));

app.get("/r/:code", (req, res) => {
  const referralCode = req.params.code?.toString().trim().toUpperCase();
  if (!referralCode) {
    return res.status(400).json({
      success: false,
      message: "Referral code is required",
    });
  }

  const clientUrl = process.env.CLIENT_URL?.toString().trim();
  if (clientUrl) {
    const referralPath =
      process.env.REFERRAL_REDIRECT_PATH?.toString().trim() || "/register";
    const redirectUrl = `${clientUrl.replace(/\/+$/, "")}${referralPath}?ref=${encodeURIComponent(
      referralCode
    )}`;
    return res.redirect(302, redirectUrl);
  }

  return res.status(200).json({
    success: true,
    message: "Referral code captured",
    data: {
      referralCode,
    },
  });
});

// Mount the main router
app.use("/api/v1", router);

// Basic route for testing
app.get("/", (req, res) => {
  res.send("Server is running...!!");
});

app.use(globalErrorHandler);
app.use(notFound);

io.on("connection", (socket) => {
  console.log("A client connected:", socket.id);

  socket.on("joinChatRoom", (userId) => {
    if (userId) {
      socket.join(`chat_${userId}`);
      console.log(`Client ${socket.id} joined user room: ${userId}`);
    }
  });

  socket.on("joinAlerts", () => {
    socket.join("alerts");
    console.log(`Client ${socket.id} joined alerts room`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
});
