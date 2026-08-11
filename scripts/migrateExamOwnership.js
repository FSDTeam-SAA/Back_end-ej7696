import dotenv from "dotenv";
import mongoose from "mongoose";
import { ExamAccess } from "../model/examAccess.model.js";

dotenv.config();

if (!process.env.MONGO_DB_URL) {
  throw new Error("MONGO_DB_URL is not configured");
}

await mongoose.connect(process.env.MONGO_DB_URL);

try {
  const result = await ExamAccess.updateMany(
    {
      status: "unlocked",
      purchaseType: { $in: ["exam", "manual"] },
    },
    {
      $set: {
        accessDuration: "lifetime",
        expiresAt: null,
      },
    }
  );

  console.log(
    `Exam ownership migration complete: matched=${result.matchedCount} modified=${result.modifiedCount}`
  );
} finally {
  await mongoose.disconnect();
}
