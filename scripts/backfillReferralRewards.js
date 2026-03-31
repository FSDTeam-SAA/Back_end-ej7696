import "dotenv/config";
import mongoose from "mongoose";

import { ProfessionalPlanPurchase } from "../model/professionalPlanPurchase.model.js";
import { ReferralRelationship } from "../model/referralRelationship.model.js";
import { ReferralReward } from "../model/referralReward.model.js";
import {
  REFERRAL_DISCOUNT_RATE,
  createPendingReferralReward,
} from "../utils/referral.service.js";

const normalizeId = (value) => value?.toString().trim() || "";

const getArgValue = (prefix) => {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match ? match.slice(prefix.length + 1).trim() : "";
};

const hasFlag = (flag) => process.argv.includes(flag);

const resolveRelationshipForPurchase = async (purchase) => {
  if (purchase.referralRelationshipId) {
    return ReferralRelationship.findById(purchase.referralRelationshipId);
  }

  return ReferralRelationship.findOne({
    referredUserId: purchase.userId,
    status: "active",
  });
};

const run = async () => {
  if (!process.env.MONGO_DB_URL) {
    throw new Error("MONGO_DB_URL is not configured");
  }

  const relationshipIdFilter = normalizeId(getArgValue("--relationshipId"));
  const userIdFilter = normalizeId(getArgValue("--userId"));
  const dryRun = hasFlag("--dry-run");

  await mongoose.connect(process.env.MONGO_DB_URL);

  const purchaseFilter = {
    status: "completed",
    referralDiscountAmount: { $gt: 0 },
  };

  if (userIdFilter) {
    purchaseFilter.userId = new mongoose.Types.ObjectId(userIdFilter);
  }

  if (relationshipIdFilter) {
    purchaseFilter.referralRelationshipId = new mongoose.Types.ObjectId(
      relationshipIdFilter
    );
  }

  const purchases = await ProfessionalPlanPurchase.find(purchaseFilter)
    .sort({ purchasedAt: 1, createdAt: 1 })
    .lean();

  let inspected = 0;
  let created = 0;
  let existing = 0;
  let skipped = 0;
  let repairedRelationships = 0;

  for (const purchase of purchases) {
    inspected += 1;

    const relationship = await resolveRelationshipForPurchase(purchase);
    if (!relationship || relationship.status !== "active") {
      skipped += 1;
      continue;
    }

    const needsPurchaseRepair =
      normalizeId(purchase.referralRelationshipId) !==
        normalizeId(relationship._id) ||
      !normalizeId(purchase.referralCodeApplied);

    const rewardBefore = await ReferralReward.findOne({
      planPurchaseId: purchase._id,
    });

    if (rewardBefore) {
      existing += 1;
      if (needsPurchaseRepair && !dryRun) {
        await ProfessionalPlanPurchase.updateOne(
          { _id: purchase._id },
          {
            $set: {
              referralRelationshipId: relationship._id,
              referralCodeApplied: relationship.referralCode || "",
            },
          }
        );
      }
      if (!relationship.upgradedAt && !dryRun) {
        relationship.upgradedAt =
          purchase.purchasedAt || rewardBefore.createdAt || new Date();
        await relationship.save();
        repairedRelationships += 1;
      }
      continue;
    }

    if (dryRun) {
      created += 1;
      continue;
    }

    if (needsPurchaseRepair) {
      await ProfessionalPlanPurchase.updateOne(
        { _id: purchase._id },
        {
          $set: {
            referralRelationshipId: relationship._id,
            referralCodeApplied: relationship.referralCode || "",
          },
        }
      );
    }

    const reward = await createPendingReferralReward({
      relationship,
      planPurchase: purchase,
      commissionAmount: purchase.referralDiscountAmount,
      commissionRate:
        purchase.referralDiscountRate || REFERRAL_DISCOUNT_RATE,
      currency: purchase.currency || "USD",
      metadata: {
        source: "referral_reward_backfill",
      },
    });

    if (!reward) {
      skipped += 1;
      continue;
    }

    created += 1;

    if (!relationship.upgradedAt) {
      relationship.upgradedAt =
        purchase.purchasedAt || reward.createdAt || new Date();
      await relationship.save();
      repairedRelationships += 1;
    }
  }

  console.log(
    [
      "Referral reward backfill complete.",
      `Inspected purchases: ${inspected}`,
      `Created rewards: ${created}`,
      `Already had rewards: ${existing}`,
      `Skipped purchases: ${skipped}`,
      `Updated relationships: ${repairedRelationships}`,
      dryRun ? "Dry run only. No database writes were made." : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error(disconnectError);
  }
  process.exit(1);
});
