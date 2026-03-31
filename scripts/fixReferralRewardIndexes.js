import "dotenv/config";
import mongoose from "mongoose";

const collectionName = "referralrewards";

const optionalIdFields = [
  "planPurchaseId",
  "resourcePurchaseId",
  "examAccessId",
  "signupRelationshipId",
];

const recreateIndex = async (collection, fieldName) => {
  const indexName = `${fieldName}_1`;

  try {
    await collection.dropIndex(indexName);
  } catch (error) {
    if (error?.codeName !== "IndexNotFound") {
      throw error;
    }
  }

  await collection.createIndex(
    { [fieldName]: 1 },
    {
      name: indexName,
      unique: true,
      partialFilterExpression: {
        [fieldName]: { $exists: true, $type: "objectId" },
      },
    }
  );
};

const run = async () => {
  if (!process.env.MONGO_DB_URL) {
    throw new Error("MONGO_DB_URL is not configured");
  }

  await mongoose.connect(process.env.MONGO_DB_URL);
  const collection = mongoose.connection.db.collection(collectionName);

  for (const fieldName of optionalIdFields) {
    await collection.updateMany(
      { [fieldName]: null },
      { $unset: { [fieldName]: "" } }
    );
  }

  for (const fieldName of optionalIdFields) {
    await recreateIndex(collection, fieldName);
  }

  console.log(
    `Referral reward indexes repaired for collection "${collectionName}".`
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
