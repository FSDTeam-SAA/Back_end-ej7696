import express from "express";
import {
  captureResourcePayPalOrder,
  confirmResourceStripePayment,
  createResourceCategoryAdmin,
  createResourcePayPalOrder,
  createResourceProductAdmin,
  createResourceStripePaymentIntent,
  deleteResourceCategoryAdmin,
  deleteResourceProductAdmin,
  getMyResourceUnlocks,
  getPurchasedResourceContent,
  getResourcePreview,
  listResourceCategoriesAdmin,
  listResourcePurchasesAdmin,
  listResourceProductsAdmin,
  listResourceStore,
  listUpgradeAddOnOptions,
  updateResourceCategoryAdmin,
  updateResourceProductAdmin,
} from "../controller/resource.controller.js";
import { protect, requirePermission } from "../middleware/auth.middleware.js";
import upload from "../middleware/multer.middleware.js";

const router = express.Router();

router.get("/store", protect, listResourceStore);
router.get("/upgrade-addon-options", listUpgradeAddOnOptions);
router.get("/products/:productId/preview", protect, getResourcePreview);
router.get("/products/:productId/content", protect, getPurchasedResourceContent);
router.get("/my-unlocks", protect, getMyResourceUnlocks);

router.post("/purchase/stripe/create", protect, createResourceStripePaymentIntent);
router.post("/purchase/stripe/confirm", protect, confirmResourceStripePayment);
router.post("/purchase/paypal/create", protect, createResourcePayPalOrder);
router.post("/purchase/paypal/capture", protect, captureResourcePayPalOrder);

router.get(
  "/admin/categories",
  protect,
  requirePermission("manage_resource_store"),
  listResourceCategoriesAdmin
);
router.post(
  "/admin/categories",
  protect,
  requirePermission("manage_resource_store"),
  createResourceCategoryAdmin
);
router.patch(
  "/admin/categories/:categoryId",
  protect,
  requirePermission("manage_resource_store"),
  updateResourceCategoryAdmin
);
router.delete(
  "/admin/categories/:categoryId",
  protect,
  requirePermission("manage_resource_store"),
  deleteResourceCategoryAdmin
);

router.get(
  "/admin/purchases",
  protect,
  requirePermission("view_billing_summary"),
  listResourcePurchasesAdmin
);
router.get(
  "/admin/products",
  protect,
  requirePermission("manage_resource_store"),
  listResourceProductsAdmin
);
router.post(
  "/admin/products",
  protect,
  requirePermission("manage_resource_store"),
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "contentFile", maxCount: 1 },
  ]),
  createResourceProductAdmin
);
router.patch(
  "/admin/products/:productId",
  protect,
  requirePermission("manage_resource_store"),
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "contentFile", maxCount: 1 },
  ]),
  updateResourceProductAdmin
);
router.delete(
  "/admin/products/:productId",
  protect,
  requirePermission("manage_resource_store"),
  deleteResourceProductAdmin
);

export default router;
