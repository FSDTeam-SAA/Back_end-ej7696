import "dotenv/config";
import mongoose from "mongoose";

import { User } from "../model/user.model.js";
import { ReferralRelationship } from "../model/referralRelationship.model.js";
import { ProfessionalPlanPurchase } from "../model/professionalPlanPurchase.model.js";
import { ReferralReward } from "../model/referralReward.model.js";

const getArgValue = (prefix) => {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match ? match.slice(prefix.length + 1).trim() : "";
};

const normalize = (value) => value?.toString().trim() || "";

const run = async () => {
  if (!process.env.MONGO_DB_URL) {
    throw new Error("MONGO_DB_URL is not configured");
  }

  const referralCode = normalize(getArgValue("--referralCode")).toUpperCase();
  const referredEmail = normalize(getArgValue("--referredEmail")).toLowerCase();

  if (!referralCode && !referredEmail) {
    throw new Error("Provide --referralCode=... or --referredEmail=...");
  }

  await mongoose.connect(process.env.MONGO_DB_URL);

  const inviter = referralCode
    ? await User.findOne({ referralCode }).select("_id name email referralCode")
    : null;

  const referredUser = referredEmail
    ? await User.findOne({ email: referredEmail }).select(
        "_id name email referredBy referredByCode referredAt subscriptionTier"
      )
    : null;

  const relationshipQuery = {};
  if (inviter?._id) {
    relationshipQuery.referrerUserId = inviter._id;
  }
  if (referredUser?._id) {
    relationshipQuery.referredUserId = referredUser._id;
  }

  const relationships = Object.keys(relationshipQuery).length
    ? await ReferralRelationship.find(relationshipQuery)
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const relationshipIds = relationships.map((item) => item._id);
  const referredUserIds = [
    ...new Set(
      relationships
        .map((item) => item.referredUserId?.toString())
        .filter(Boolean)
    ),
  ];

  const planPurchases = referredUserIds.length
    ? await ProfessionalPlanPurchase.find({
        userId: { $in: referredUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];

  const rewards = relationshipIds.length
    ? await ReferralReward.find({
        $or: [
          { relationshipId: { $in: relationshipIds } },
          { planPurchaseId: { $in: planPurchases.map((item) => item._id) } },
        ],
      })
        .sort({ createdAt: -1 })
        .lean()
    : [];

  console.log(
    JSON.stringify(
      {
        inviter,
        referredUser,
        relationships,
        planPurchases: planPurchases.map((item) => ({
          _id: item._id,
          userId: item.userId,
          status: item.status,
          referralDiscountAmount: item.referralDiscountAmount,
          referralDiscountRate: item.referralDiscountRate,
          referralCodeApplied: item.referralCodeApplied,
          referralRelationshipId: item.referralRelationshipId,
          totalAmount: item.totalAmount,
          createdAt: item.createdAt,
          purchasedAt: item.purchasedAt,
        })),
        rewards: rewards.map((item) => ({
          _id: item._id,
          relationshipId: item.relationshipId,
          planPurchaseId: item.planPurchaseId,
          status: item.status,
          commissionAmount: item.commissionAmount,
          remainingAmount: item.remainingAmount,
          createdAt: item.createdAt,
        })),
      },
      null,
      2
    )
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
