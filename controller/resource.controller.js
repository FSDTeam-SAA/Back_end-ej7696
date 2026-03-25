import httpStatus from "http-status";
import mongoose from "mongoose";
import Stripe from "stripe";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import { User } from "../model/user.model.js";
import { ResourceCategory } from "../model/resourceCategory.model.js";
import { ResourceProduct } from "../model/resourceProduct.model.js";
import { ResourcePurchase } from "../model/resourcePurchase.model.js";
import {
  applyResourceUnlocksToUser,
  getResourceProductOrThrow,
  getUnlockedResourceCodeSet,
  getUpgradeAddOnOptions,
  isResourceUnlockedForUser,
  normalizeProductCode,
  resolveResourceRevenueTag,
  roundCurrency,
} from "../utils/resource.service.js";
import { uploadOnCloudinary } from "../utils/commonMethod.js";

const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = value.toString().trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
};

const normalizeBundleIncludeItem = (value) => {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return normalizeProductCode(value);
  }
  if (typeof value === "object") {
    return normalizeProductCode(
      value.code ?? value.productCode ?? value.id ?? value._id ?? ""
    );
  }
  return "";
};

const parseBundleIncludes = (value) => {
  if (value === undefined || value === null || value === "") return [];

  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeBundleIncludeItem(item)).filter(Boolean))];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return [
          ...new Set(parsed.map((item) => normalizeBundleIncludeItem(item)).filter(Boolean)),
        ];
      }
    } catch (_err) {
      // Fallback to comma-separated values
    }

    return [...new Set(trimmed.split(",").map((item) => normalizeProductCode(item)).filter(Boolean))];
  }

  return [];
};

const buildProductCodeSeed = (value) =>
  value
    ?.toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const resolveUniqueProductCode = async ({ rawCode, title, excludeProductId = null }) => {
  const explicitCode = normalizeProductCode(rawCode);
  const titleSeed = buildProductCodeSeed(title);
  const baseCode =
    explicitCode ||
    titleSeed ||
    `ebook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  let candidate = baseCode;
  let suffix = 2;

  while (true) {
    const existing = await ResourceProduct.findOne({ code: candidate })
      .select("_id")
      .lean();
    if (
      !existing ||
      (excludeProductId && existing._id.toString() === excludeProductId.toString())
    ) {
      return candidate;
    }
    candidate = `${baseCode}_${suffix}`;
    suffix += 1;
  }
};

const resolveBundleIncludesForProduct = async ({
  bundleIncludes = [],
  isBundle = false,
  currentProductId = null,
}) => {
  const normalizedTokens = [...new Set(parseBundleIncludes(bundleIncludes))];

  if (!isBundle) {
    return [];
  }

  if (normalizedTokens.length < 2) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Bundle must include at least two ebooks"
    );
  }

  const objectIdTokens = normalizedTokens.filter((item) =>
    mongoose.Types.ObjectId.isValid(item)
  );

  const products = await ResourceProduct.find({
    $or: [
      { code: { $in: normalizedTokens } },
      ...(objectIdTokens.length ? [{ _id: { $in: objectIdTokens } }] : []),
    ],
  })
    .select("_id code title isBundle isActive")
    .lean();

  const productByCode = new Map(
    products.map((item) => [normalizeProductCode(item.code), item])
  );
  const productById = new Map(products.map((item) => [item._id.toString(), item]));

  const unresolvedTokens = [];
  const resolvedCodes = new Set();
  const currentId = currentProductId?.toString() || "";

  normalizedTokens.forEach((token) => {
    const byCode = productByCode.get(token);
    const byId = mongoose.Types.ObjectId.isValid(token) ? productById.get(token) : null;
    const matched = byCode || byId;

    if (!matched) {
      unresolvedTokens.push(token);
      return;
    }

    if (currentId && matched._id.toString() === currentId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "A bundle cannot include itself"
      );
    }

    if (matched.isBundle) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Nested bundles are not allowed"
      );
    }

    if (!matched.isActive) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Included ebook is inactive: ${matched.title || matched.code}`
      );
    }

    resolvedCodes.add(normalizeProductCode(matched.code));
  });

  if (unresolvedTokens.length > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid bundle includes: ${unresolvedTokens.join(", ")}`
    );
  }

  if (resolvedCodes.size < 2) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Bundle must include at least two valid ebooks"
    );
  }

  return [...resolvedCodes];
};

const getUploadedFile = (req, fieldName) => {
  const files = req.files;
  if (!files || Array.isArray(files)) return null;
  const list = files[fieldName];
  if (!Array.isArray(list) || !list.length) return null;
  return list[0];
};

const uploadResourceProductAssets = async (req) => {
  const result = {
    coverImageUrl: "",
    contentUrl: "",
  };

  const coverImageFile = getUploadedFile(req, "coverImage");
  if (coverImageFile?.buffer) {
    const upload = await uploadOnCloudinary(coverImageFile.buffer, {
      folder: "ej7696/resources/cover-images",
      resource_type: "image",
    });
    result.coverImageUrl = upload?.secure_url || "";
  }

  const contentFile = getUploadedFile(req, "contentFile");
  if (contentFile?.buffer) {
    const upload = await uploadOnCloudinary(contentFile.buffer, {
      folder: "ej7696/resources/content-files",
      resource_type: "raw",
    });
    result.contentUrl = upload?.secure_url || "";
  }

  return result;
};

const toStripeAmount = (amount, currency) => {
  const normalized = currency?.toString().trim().toUpperCase() || "USD";
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
};

const getStripeClient = () => {
  if (!STRIPE_SECRET_KEY) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Stripe credentials not configured"
    );
  }
  return new Stripe(STRIPE_SECRET_KEY);
};

const getPayPalAccessToken = async () => {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "PayPal credentials not configured"
    );
  }

  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to authenticate with PayPal");
  }

  return data.access_token;
};

const buildPaymentAccountFingerprintFromStripeIntent = (paymentIntent) => {
  const token = paymentIntent?.payment_method || paymentIntent?.customer || paymentIntent?.id;
  return token ? `stripe:${token}` : "";
};

const buildPaymentAccountFingerprintFromPayPalCapture = (captureData) => {
  const payerId = captureData?.payer?.payer_id;
  const payerEmail = captureData?.payer?.email_address;
  const fallback =
    captureData?.payment_source?.paypal?.account_id ||
    captureData?.payment_source?.paypal?.email_address;
  const token = payerId || payerEmail || fallback || "";
  return token ? `paypal:${token}` : "";
};

const getPurchaseType = (product) => (product?.isBundle ? "bundle" : "single");

const RESOURCE_PURCHASE_USER_SELECT =
  "email has_api510_inspection_guide has_api510_report_guide has_api510_bundle resourceUnlocks";

const getPriceForProduct = (product) => {
  const listedPrice = roundCurrency(product?.price || 0);
  const basePrice = roundCurrency(product?.originalPrice ?? product?.price ?? 0);
  const finalPrice = listedPrice;
  const catalogDiscountAmount = roundCurrency(Math.max(basePrice - listedPrice, 0));
  const discountAmount = catalogDiscountAmount;

  return {
    basePrice,
    listedPrice,
    finalPrice,
    catalogDiscountAmount,
    referralDiscountRate: 0,
    referralDiscountAmount: 0,
    discountAmount,
  };
};

const getResourceCheckoutUserOrThrow = async (userId) => {
  const user = await User.findById(userId).select(RESOURCE_PURCHASE_USER_SELECT);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  return user;
};

const createPendingResourcePurchase = async ({
  userId,
  product,
  provider,
  pricing,
}) =>
  ResourcePurchase.create({
    userId,
    categoryId: product.categoryId,
    productId: product._id,
    productCode: product.code,
    purchaseType: getPurchaseType(product),
    provider,
    status: "pending",
    revenueTag: resolveResourceRevenueTag(getPurchaseType(product), product.code),
    currency: product.currency || "USD",
    basePrice: pricing.basePrice,
    finalPrice: pricing.finalPrice,
    referralDiscountRate: pricing.referralDiscountRate,
    referralDiscountAmount: pricing.referralDiscountAmount,
    discountAmount: pricing.discountAmount,
    referralCodeApplied: "",
    referralRelationshipId: null,
    metadata: {
      flow: "resource_store",
      listedPrice: pricing.listedPrice,
      catalogDiscountAmount: pricing.catalogDiscountAmount,
      referralApplied: false,
      referralProductId: "",
    },
  });

const buildProductCard = ({ product, unlockedCodes, productByCode }) => {
  const code = normalizeProductCode(product?.code);
  const isUnlocked = unlockedCodes.has(code);
  const bundleIncludes = parseBundleIncludes(product?.bundleIncludes);
  const bundleItems = bundleIncludes
    .map((itemCode) => productByCode.get(itemCode))
    .filter(Boolean)
    .map((item) => {
      const itemCode = normalizeProductCode(item.code);
      const itemUnlocked = unlockedCodes.has(itemCode);

      return {
        id: item._id,
        categoryId: item.categoryId,
        code: itemCode,
        title: item.title,
        shortDescription: item.shortDescription || "",
        fullDescription: item.fullDescription || "",
        coverImageUrl: item.coverImageUrl || "",
        contentUrl: itemUnlocked ? item.contentUrl || "" : "",
        previewAvailable: Boolean(item.previewAvailable),
        previewTitle: item.previewTitle || "",
        previewContent: item.previewAvailable ? item.previewContent || "" : "",
        previewUrl: item.previewAvailable ? item.previewUrl || "" : "",
        pricing: {
          current: item.price,
          original: item.originalPrice ?? item.price,
          upgradeDiscount: item.upgradeDiscountPrice ?? item.price,
          currency: item.currency || "USD",
        },
        isBundle: Boolean(item.isBundle),
        bundleIncludes: parseBundleIncludes(item.bundleIncludes),
        locked: !itemUnlocked,
        unlocked: itemUnlocked,
        purchaseState: itemUnlocked ? "purchased" : "locked",
        sortOrder: item.sortOrder || 0,
        isActive: Boolean(item.isActive),
      };
    });

  return {
    id: product._id,
    categoryId: product.categoryId,
    code,
    title: product.title,
    shortDescription: product.shortDescription,
    fullDescription: product.fullDescription,
    coverImageUrl: product.coverImageUrl,
    contentUrl: isUnlocked ? product.contentUrl : "",
    previewAvailable: Boolean(product.previewAvailable),
    previewTitle: product.previewTitle,
    previewContent: product.previewAvailable ? product.previewContent : "",
    previewUrl: product.previewAvailable ? product.previewUrl : "",
    pricing: {
      current: product.price,
      original: product.originalPrice ?? product.price,
      upgradeDiscount: product.upgradeDiscountPrice ?? product.price,
      currency: product.currency || "USD",
    },
    isBundle: Boolean(product.isBundle),
    bundleIncludes,
    bundleItems,
    locked: !isUnlocked,
    unlocked: isUnlocked,
    purchaseState: isUnlocked ? "purchased" : "locked",
    sortOrder: product.sortOrder || 0,
  };
};

const getUserResourceAccess = (user) => ({
  has_api510_inspection_guide: Boolean(user?.has_api510_inspection_guide),
  has_api510_report_guide: Boolean(user?.has_api510_report_guide),
  has_api510_bundle: Boolean(user?.has_api510_bundle),
  resourceUnlocks: user?.resourceUnlocks || [],
});

const fetchResourceStorePayload = async (userId, categoryId = "") => {
  const normalizedCategoryId = categoryId?.toString().trim() || "";
  const categoryFilter = { isActive: true };
  const productFilter = { isActive: true };

  if (normalizedCategoryId) {
    categoryFilter._id = normalizedCategoryId;
    productFilter.categoryId = normalizedCategoryId;
  }

  const [categories, products, user] = await Promise.all([
    ResourceCategory.find(categoryFilter).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    ResourceProduct.find(productFilter).sort({ sortOrder: 1, createdAt: 1 }).lean(),
    User.findById(userId)
      .select(
        "has_api510_inspection_guide has_api510_report_guide has_api510_bundle resourceUnlocks"
      )
      .lean(),
  ]);

  const unlockedCodes = getUnlockedResourceCodeSet(user || {});
  const productByCode = new Map(
    products.map((item) => [normalizeProductCode(item?.code), item])
  );

  const productsByCategory = products.reduce((acc, product) => {
    const key = product.categoryId.toString();
    if (!acc[key]) acc[key] = [];
    acc[key].push(buildProductCard({ product, unlockedCodes, productByCode }));
    return acc;
  }, {});

  const items = categories.map((category) => ({
    id: category._id,
    title: category.title,
    slug: category.slug,
    shortCode: category.shortCode,
    description: category.description,
    sortOrder: category.sortOrder || 0,
    products: productsByCategory[category._id.toString()] || [],
  }));

  return {
    categories: items,
    userAccess: getUserResourceAccess(user || {}),
  };
};

export const listResourceStore = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  const categoryId = req.query?.categoryId?.toString().trim() || "";
  if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid categoryId");
  }

  const payload = await fetchResourceStorePayload(userId, categoryId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource store fetched",
    data: payload,
  });
});

export const listUpgradeAddOnOptions = catchAsync(async (_req, res) => {
  const options = await getUpgradeAddOnOptions();
  const optionIds = options
    .map((item) => item?._id || item?.id)
    .filter(Boolean)
    .map((id) => id.toString());

  let productById = new Map();
  if (optionIds.length) {
    const products = await ResourceProduct.find({
      _id: { $in: optionIds },
    })
      .select("coverImageUrl")
      .lean();

    productById = new Map(products.map((product) => [product._id.toString(), product]));
  }

  const sanitizedOptions = options.map((item) => {
    const rawId = item?._id || item?.id;
    const normalizedId = rawId ? rawId.toString() : "";
    const product = productById.get(normalizedId);

    return {
      id: item?.id || normalizedId,
      code: item?.code || "",
      title: item?.title || "",
      basePrice: item?.basePrice ?? item?.regularPrice ?? 0,
      regularPrice: item?.regularPrice ?? item?.price ?? 0,
      upgradeDiscountPrice:
        item?.upgradeDiscountPrice ?? item?.regularPrice ?? item?.price ?? 0,
      currency: item?.currency || "USD",
      isBundle: Boolean(item?.isBundle),
      coverImageUrl: item?.coverImageUrl || product?.coverImageUrl || "",
    };
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Upgrade add-on options fetched",
    data: sanitizedOptions,
  });
});

export const getResourcePreview = catchAsync(async (req, res) => {
  const product = await getResourceProductOrThrow({
    productId: req.params.productId,
  });

  if (!product.previewAvailable) {
    throw new AppError(httpStatus.BAD_REQUEST, "Preview is not available for this product");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource preview fetched",
    data: {
      id: product._id,
      code: product.code,
      title: product.previewTitle || `${product.title} - Introduction`,
      previewContent: product.previewContent,
      previewUrl: product.previewUrl || product.contentUrl || "",
    },
  });
});

export const getMyResourceUnlocks = catchAsync(async (req, res) => {
  const user = await User.findById(req.user?._id).select(RESOURCE_PURCHASE_USER_SELECT);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource unlocks fetched",
    data: getUserResourceAccess(user),
  });
});

export const getPurchasedResourceContent = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  const product = await getResourceProductOrThrow({
    productId: req.params.productId,
  });

  const user = await getResourceCheckoutUserOrThrow(userId);

  if (!isResourceUnlockedForUser(user, product)) {
    throw new AppError(httpStatus.FORBIDDEN, "Product is locked for this user");
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource content access granted",
    data: {
      id: product._id,
      code: product.code,
      title: product.title,
      contentUrl: product.contentUrl,
      unlocked: true,
    },
  });
});

export const createResourceStripePaymentIntent = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const product = await getResourceProductOrThrow({
    productId: req.body?.productId,
    productCode: req.body?.productCode,
  });

  const user = await getResourceCheckoutUserOrThrow(userId);

  if (isResourceUnlockedForUser(user, product)) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Resource already unlocked",
      data: {
        unlocked: true,
        productCode: product.code,
      },
    });
  }

  const pricing = getPriceForProduct(product);

  const purchase = await createPendingResourcePurchase({
    userId,
    product,
    provider: "stripe",
    pricing,
  });

  const stripe = getStripeClient();
  const amount = toStripeAmount(pricing.finalPrice, product.currency);
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: (product.currency || "USD").toLowerCase(),
    description: `Resource purchase: ${product.title}`,
    metadata: {
      userId: userId.toString(),
      productId: product._id.toString(),
      productCode: product.code,
      resourcePurchaseId: purchase._id.toString(),
      purchaseType: "resource",
      referralCodeApplied: "",
    },
  });

  purchase.stripePaymentIntentId = paymentIntent.id;
  await purchase.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource payment intent created",
    data: {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: pricing.finalPrice,
      currency: product.currency || "USD",
      product: {
        id: product._id,
        code: product.code,
        title: product.title,
      },
      pricing: {
        basePrice: pricing.basePrice,
        listedPrice: pricing.listedPrice,
        finalPrice: pricing.finalPrice,
        discountAmount: pricing.discountAmount,
        referralDiscountAmount: pricing.referralDiscountAmount,
        referralDiscountRate: pricing.referralDiscountRate,
      },
      referral: {
        applied: false,
        referralCode: "",
      },
    },
  });
});

export const confirmResourceStripePayment = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  const paymentIntentId = req.body?.paymentIntentId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (!paymentIntentId) {
    throw new AppError(httpStatus.BAD_REQUEST, "paymentIntentId is required");
  }

  const purchase = await ResourcePurchase.findOne({
    userId,
    stripePaymentIntentId: paymentIntentId,
  });
  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Resource payment record not found");
  }

  if (purchase.status === "completed") {
    const user = await getResourceCheckoutUserOrThrow(userId);
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Resource already unlocked",
      data: {
        unlocked: true,
        userAccess: getUserResourceAccess(user || {}),
      },
    });
  }

  const stripe = getStripeClient();
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (paymentIntent?.metadata?.userId !== userId.toString()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment intent does not match user");
  }

  if (paymentIntent?.metadata?.resourcePurchaseId !== purchase._id.toString()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment intent does not match purchase");
  }

  if (paymentIntent.status !== "succeeded") {
    throw new AppError(httpStatus.BAD_GATEWAY, "Stripe payment not completed");
  }

  const product = await ResourceProduct.findById(purchase.productId);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Resource product not found");
  }

  const paymentFingerprint =
    buildPaymentAccountFingerprintFromStripeIntent(paymentIntent);

  purchase.status = "completed";
  purchase.paymentAccountFingerprint = paymentFingerprint;
  purchase.purchasedAt = new Date();
  await purchase.save();

  const user = await applyResourceUnlocksToUser({ userId, product });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource unlocked",
    data: {
      unlocked: true,
      purchase,
      userAccess: getUserResourceAccess(user),
    },
  });
});

export const createResourcePayPalOrder = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }

  const product = await getResourceProductOrThrow({
    productId: req.body?.productId,
    productCode: req.body?.productCode,
  });

  const user = await getResourceCheckoutUserOrThrow(userId);

  if (isResourceUnlockedForUser(user, product)) {
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Resource already unlocked",
      data: {
        unlocked: true,
        productCode: product.code,
      },
    });
  }

  const pricing = getPriceForProduct(product);
  const token = await getPayPalAccessToken();

  const orderRes = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: product.currency || "USD",
            value: pricing.finalPrice.toFixed(2),
          },
          description: `Resource purchase: ${product.title}`,
        },
      ],
      application_context: {
        brand_name: "Inspectors Path",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
      },
    }),
  });

  const orderData = await orderRes.json().catch(() => null);
  if (!orderRes.ok || !orderData?.id) {
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to create PayPal order");
  }

  const purchase = await createPendingResourcePurchase({
    userId,
    product,
    provider: "paypal",
    pricing,
  });
  purchase.paypalOrderId = orderData.id;
  await purchase.save();

  const approvalLink =
    orderData.links?.find((link) => link.rel === "approve")?.href || null;

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource PayPal order created",
    data: {
      orderId: orderData.id,
      approvalLink,
      amount: pricing.finalPrice,
      currency: product.currency || "USD",
      purchaseId: purchase._id,
      product: {
        id: product._id,
        code: product.code,
        title: product.title,
      },
      pricing: {
        basePrice: pricing.basePrice,
        listedPrice: pricing.listedPrice,
        finalPrice: pricing.finalPrice,
        discountAmount: pricing.discountAmount,
        referralDiscountAmount: pricing.referralDiscountAmount,
        referralDiscountRate: pricing.referralDiscountRate,
      },
      referral: {
        applied: false,
        referralCode: "",
      },
    },
  });
});

export const captureResourcePayPalOrder = catchAsync(async (req, res) => {
  const userId = req.user?._id;
  const orderId = req.body?.orderId;

  if (!userId) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not authenticated");
  }
  if (!orderId) {
    throw new AppError(httpStatus.BAD_REQUEST, "orderId is required");
  }

  const purchase = await ResourcePurchase.findOne({
    userId,
    paypalOrderId: orderId,
  });

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Resource payment record not found");
  }

  if (purchase.status === "completed") {
    const user = await getResourceCheckoutUserOrThrow(userId);
    return sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Resource already unlocked",
      data: {
        unlocked: true,
        userAccess: getUserResourceAccess(user || {}),
      },
    });
  }

  const token = await getPayPalAccessToken();
  const captureRes = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const captureData = await captureRes.json().catch(() => null);
  if (!captureRes.ok) {
    throw new AppError(httpStatus.BAD_GATEWAY, "Failed to capture PayPal order");
  }

  const purchaseState =
    captureData?.status ||
    captureData?.purchase_units?.[0]?.payments?.captures?.[0]?.status;

  if (!purchaseState || purchaseState !== "COMPLETED") {
    throw new AppError(httpStatus.BAD_GATEWAY, "PayPal capture not completed");
  }

  const product = await ResourceProduct.findById(purchase.productId);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Resource product not found");
  }

  const paymentFingerprint =
    buildPaymentAccountFingerprintFromPayPalCapture(captureData);

  purchase.status = "completed";
  purchase.paymentAccountFingerprint = paymentFingerprint;
  purchase.purchasedAt = new Date();
  await purchase.save();

  const user = await applyResourceUnlocksToUser({ userId, product });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource unlocked",
    data: {
      unlocked: true,
      purchase,
      userAccess: getUserResourceAccess(user),
    },
  });
});

export const listResourceCategoriesAdmin = catchAsync(async (_req, res) => {
  const categories = await ResourceCategory.find()
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource categories fetched",
    data: categories,
  });
});

export const createResourceCategoryAdmin = catchAsync(async (req, res) => {
  const title = req.body?.title?.toString().trim();
  const slug = req.body?.slug?.toString().trim().toLowerCase();

  if (!title || !slug) {
    throw new AppError(httpStatus.BAD_REQUEST, "title and slug are required");
  }

  const exists = await ResourceCategory.findOne({ slug });
  if (exists) {
    throw new AppError(httpStatus.BAD_REQUEST, "Category slug already exists");
  }

  const category = await ResourceCategory.create({
    title,
    slug,
    shortCode: req.body?.shortCode?.toString().trim().toUpperCase() || "",
    description: req.body?.description?.toString().trim() || "",
    sortOrder: Number(req.body?.sortOrder) || 0,
    isActive: parseBoolean(req.body?.isActive, true),
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Resource category created",
    data: category,
  });
});

export const updateResourceCategoryAdmin = catchAsync(async (req, res) => {
  const category = await ResourceCategory.findById(req.params.categoryId);
  if (!category) {
    throw new AppError(httpStatus.NOT_FOUND, "Category not found");
  }

  if (req.body?.title !== undefined) {
    const title = req.body.title?.toString().trim();
    if (!title) {
      throw new AppError(httpStatus.BAD_REQUEST, "title cannot be empty");
    }
    category.title = title;
  }

  if (req.body?.slug !== undefined) {
    const slug = req.body.slug?.toString().trim().toLowerCase();
    if (!slug) {
      throw new AppError(httpStatus.BAD_REQUEST, "slug cannot be empty");
    }
    const exists = await ResourceCategory.findOne({ slug });
    if (exists && exists._id.toString() !== category._id.toString()) {
      throw new AppError(httpStatus.BAD_REQUEST, "Category slug already exists");
    }
    category.slug = slug;
  }

  if (req.body?.shortCode !== undefined) {
    category.shortCode = req.body.shortCode?.toString().trim().toUpperCase() || "";
  }

  if (req.body?.description !== undefined) {
    category.description = req.body.description?.toString().trim() || "";
  }

  if (req.body?.sortOrder !== undefined) {
    category.sortOrder = Number(req.body.sortOrder) || 0;
  }

  if (req.body?.isActive !== undefined) {
    category.isActive = parseBoolean(req.body?.isActive, category.isActive);
  }

  await category.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource category updated",
    data: category,
  });
});

export const deleteResourceCategoryAdmin = catchAsync(async (req, res) => {
  const category = await ResourceCategory.findById(req.params.categoryId);
  if (!category) {
    throw new AppError(httpStatus.NOT_FOUND, "Category not found");
  }

  const productCount = await ResourceProduct.countDocuments({ categoryId: category._id });
  if (productCount > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot delete category with existing products"
    );
  }

  await category.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource category deleted",
    data: null,
  });
});

export const listResourceProductsAdmin = catchAsync(async (_req, res) => {
  const products = await ResourceProduct.find()
    .populate("categoryId", "title slug")
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource products fetched",
    data: products,
  });
});

export const listResourcePurchasesAdmin = catchAsync(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.max(parseInt(req.query.limit, 10) || 10, 1);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.purchaseType) filter.purchaseType = req.query.purchaseType;
  if (req.query.userId) filter.userId = req.query.userId;
  if (req.query.productCode) filter.productCode = normalizeProductCode(req.query.productCode);

  const [items, total] = await Promise.all([
    ResourcePurchase.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name firstName lastName email avatar")
      .populate("productId", "title code")
      .lean(),
    ResourcePurchase.countDocuments(filter),
  ]);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource purchases fetched",
    data: {
      purchases: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    },
  });
});

export const createResourceProductAdmin = catchAsync(async (req, res) => {
  const categoryId = req.body?.categoryId;
  const title = req.body?.title?.toString().trim();

  if (!categoryId || !title) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "categoryId and title are required"
    );
  }

  const category = await ResourceCategory.findById(categoryId);
  if (!category) {
    throw new AppError(httpStatus.NOT_FOUND, "Category not found");
  }

  const code = await resolveUniqueProductCode({
    rawCode: req.body?.code,
    title,
  });

  const price = Number(req.body?.price);
  if (Number.isNaN(price) || price < 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "price must be a valid non-negative number");
  }

  const originalPrice =
    req.body?.originalPrice !== undefined
      ? Number(req.body.originalPrice)
      : price;
  const upgradeDiscountPrice =
    req.body?.upgradeDiscountPrice !== undefined && req.body?.upgradeDiscountPrice !== null
      ? Number(req.body.upgradeDiscountPrice)
      : null;
  const uploadedAssets = await uploadResourceProductAssets(req);
  const coverImageUrl = uploadedAssets.coverImageUrl
    ? uploadedAssets.coverImageUrl
    : req.body?.coverImageUrl?.toString().trim() || "";
  const contentUrl = uploadedAssets.contentUrl
    ? uploadedAssets.contentUrl
    : req.body?.contentUrl?.toString().trim() || "";
  const requestedIsBundle = parseBoolean(req.body?.isBundle, false);
  const requestedBundleIncludes = parseBundleIncludes(req.body?.bundleIncludes);
  const isBundle = requestedIsBundle || requestedBundleIncludes.length > 0;
  const bundleIncludes = await resolveBundleIncludesForProduct({
    bundleIncludes: requestedBundleIncludes,
    isBundle,
  });

  const product = await ResourceProduct.create({
    categoryId,
    code,
    title,
    shortDescription: req.body?.shortDescription?.toString().trim() || "",
    fullDescription: req.body?.fullDescription?.toString().trim() || "",
    coverImageUrl,
    contentUrl,
    price,
    originalPrice,
    upgradeDiscountPrice,
    currency: req.body?.currency?.toString().trim().toUpperCase() || "USD",
    isBundle,
    bundleIncludes,
    previewAvailable: parseBoolean(req.body?.previewAvailable, true),
    previewTitle: req.body?.previewTitle?.toString().trim() || "Introduction",
    previewContent: req.body?.previewContent?.toString().trim() || "",
    previewUrl: req.body?.previewUrl?.toString().trim() || "",
    sortOrder: Number(req.body?.sortOrder) || 0,
    isActive: parseBoolean(req.body?.isActive, true),
    showInUpgradeAddOn: parseBoolean(req.body?.showInUpgradeAddOn, true),
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Resource product created",
    data: product,
  });
});

export const updateResourceProductAdmin = catchAsync(async (req, res) => {
  const product = await ResourceProduct.findById(req.params.productId);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  if (req.body?.categoryId !== undefined) {
    const category = await ResourceCategory.findById(req.body.categoryId);
    if (!category) {
      throw new AppError(httpStatus.NOT_FOUND, "Category not found");
    }
    product.categoryId = req.body.categoryId;
  }

  if (req.body?.code !== undefined) {
    const requestedCode = req.body.code?.toString().trim();
    if (!requestedCode) {
      throw new AppError(httpStatus.BAD_REQUEST, "code cannot be empty");
    }
    product.code = await resolveUniqueProductCode({
      rawCode: requestedCode,
      title: req.body?.title ?? product.title,
      excludeProductId: product._id,
    });
  }

  const editableTextFields = [
    "title",
    "shortDescription",
    "fullDescription",
    "previewTitle",
    "previewContent",
    "previewUrl",
    "currency",
  ];

  editableTextFields.forEach((field) => {
    if (req.body?.[field] !== undefined) {
      product[field] = req.body[field]?.toString().trim() || "";
    }
  });

  if (req.body?.coverImageUrl !== undefined) {
    product.coverImageUrl = req.body.coverImageUrl?.toString().trim() || "";
  }

  if (req.body?.contentUrl !== undefined) {
    product.contentUrl = req.body.contentUrl?.toString().trim() || "";
  }

  const uploadedAssets = await uploadResourceProductAssets(req);
  if (uploadedAssets.coverImageUrl) {
    product.coverImageUrl = uploadedAssets.coverImageUrl;
  }
  if (uploadedAssets.contentUrl) {
    product.contentUrl = uploadedAssets.contentUrl;
  }

  if (req.body?.price !== undefined) {
    const price = Number(req.body.price);
    if (Number.isNaN(price) || price < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, "price must be valid");
    }
    product.price = price;
  }

  if (req.body?.originalPrice !== undefined) {
    const originalPrice = Number(req.body.originalPrice);
    if (Number.isNaN(originalPrice) || originalPrice < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, "originalPrice must be valid");
    }
    product.originalPrice = originalPrice;
  }

  if (req.body?.upgradeDiscountPrice !== undefined) {
    if (req.body.upgradeDiscountPrice === null || req.body.upgradeDiscountPrice === "") {
      product.upgradeDiscountPrice = null;
    } else {
      const upgradeDiscountPrice = Number(req.body.upgradeDiscountPrice);
      if (Number.isNaN(upgradeDiscountPrice) || upgradeDiscountPrice < 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "upgradeDiscountPrice must be valid");
      }
      product.upgradeDiscountPrice = upgradeDiscountPrice;
    }
  }

  const hasBundleFlagUpdate = req.body?.isBundle !== undefined;
  const hasBundleIncludesUpdate = req.body?.bundleIncludes !== undefined;
  if (hasBundleFlagUpdate || hasBundleIncludesUpdate) {
    const requestedIsBundle = hasBundleFlagUpdate
      ? parseBoolean(req.body?.isBundle, product.isBundle)
      : product.isBundle;
    const requestedBundleIncludes = hasBundleIncludesUpdate
      ? parseBundleIncludes(req.body?.bundleIncludes)
      : parseBundleIncludes(product.bundleIncludes);

    let nextIsBundle = requestedIsBundle;
    if (hasBundleIncludesUpdate) {
      if (requestedBundleIncludes.length > 0) {
        nextIsBundle = true;
      } else if (!hasBundleFlagUpdate) {
        nextIsBundle = false;
      }
    }

    product.bundleIncludes = await resolveBundleIncludesForProduct({
      bundleIncludes: requestedBundleIncludes,
      isBundle: nextIsBundle,
      currentProductId: product._id,
    });
    product.isBundle = nextIsBundle;
  } else if (!product.isBundle) {
    product.bundleIncludes = [];
  }

  if (req.body?.previewAvailable !== undefined) {
    product.previewAvailable = parseBoolean(req.body.previewAvailable, product.previewAvailable);
  }

  if (req.body?.sortOrder !== undefined) {
    product.sortOrder = Number(req.body.sortOrder) || 0;
  }

  if (req.body?.isActive !== undefined) {
    product.isActive = parseBoolean(req.body.isActive, product.isActive);
  }

  if (req.body?.showInUpgradeAddOn !== undefined) {
    product.showInUpgradeAddOn = parseBoolean(
      req.body.showInUpgradeAddOn,
      product.showInUpgradeAddOn
    );
  }

  await product.save();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource product updated",
    data: product,
  });
});

export const deleteResourceProductAdmin = catchAsync(async (req, res) => {
  const product = await ResourceProduct.findById(req.params.productId);
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Product not found");
  }

  await product.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resource product deleted",
    data: null,
  });
});
