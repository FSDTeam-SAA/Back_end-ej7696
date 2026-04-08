import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import { ResourceProduct } from "../model/resourceProduct.model.js";
import { User } from "../model/user.model.js";

export const RESOURCE_PRODUCT_CODES = {
  API510_INSPECTION_GUIDE: "api510_inspection_guide",
  API510_REPORT_GUIDE: "api510_report_guide",
  API510_BUNDLE: "api510_bundle",
};

export const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const normalizeProductCode = (code) =>
  code?.toString().trim().toLowerCase() || "";

export const getUpgradeCheckoutPrice = (product) => {
  const upgradeDiscountPrice = Number(product?.upgradeDiscountPrice);
  if (Number.isFinite(upgradeDiscountPrice) && upgradeDiscountPrice > 0) {
    return roundCurrency(upgradeDiscountPrice);
  }

  const regularPrice = Number(product?.price);
  if (Number.isFinite(regularPrice) && regularPrice > 0) {
    return roundCurrency(regularPrice);
  }

  return roundCurrency(product?.originalPrice ?? 0);
};

const asUniqueStringArray = (items = []) => {
  const normalizedItems = Array.isArray(items)
    ? items
    : items instanceof Set
      ? [...items]
      : typeof items === "string" || typeof items === "number"
        ? [items]
        : items && typeof items[Symbol.iterator] === "function"
          ? [...items]
          : [];

  return [
    ...new Set(
      normalizedItems
        .map((i) => i?.toString().trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
};

export const getUpgradeAddOnOptions = async () => {
  const options = await ResourceProduct.find({
    showInUpgradeAddOn: true,
    isActive: true,
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();

  return options.map((item) => ({
    id: item?._id?.toString?.() || "",
    code: item.code,
    title: item.title,
    basePrice: item.originalPrice ?? item.price,
    regularPrice: item.price,
    upgradeDiscountPrice: getUpgradeCheckoutPrice(item),
    currency: item.currency || "USD",
    isBundle: Boolean(item.isBundle),
    coverImageUrl: item.coverImageUrl || "",
  }));
};

export const getResourceProductOrThrow = async ({ productId, productCode }) => {
  if (!productId && !productCode) {
    throw new AppError(httpStatus.BAD_REQUEST, "productId or productCode is required");
  }

  const query = {};
  if (productId) query._id = productId;
  if (productCode) query.code = normalizeProductCode(productCode);

  const product = await ResourceProduct.findOne({ ...query, isActive: true });
  if (!product) {
    throw new AppError(httpStatus.NOT_FOUND, "Resource product not found");
  }

  return product;
};

export const getUnlockedResourceCodeSet = (user) => {
  const explicitUnlocks = asUniqueStringArray(user?.resourceUnlocks);
  const unlocked = new Set(explicitUnlocks);
  const hasInspectionGuide = Boolean(user?.has_api510_inspection_guide);
  const hasReportGuide = Boolean(user?.has_api510_report_guide);
  const hasBundle = Boolean(user?.has_api510_bundle);

  if (hasInspectionGuide) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE);
  }
  if (hasReportGuide) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE);
  }
  if (hasBundle) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_BUNDLE);

    // Preserve legacy users that only had the bundle flag populated.
    if (!explicitUnlocks.length && !hasInspectionGuide && !hasReportGuide) {
      unlocked.add(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE);
      unlocked.add(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE);
    }
  }

  return unlocked;
};

export const getUnlockCodesForProduct = (product) => {
  const ownCode = normalizeProductCode(product?.code);
  const includes = asUniqueStringArray(product?.bundleIncludes);

  const unlockCodes = new Set([ownCode, ...includes]);

  if (ownCode === RESOURCE_PRODUCT_CODES.API510_BUNDLE) {
    unlockCodes.add(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE);
    unlockCodes.add(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE);
  }

  return [...unlockCodes].filter(Boolean);
};

export const isResourceUnlockedForUser = (user, product) => {
  const unlocked = getUnlockedResourceCodeSet(user);
  return unlocked.has(normalizeProductCode(product?.code));
};

const buildUserResourceUnlockState = (unlockCodes) => {
  const normalizedCodes = new Set(asUniqueStringArray(unlockCodes));

  return {
    resourceUnlocks: [...normalizedCodes],
    has_api510_bundle: normalizedCodes.has(RESOURCE_PRODUCT_CODES.API510_BUNDLE),
    has_api510_inspection_guide: normalizedCodes.has(
      RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE
    ),
    has_api510_report_guide: normalizedCodes.has(
      RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE
    ),
  };
};

export const setUserResourceUnlockCodes = (user, unlockCodes) => {
  Object.assign(user, buildUserResourceUnlockState(unlockCodes));
  return user;
};

export const persistUserResourceUnlockCodes = async ({ userId, unlockCodes }) => {
  const update = buildUserResourceUnlockState(unlockCodes);
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: update },
    { new: true }
  );
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  return user;
};

export const applyResourceUnlocksToUser = async ({ userId, product }) => {
  const unlockCodes = asUniqueStringArray(getUnlockCodesForProduct(product));
  const nextFlags = buildUserResourceUnlockState(unlockCodes);
  const update = {
    $addToSet: {
      resourceUnlocks: { $each: unlockCodes },
    },
    $set: {
      has_api510_bundle: nextFlags.has_api510_bundle,
      has_api510_inspection_guide: nextFlags.has_api510_inspection_guide,
      has_api510_report_guide: nextFlags.has_api510_report_guide,
    },
  };

  const user = await User.findByIdAndUpdate(userId, update, { new: true });
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }
  return user;
};

export const resolveResourceRevenueTag = (purchaseType, productCode) => {
  const code = normalizeProductCode(productCode);
  if (
    purchaseType === "professional_upgrade_addon" ||
    purchaseType === "exam_unlock_addon"
  ) {
    const prefix =
      purchaseType === "professional_upgrade_addon"
        ? "pro_upgrade_addon"
        : "exam_unlock_addon";
    return `${prefix}:${code}`;
  }
  if (code === RESOURCE_PRODUCT_CODES.API510_BUNDLE) {
    return "ebook_bundle";
  }
  return "ebook_single";
};
