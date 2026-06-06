import httpStatus from "http-status";
import AppError from "../errors/AppError.js";
import catchAsync from "../utils/catchAsync.js";
import sendResponse from "../utils/sendResponse.js";
import {
  Plan,
  PLAN_DURATIONS,
  PLAN_DURATION_LABELS,
} from "../model/plan.model.js";
import { AppSetting } from "../model/appSetting.model.js";

const durationLabelFromInterval = (count) => {
  if (Number(count) >= 6) return "Six Months";
  if (Number(count) >= 3) return "Three Months";
  return "One Month";
};

const normalizeFeatures = (raw) => {
  let parsed = [];
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "features must be a valid JSON array"
      );
    }
  } else if (Array.isArray(raw)) {
    parsed = raw;
  }
  return parsed.map((item) => item?.toString().trim()).filter(Boolean);
};

// The legacy single-plan checkout (AppSetting) follows whichever plan matches
// the active checkout interval. No user-facing "default" flag.
const getCheckoutIntervalCount = async () => {
  const settings = await AppSetting.findOne().lean();
  return Number(settings?.professionalPlanIntervalCount) || 3;
};

const syncCheckoutFromPlan = async (plan) => {
  if (!plan) return;
  await AppSetting.findOneAndUpdate(
    {},
    {
      professionalPlanPrice: plan.price,
      professionalPlanIntervalCount: plan.intervalCount,
      professionalPlanIntervalUnit: plan.intervalUnit,
      professionalPlanDescription: plan.description,
      professionalPlanFeatures: plan.features,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

// If the written plan is the one that drives checkout, keep checkout in sync.
const syncCheckoutIfActive = async (plan) => {
  const interval = await getCheckoutIntervalCount();
  if (plan && Number(plan.intervalCount) === interval) {
    await syncCheckoutFromPlan(plan);
  }
};

// First load migration: turn the existing AppSetting plan into a managed Plan.
const ensureSeed = async () => {
  const count = await Plan.countDocuments();
  if (count > 0) return;

  const settings = await AppSetting.findOne().lean();
  const intervalCount = Number(settings?.professionalPlanIntervalCount) || 3;
  const durationLabel = durationLabelFromInterval(intervalCount);

  await Plan.updateOne(
    { durationLabel },
    {
      $setOnInsert: {
        name: "Professional Plan",
        price: Number(settings?.professionalPlanPrice) || 180,
        durationLabel,
        intervalCount: PLAN_DURATIONS[durationLabel].intervalCount,
        intervalUnit: PLAN_DURATIONS[durationLabel].intervalUnit,
        description:
          settings?.professionalPlanDescription ||
          "What's included in your plan",
        features: Array.isArray(settings?.professionalPlanFeatures)
          ? settings.professionalPlanFeatures
          : [],
        status: "Active",
      },
    },
    { upsert: true }
  );
};

export const listPlans = catchAsync(async (req, res) => {
  await ensureSeed();
  // Drop the legacy isDefault field from any previously-created documents.
  // Use the raw driver so Mongoose's strict schema doesn't strip the unknown
  // `isDefault` path from the filter/update (which would make $unset a no-op).
  await Plan.collection.updateMany(
    { isDefault: { $exists: true } },
    { $unset: { isDefault: "" } }
  );

  const plans = await Plan.find().sort({ intervalCount: 1 }).lean();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plans fetched",
    data: {
      plans,
      availableDurations: PLAN_DURATION_LABELS,
    },
  });
});

export const createPlan = catchAsync(async (req, res) => {
  const name = req.body.name?.toString().trim();
  const price = Number(req.body.price);
  const durationLabel = req.body.durationLabel?.toString().trim();
  const description = req.body.description?.toString().trim();
  const features = normalizeFeatures(req.body.features);

  if (!name) throw new AppError(httpStatus.BAD_REQUEST, "name is required");
  if (!Number.isFinite(price) || price <= 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "price must be a positive number");
  }
  if (!PLAN_DURATIONS[durationLabel]) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `durationLabel must be one of: ${PLAN_DURATION_LABELS.join(", ")}`
    );
  }
  if (!features.length) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "features must be a non-empty array"
    );
  }

  const existing = await Plan.findOne({ durationLabel });
  if (existing) {
    throw new AppError(
      httpStatus.CONFLICT,
      `A "${durationLabel}" plan already exists`
    );
  }

  const { intervalCount, intervalUnit } = PLAN_DURATIONS[durationLabel];

  const plan = await Plan.create({
    name,
    price,
    durationLabel,
    intervalCount,
    intervalUnit,
    description: description || "What's included in your plan",
    features,
    status: req.body.status === "Inactive" ? "Inactive" : "Active",
  });

  await syncCheckoutIfActive(plan);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Plan created",
    data: plan,
  });
});

export const updatePlan = catchAsync(async (req, res) => {
  const { id } = req.params;
  const plan = await Plan.findById(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");

  if (req.body.name !== undefined) {
    const name = req.body.name?.toString().trim();
    if (!name) throw new AppError(httpStatus.BAD_REQUEST, "name is required");
    plan.name = name;
  }

  if (req.body.price !== undefined) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "price must be a positive number"
      );
    }
    plan.price = price;
  }

  if (req.body.durationLabel !== undefined) {
    const durationLabel = req.body.durationLabel?.toString().trim();
    if (!PLAN_DURATIONS[durationLabel]) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `durationLabel must be one of: ${PLAN_DURATION_LABELS.join(", ")}`
      );
    }
    if (durationLabel !== plan.durationLabel) {
      const clash = await Plan.findOne({
        durationLabel,
        _id: { $ne: plan._id },
      });
      if (clash) {
        throw new AppError(
          httpStatus.CONFLICT,
          `A "${durationLabel}" plan already exists`
        );
      }
      plan.durationLabel = durationLabel;
      plan.intervalCount = PLAN_DURATIONS[durationLabel].intervalCount;
      plan.intervalUnit = PLAN_DURATIONS[durationLabel].intervalUnit;
    }
  }

  if (req.body.description !== undefined) {
    plan.description =
      req.body.description?.toString().trim() || "What's included in your plan";
  }

  if (req.body.features !== undefined) {
    const features = normalizeFeatures(req.body.features);
    if (!features.length) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "features must be a non-empty array"
      );
    }
    plan.features = features;
  }

  if (req.body.status !== undefined) {
    plan.status = req.body.status === "Inactive" ? "Inactive" : "Active";
  }

  await plan.save();

  await syncCheckoutIfActive(plan);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan updated",
    data: plan,
  });
});

export const deletePlan = catchAsync(async (req, res) => {
  const { id } = req.params;
  const plan = await Plan.findById(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");

  await plan.deleteOne();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan deleted",
    data: { id },
  });
});
