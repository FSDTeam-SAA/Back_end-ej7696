import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";
import { User } from "../model/user.model.js";

const normalizeCode = (value) => value?.toString().trim().toUpperCase() || "";

const generateCode = () => `IP${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const getUniqueCode = async () => {
  for (let i = 0; i < 50; i += 1) {
    const candidate = generateCode();
    const exists = await User.exists({ referralCode: candidate });
    if (!exists) return candidate;
  }
  throw new Error("Failed to generate unique referral code");
};

const run = async () => {
  if (!process.env.MONGO_DB_URL) {
    throw new Error("MONGO_DB_URL is not configured");
  }

  await mongoose.connect(process.env.MONGO_DB_URL);

  const users = await User.find().select("referralCode");
  const seen = new Set();
  let changed = 0;

  for (const user of users) {
    const normalized = normalizeCode(user.referralCode);

    if (!normalized || seen.has(normalized)) {
      user.referralCode = await getUniqueCode();
      await user.save();
      changed += 1;
      continue;
    }

    if (normalized !== user.referralCode) {
      user.referralCode = normalized;
      await user.save();
      changed += 1;
    }

    seen.add(user.referralCode);
  }

  console.log(`Backfill complete. Updated users: ${changed}`);
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
