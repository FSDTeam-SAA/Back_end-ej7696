import crypto from "crypto";
import jwt from "jsonwebtoken";
import { AppSetting } from "../model/appSetting.model.js";
import { Exam } from "../model/exam.model.js";
import { StorePriceUpdate } from "../model/storePriceUpdate.model.js";

const APPLE_API_ORIGIN = "https://api.appstoreconnect.apple.com";
const GOOGLE_API_ORIGIN = "https://androidpublisher.googleapis.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const USA_TERRITORY = "USA";

const EXAM_CODES = [
  "api1169",
  "api1184",
  "api510",
  "api570",
  "api653",
  "api936",
  "siee",
  "sife",
  "sire",
];

export const STORE_PRICE_CATALOG = {
  professional_plan: {
    apple: [{ productId: "one_month_subscriptions", kind: "subscription" }],
    google: [{ productId: "six_month_subscriptions", basePlanId: "one-month" }],
  },
  exam_unlock: {
    apple: EXAM_CODES.map((code) => ({
      productId: `com.inspectorspath.exam.${code}.onemonth`,
      kind: "iap",
    })),
    google: EXAM_CODES.map((code) => ({
      productId: `com.inspectorspath.exam.${code}.sixmonth`,
      basePlanId: `${code}onemonth`,
    })),
  },
};

const catalogForTarget = async (target) => {
  const catalog = STORE_PRICE_CATALOG[target];
  if (!catalog || target !== "exam_unlock") return catalog;
  const exams = await Exam.find({
    "storeProducts.appleProductId": { $exists: true, $ne: "" },
    "storeProducts.googleProductId": { $exists: true, $ne: "" },
    "storeProducts.googleBasePlanId": { $exists: true, $ne: "" },
  }).select("storeProducts").lean();
  const apple = [...catalog.apple];
  const google = [...catalog.google];
  for (const exam of exams) {
    const products = exam.storeProducts;
    if (!apple.some((item) => item.productId === products.appleProductId)) {
      apple.push({ productId: products.appleProductId, kind: "iap" });
    }
    if (!google.some((item) => item.productId === products.googleProductId && item.basePlanId === products.googleBasePlanId)) {
      google.push({ productId: products.googleProductId, basePlanId: products.googleBasePlanId });
    }
  }
  return { apple, google };
};

const cleanSecret = (value = "") =>
  value.toString().trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");

const normalizeMoney = (value) => {
  const rounded = Math.round(Number(value) * 100) / 100;
  const units = Math.trunc(rounded);
  const nanos = Math.round((rounded - units) * 1e9);
  return { currencyCode: "USD", units: units.toString(), nanos };
};

const errorText = (error) =>
  (error?.message || error?.toString?.() || "Unknown store pricing error").slice(0, 1000);

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const detail =
      payload?.errors?.[0]?.detail ||
      payload?.error?.message ||
      payload?.error_description ||
      (typeof payload === "string" ? payload : "");
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }
  return payload;
};

const getAppleToken = () => {
  const issuerId = cleanSecret(process.env.APP_STORE_CONNECT_ISSUER_ID);
  const keyId = cleanSecret(process.env.APP_STORE_CONNECT_KEY_ID);
  const privateKey = cleanSecret(process.env.APP_STORE_CONNECT_PRIVATE_KEY);
  if (!issuerId || !keyId || !privateKey) {
    throw new Error("App Store Connect API credentials are not configured");
  }
  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: issuerId,
    audience: "appstoreconnect-v1",
    expiresIn: "15m",
    keyid: keyId,
  });
};

const appleRequest = (path, options = {}) =>
  requestJson(`${APPLE_API_ORIGIN}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAppleToken()}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

const listAppleAppIds = async () => {
  const configuredAppId = cleanSecret(process.env.APP_STORE_CONNECT_APP_ID);
  if (!configuredAppId) throw new Error("APP_STORE_CONNECT_APP_ID is not configured");
  const payload = await appleRequest("/v1/apps?limit=200&fields%5Bapps%5D=name,bundleId");
  const visibleIds = (payload?.data || []).map((item) => item.id).filter(Boolean);
  return [configuredAppId, ...visibleIds.filter((id) => id !== configuredAppId)];
};

const findAppleIap = async (productId) => {
  const params = new URLSearchParams({
    "filter[productId]": productId,
    "fields[inAppPurchases]": "name,productId,inAppPurchaseType,state",
    limit: "10",
  });
  const appIds = await listAppleAppIds();
  for (const appId of appIds) {
    const payload = await appleRequest(
      `/v1/apps/${encodeURIComponent(appId)}/inAppPurchasesV2?${params}`
    );
    const product = payload?.data?.find((item) => item?.attributes?.productId === productId);
    if (product) return product;
  }
  throw new Error(`Apple in-app purchase not found: ${productId}`);
};

const findAppleSubscription = async (productId) => {
  const params = new URLSearchParams({
    include: "subscriptions",
    "limit[subscriptions]": "50",
    limit: "50",
  });
  const appIds = await listAppleAppIds();
  for (const appId of appIds) {
    const payload = await appleRequest(
      `/v1/apps/${encodeURIComponent(appId)}/subscriptionGroups?${params}`
    );
    const product = payload?.included?.find(
      (item) => item?.type === "subscriptions" && item?.attributes?.productId === productId
    );
    if (product) return product;
  }
  throw new Error(`Apple subscription not found: ${productId}`);
};

const findApplePricePoint = async ({ resourceId, kind, price }) => {
  const basePath =
    kind === "subscription"
      ? `/v1/subscriptions/${encodeURIComponent(resourceId)}/pricePoints`
      : `/v2/inAppPurchases/${encodeURIComponent(resourceId)}/pricePoints`;
  const fieldName =
    kind === "subscription" ? "subscriptionPricePoints" : "inAppPurchasePricePoints";
  const params = new URLSearchParams({
    "filter[territory]": USA_TERRITORY,
    [`fields[${fieldName}]`]: "customerPrice,proceeds,territory",
    include: "territory",
    limit: "8000",
  });
  if (kind === "subscription") {
    params.set("filter[planType]", "UPFRONT");
  }
  const payload = await appleRequest(`${basePath}?${params}`);
  const target = Number(price).toFixed(2);
  const point = payload?.data?.find(
    (item) => Number(item?.attributes?.customerPrice).toFixed(2) === target
  );
  if (!point) {
    throw new Error(`USD ${target} is not an Apple-supported price point for this product`);
  }
  return point;
};

const getCurrentAppleSubscriptionPrice = async (subscriptionId) => {
  const params = new URLSearchParams({
    "filter[territory]": USA_TERRITORY,
    "filter[planType]": "UPFRONT",
    include: "subscriptionPricePoint",
    limit: "200",
  });
  const payload = await appleRequest(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/prices?${params}`
  );
  const pointPrices = new Map(
    (payload?.included || [])
      .filter((item) => item?.type === "subscriptionPricePoints")
      .map((item) => [item.id, Number(item?.attributes?.customerPrice)])
  );
  const current = (payload?.data || []).find((item) => item?.attributes?.startDate === null);
  const pointId = current?.relationships?.subscriptionPricePoint?.data?.id;
  const value = pointPrices.get(pointId);
  return Number.isFinite(value) ? value : null;
};

const appleScheduledStartDate = () => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  return date.toISOString().slice(0, 10);
};

const updateAppleSubscriptionPrice = async (catalogItem, price) => {
  const product = await findAppleSubscription(catalogItem.productId);
  const point = await findApplePricePoint({
    resourceId: product.id,
    kind: "subscription",
    price,
  });
  const isApproved = product.attributes?.state === "APPROVED";
  const currentPrice = isApproved
    ? await getCurrentAppleSubscriptionPrice(product.id)
    : null;
  const payload = await appleRequest("/v1/subscriptionPrices", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionPrices",
        attributes: {
          startDate: isApproved ? appleScheduledStartDate() : null,
          planType: "UPFRONT",
          preserveCurrentPrice:
            isApproved && currentPrice !== null && Number(price) > currentPrice,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: product.id } },
          subscriptionPricePoint: {
            data: { type: "subscriptionPricePoints", id: point.id },
          },
        },
      },
    }),
  });
  return { externalId: payload?.data?.id || point.id, storeProductStatus: product.attributes?.state || "" };
};

const updateAppleIapPrice = async (catalogItem, price) => {
  const product = await findAppleIap(catalogItem.productId);
  const point = await findApplePricePoint({ resourceId: product.id, kind: "iap", price });
  // Apple JSON:API inline resources require a local ID wrapped as `${local-id}`.
  const priceId = "${price-" + crypto.randomUUID() + "}";
  const payload = await appleRequest("/v1/inAppPurchasePriceSchedules", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: product.id } },
          baseTerritory: { data: { type: "territories", id: USA_TERRITORY } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: priceId }] },
        },
      },
      included: [
        {
          type: "inAppPurchasePrices",
          id: priceId,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: "inAppPurchases", id: product.id } },
            inAppPurchasePricePoint: {
              data: { type: "inAppPurchasePricePoints", id: point.id },
            },
          },
        },
      ],
    }),
  });
  return { externalId: payload?.data?.id || point.id, storeProductStatus: product.attributes?.state || "" };
};

const getGoogleToken = async () => {
  const email = cleanSecret(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL);
  const privateKey = cleanSecret(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (!email || !privateKey) throw new Error("Google Play service account is not configured");
  const assertion = jwt.sign(
    { scope: "https://www.googleapis.com/auth/androidpublisher" },
    privateKey,
    { algorithm: "RS256", issuer: email, audience: GOOGLE_TOKEN_URL, expiresIn: "1h" }
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const payload = await requestJson(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return payload.access_token;
};

const googleRequest = async (path, token, options = {}) =>
  requestJson(`${GOOGLE_API_ORIGIN}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

const convertGooglePrices = async (token, packageName, price) =>
  googleRequest(
    `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/pricing:convertRegionPrices`,
    token,
    { method: "POST", body: JSON.stringify({ price: normalizeMoney(price) }) }
  );

const updateGoogleSubscriptionPrice = async (catalogItem, price, token) => {
  const packageName = cleanSecret(process.env.GOOGLE_PLAY_PACKAGE_NAME);
  if (!packageName) throw new Error("GOOGLE_PLAY_PACKAGE_NAME is not configured");
  const productPath = `/androidpublisher/v3/applications/${encodeURIComponent(
    packageName
  )}/subscriptions/${encodeURIComponent(catalogItem.productId)}`;
  const [subscription, converted] = await Promise.all([
    googleRequest(productPath, token),
    convertGooglePrices(token, packageName, price),
  ]);
  const targetPlan = subscription?.basePlans?.find(
    (plan) => plan.basePlanId === catalogItem.basePlanId
  );
  if (!targetPlan) {
    throw new Error(`Google base plan not found: ${catalogItem.productId}:${catalogItem.basePlanId}`);
  }
  const convertedByRegion = converted?.convertedRegionPrices || {};
  targetPlan.regionalConfigs = (targetPlan.regionalConfigs || []).map((config) => ({
    ...config,
    price: convertedByRegion[config.regionCode]?.price || config.price,
  }));
  if (converted?.convertedOtherRegionsPrice) {
    targetPlan.otherRegionsConfig = {
      ...(targetPlan.otherRegionsConfig || {}),
      ...converted.convertedOtherRegionsPrice,
    };
  }
  const regionVersion = converted?.regionVersion?.version;
  if (!regionVersion) throw new Error("Google Play did not return a regions version");
  const params = new URLSearchParams({
    updateMask: "basePlans",
    "regionsVersion.version": regionVersion,
  });
  const updated = await googleRequest(`${productPath}?${params}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      packageName,
      productId: catalogItem.productId,
      basePlans: subscription.basePlans,
    }),
  });
  const updatedPlan = updated?.basePlans?.find(
    (plan) => plan.basePlanId === catalogItem.basePlanId
  );
  return {
    externalId: `${catalogItem.productId}:${catalogItem.basePlanId}`,
    storeProductStatus: updatedPlan?.state || targetPlan.state || "",
  };
};

const prepareProvider = (items) => ({
  status: "pending",
  items: items.map((item) => ({
    productId: item.productId,
    basePlanId: item.basePlanId || "",
    status: "pending",
  })),
});

export const createStorePriceUpdateJob = async ({ target, newPrice, initiatedBy }) => {
  const catalog = await catalogForTarget(target);
  if (!catalog) throw new Error("Unsupported price update target");
  const settings = await AppSetting.findOne().lean();
  const oldPrice =
    target === "professional_plan"
      ? settings?.professionalPlanPrice ?? 199.99
      : settings?.examUnlockPrice ?? 150;
  return StorePriceUpdate.create({
    target,
    currency: "USD",
    oldPrice,
    newPrice,
    initiatedBy,
    apple: prepareProvider(catalog.apple),
    google: prepareProvider(catalog.google),
    database: { status: "pending", items: [] },
  });
};

const saveItemResult = async (job, providerName, index, work) => {
  const item = job[providerName].items[index];
  item.status = "updating";
  item.error = "";
  await job.save();
  try {
    const result = await work();
    item.status = "confirmed";
    item.externalId = result.externalId || "";
    item.storeProductStatus = result.storeProductStatus || "";
    item.confirmedAt = new Date();
  } catch (error) {
    item.status = "failed";
    item.error = errorText(error);
  }
  await job.save();
};

const finishProvider = async (job, providerName) => {
  const provider = job[providerName];
  const confirmed = provider.items.filter((item) => item.status === "confirmed").length;
  provider.status =
    confirmed === provider.items.length ? "confirmed" : confirmed > 0 ? "partial" : "failed";
  provider.completedAt = new Date();
  provider.error = provider.items.find((item) => item.status === "failed")?.error || "";
  await job.save();
};

export const processStorePriceUpdateJob = async (jobId) => {
  const job = await StorePriceUpdate.findById(jobId);
  if (!job) return null;
  const catalog = {
    apple: job.apple.items.map((item) => ({ productId: item.productId, kind: job.target === "professional_plan" ? "subscription" : "iap" })),
    google: job.google.items.map((item) => ({ productId: item.productId, basePlanId: item.basePlanId })),
  };
  job.status = "running";
  job.startedAt = job.startedAt || new Date();
  job.lastError = "";
  job.apple.status = "updating";
  job.apple.startedAt = new Date();
  await job.save();

  for (let index = 0; index < catalog.apple.length; index += 1) {
    if (job.apple.items[index].status === "confirmed") continue;
    const catalogItem = catalog.apple[index];
    await saveItemResult(job, "apple", index, () =>
      catalogItem.kind === "subscription"
        ? updateAppleSubscriptionPrice(catalogItem, job.newPrice)
        : updateAppleIapPrice(catalogItem, job.newPrice)
    );
  }
  await finishProvider(job, "apple");

  if (job.apple.status !== "confirmed") {
    job.google.status = "skipped";
    job.status = "failed";
    job.lastError = job.apple.error || "Apple price update was not fully confirmed";
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  job.google.status = "updating";
  job.google.startedAt = new Date();
  await job.save();
  let googleToken;
  try {
    googleToken = await getGoogleToken();
  } catch (error) {
    job.google.status = "failed";
    job.google.error = errorText(error);
    job.status = "failed";
    job.lastError = job.google.error;
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  for (let index = 0; index < catalog.google.length; index += 1) {
    if (job.google.items[index].status === "confirmed") continue;
    const catalogItem = catalog.google[index];
    await saveItemResult(job, "google", index, () =>
      updateGoogleSubscriptionPrice(catalogItem, job.newPrice, googleToken)
    );
  }
  await finishProvider(job, "google");

  if (job.google.status !== "confirmed") {
    job.status = "partial";
    job.lastError = job.google.error || "Google Play price update was not fully confirmed";
    job.completedAt = new Date();
    await job.save();
    return job;
  }

  job.database.status = "updating";
  job.database.startedAt = new Date();
  await job.save();
  try {
    const field = job.target === "professional_plan" ? "professionalPlanPrice" : "examUnlockPrice";
    await AppSetting.findOneAndUpdate(
      {},
      { $set: { [field]: job.newPrice, currency: "USD" } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    job.database.status = "confirmed";
    job.database.completedAt = new Date();
    job.status = "completed";
    job.completedAt = new Date();
  } catch (error) {
    job.database.status = "failed";
    job.database.error = errorText(error);
    job.status = "partial";
    job.lastError = job.database.error;
    job.completedAt = new Date();
  }
  await job.save();
  return job;
};

const scheduleAutomaticRetry = (jobId) => {
  setTimeout(async () => {
    const job = await StorePriceUpdate.findOneAndUpdate(
      {
        _id: jobId,
        status: { $in: ["failed", "partial"] },
        retryCount: { $lt: 2 },
      },
      {
        $set: { status: "queued", lastError: "", completedAt: null },
        $inc: { retryCount: 1 },
      },
      { new: true }
    ).catch(() => null);
    if (!job) return;
    if (job.apple.status !== "confirmed") job.apple.status = "pending";
    if (job.google.status !== "confirmed") job.google.status = "pending";
    if (job.database.status !== "confirmed") job.database.status = "pending";
    await job.save();
    queueStorePriceUpdateJob(job._id);
  }, 30_000);
};

export const queueStorePriceUpdateJob = (jobId) => {
  setImmediate(() => {
    processStorePriceUpdateJob(jobId)
      .then((job) => {
        if (job && ["failed", "partial"].includes(job.status) && job.retryCount < 2) {
          scheduleAutomaticRetry(job._id);
        }
      })
      .catch(async (error) => {
        const job = await StorePriceUpdate.findByIdAndUpdate(
          jobId,
          { $set: { status: "failed", lastError: errorText(error), completedAt: new Date() } },
          { new: true }
        ).catch(() => null);
        if (job && job.retryCount < 2) scheduleAutomaticRetry(job._id);
      });
  });
};

export const resumeStorePriceUpdateJobs = async () => {
  const jobs = await StorePriceUpdate.find({ status: { $in: ["queued", "running"] } })
    .select("_id")
    .lean();
  jobs.forEach((job) => queueStorePriceUpdateJob(job._id));
  return jobs.length;
};
