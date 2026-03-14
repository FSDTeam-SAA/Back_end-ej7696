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

const asUniqueStringArray = (items = []) =>
  [...new Set((items || []).map((i) => i?.toString().trim().toLowerCase()).filter(Boolean))];

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
    upgradeDiscountPrice: item.upgradeDiscountPrice ?? item.price,
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
  const unlocked = new Set(asUniqueStringArray(user?.resourceUnlocks));

  if (user?.has_api510_inspection_guide) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE);
  }
  if (user?.has_api510_report_guide) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE);
  }
  if (user?.has_api510_bundle) {
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_BUNDLE);
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE);
    unlocked.add(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE);
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

export const applyResourceUnlocksToUser = async ({ userId, product }) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const unlockCodes = getUnlockCodesForProduct(product);
  const nextCodes = new Set(getUnlockedResourceCodeSet(user));
  unlockCodes.forEach((code) => nextCodes.add(code));

  user.resourceUnlocks = [...nextCodes];

  if (nextCodes.has(RESOURCE_PRODUCT_CODES.API510_BUNDLE)) {
    user.has_api510_bundle = true;
  }
  if (nextCodes.has(RESOURCE_PRODUCT_CODES.API510_INSPECTION_GUIDE)) {
    user.has_api510_inspection_guide = true;
  }
  if (nextCodes.has(RESOURCE_PRODUCT_CODES.API510_REPORT_GUIDE)) {
    user.has_api510_report_guide = true;
  }

  if (user.has_api510_bundle) {
    user.has_api510_inspection_guide = true;
    user.has_api510_report_guide = true;
  }

  await user.save();
  return user;
};

export const resolveResourceRevenueTag = (purchaseType, productCode) => {
  const code = normalizeProductCode(productCode);
  if (purchaseType === "professional_upgrade_addon") {
    return `pro_upgrade_addon:${code}`;
  }
  if (code === RESOURCE_PRODUCT_CODES.API510_BUNDLE) {
    return "ebook_bundle";
  }
  return "ebook_single";
};
