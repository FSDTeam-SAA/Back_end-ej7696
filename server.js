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
import { ResourceProduct } from "./model/resourceProduct.model.js";
import { User } from "./model/user.model.js";
import { REFERRAL_DISCOUNT_RATE } from "./utils/referral.service.js";

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

const normalizeOrigin = (origin) =>
  origin?.toString().trim().replace(/\/+$/, "");

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://10.10.5.49:3000",
  "http://10.10.5.49",
];

const allowedOrigins = new Set(
  [
    ...defaultAllowedOrigins,
    process.env.CLIENT_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
  ]
    .map(normalizeOrigin)
    .filter(Boolean)
);

const isTrustedDevOrigin = (origin) => {
  if ((process.env.NODE_ENV || "development") === "production") return false;

  try {
    const parsedOrigin = new URL(origin);
    const isLocalHost = ["localhost", "127.0.0.1"].includes(
      parsedOrigin.hostname
    );
    const isIPv4Host = /^(\d{1,3}\.){3}\d{1,3}$/.test(parsedOrigin.hostname);

    return (
      parsedOrigin.protocol === "http:" &&
      parsedOrigin.port === "3000" &&
      (isLocalHost || isIPv4Host)
    );
  } catch {
    return false;
  }
};

const corsOptions = {
  origin: (origin, callback) => {
    const cleanedOrigin = normalizeOrigin(origin);

    if (!cleanedOrigin) {
      return callback(null, true);
    }

    if (
      allowedOrigins.has(cleanedOrigin) ||
      isTrustedDevOrigin(cleanedOrigin)
    ) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-app-installation-id",
    "x-installation-id",
  ],
};

app.use(cors(corsOptions));
app.options("/{*any}", cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/public", express.static("public"));

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeReferralCode = (value) =>
  value?.toString().trim().toUpperCase() || "";

const escapeHtml = (value) =>
  value
    ?.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;") || "";

const renderSharedEbookLandingPage = ({
  appUrl,
  downloadUrl,
  product,
  referralCode,
  referrerName,
}) => {
  const safeProductTitle = escapeHtml(product?.title || "Ebook Store");
  const safeDescription = escapeHtml(
    product?.shortDescription ||
      "Unlock practical study guides and certification resources in the app."
  );
  const safeCover = escapeHtml(product?.coverImageUrl || "");
  const safeReferrerName = escapeHtml(referrerName || "A colleague");
  const safeReferralCode = escapeHtml(referralCode || "");
  const safeCurrency = escapeHtml(product?.currency || "USD");
  const listedPrice = roundCurrency(product?.price || 0);
  const discountedPrice = roundCurrency(
    Math.max(listedPrice - listedPrice * REFERRAL_DISCOUNT_RATE, 0)
  );
  const originalPrice = roundCurrency(
    product?.originalPrice ?? product?.price ?? listedPrice
  );
  const safeAppUrl = escapeHtml(appUrl);
  const safeDownloadUrl = escapeHtml(downloadUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeProductTitle}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef5ff;
      --card: #ffffff;
      --text: #10213f;
      --muted: #5f718a;
      --accent: #173b2e;
      --accent-2: #245b47;
      --gold: #f59e0b;
      --line: #d7e3f3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(76,154,125,.18), transparent 28%),
        linear-gradient(180deg, #f7fbff 0%, var(--bg) 100%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .shell {
      width: 100%;
      max-width: 460px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: 0 18px 55px rgba(16,33,63,.12);
      overflow: hidden;
    }
    .hero {
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 65%, #4c9a7d 100%);
      color: #fff;
      padding: 22px;
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 26px;
      line-height: 1.05;
    }
    .hero p {
      margin: 0;
      color: rgba(255,255,255,.84);
      line-height: 1.5;
      font-size: 14px;
    }
    .body {
      padding: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #fff7e8;
      color: #8a5407;
      border: 1px solid #f6d87a;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      margin-bottom: 16px;
    }
    .product {
      display: grid;
      grid-template-columns: 104px 1fr;
      gap: 14px;
      align-items: start;
    }
    .cover {
      width: 104px;
      height: 132px;
      border-radius: 18px;
      background: #dbe7f5;
      border: 1px solid var(--line);
      overflow: hidden;
    }
    .cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .pricing {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin: 12px 0 0;
    }
    .price-now {
      font-size: 24px;
      font-weight: 800;
      color: var(--text);
    }
    .price-old {
      color: #8fa0b7;
      text-decoration: line-through;
      font-weight: 700;
    }
    .discount {
      display: inline-flex;
      align-items: center;
      padding: 7px 10px;
      border-radius: 999px;
      background: #e7f8ef;
      color: #166534;
      font-size: 12px;
      font-weight: 800;
    }
    .cta-grid {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }
    .btn {
      appearance: none;
      border: none;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 48px;
      border-radius: 16px;
      font-weight: 800;
      font-size: 14px;
      padding: 0 16px;
      cursor: pointer;
    }
    .btn-primary {
      background: #10213f;
      color: #fff;
    }
    .btn-secondary {
      background: #f1f5ff;
      color: #2d4f88;
      border: 1px solid #d7e3f3;
    }
    .helper {
      margin-top: 16px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <h1>${safeProductTitle}</h1>
      <p>${safeDescription}</p>
    </section>
    <section class="body">
      <div class="badge">
        Referral from ${safeReferrerName}${safeReferralCode ? ` • Code ${safeReferralCode}` : ""}
      </div>
      <div class="product">
        <div class="cover">
          ${
            safeCover
              ? `<img src="${safeCover}" alt="${safeProductTitle}" />`
              : ""
          }
        </div>
        <div>
          <div style="font-size:13px;color:#64748b;font-weight:700;">Buy in app and save 10%</div>
          <div class="pricing">
            <span class="price-now">${safeCurrency} ${discountedPrice.toFixed(2)}</span>
            ${
              originalPrice > discountedPrice
                ? `<span class="price-old">${safeCurrency} ${originalPrice.toFixed(2)}</span>`
                : ""
            }
            <span class="discount">10% referral ready</span>
          </div>
          <div class="helper">
            The ebook opens in the EJ app. The referral code will be pre-filled for this product after sign up or login.
          </div>
        </div>
      </div>
      <div class="cta-grid">
        <a class="btn btn-primary" href="${safeAppUrl}" onclick="return openAppOrDownload();">Open in App</a>
        ${
          safeDownloadUrl
            ? `<a class="btn btn-secondary" href="${safeDownloadUrl}" target="_blank" rel="noreferrer">Download Test Build</a>`
            : ""
        }
      </div>
      <div class="helper">
        If the app is already installed, tap <strong>Open in App</strong>. If the app is not installed yet, the same button will fall back to the test build download. After installation, return to this shared page and tap <strong>Open in App</strong> so the referral code and ebook context are passed into the app.
      </div>
    </section>
  </main>
  <script>
    function openAppOrDownload() {
      const appUrl = ${JSON.stringify(appUrl)};
      const downloadUrl = ${JSON.stringify(downloadUrl)};
      if (!appUrl) {
        if (downloadUrl) {
          window.location.href = downloadUrl;
        }
        return false;
      }

      const startedAt = Date.now();
      window.location.href = appUrl;

      if (downloadUrl) {
        setTimeout(function() {
          const elapsed = Date.now() - startedAt;
          if (document.visibilityState === "visible" && elapsed < 2200) {
            window.open(downloadUrl, "_blank", "noopener,noreferrer");
          }
        }, 1200);
      }

      return false;
    }

    (function() {
      const appUrl = ${JSON.stringify(appUrl)};
      if (!appUrl) return;
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      if (!isMobile) return;
      setTimeout(function() {
        openAppOrDownload();
      }, 250);
    })();
  </script>
</body>
</html>`;
};

app.get("/shared-ebook", async (req, res) => {
  try {
    const referralCode = normalizeReferralCode(req.query.ref);
    const productId = req.query.productId?.toString().trim() || "";

    if (!referralCode || !productId) {
      return res.status(400).send("Referral code and productId are required.");
    }

    const [product, referrer] = await Promise.all([
      ResourceProduct.findOne({ _id: productId, isActive: true }).lean(),
      User.findOne({ referralCode, status: "active" })
        .select("name firstName lastName")
        .lean(),
    ]);

    if (!product) {
      return res.status(404).send("Shared ebook not found.");
    }

    const appUrl = `ejflutter:///shared-ebook?ref=${encodeURIComponent(
      referralCode
    )}&productId=${encodeURIComponent(productId)}`;
    const downloadUrl =
      process.env.REFERRAL_TEST_BUILD_URL ||
      process.env.REFERRAL_PLAY_STORE_URL ||
      process.env.PLAY_STORE_URL ||
      process.env.REFERRAL_APP_STORE_URL ||
      process.env.APP_STORE_URL ||
      "https://drive.google.com/file/d/1ADiA7NzrFEgR2Pp8f6rWct7JWjf1FNo9/view?usp=sharing";
    const referrerName =
      referrer?.name ||
      [referrer?.firstName, referrer?.lastName].filter(Boolean).join(" ") ||
      "an EJ user";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(
      renderSharedEbookLandingPage({
        appUrl,
        downloadUrl,
        product,
        referralCode,
        referrerName,
      })
    );
  } catch (error) {
    return res.status(500).send("Unable to open shared ebook right now.");
  }
});

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
