import { Db, MongoClient, ObjectId } from "mongodb";
import { UTXO } from "./types";
import dotenv from "dotenv";

dotenv.config();

let db: Db | null = null;
let indexesCreated = false;

const getDB = async () => {
  try {
    if (db) return db;
    const client = await MongoClient.connect(process.env.MONGO_URI!);
    db = client.db("utxo-indexer");

    // Create indexes only once on first connection
    if (!indexesCreated) {
      await ensureIndexes();
      indexesCreated = true;
    }

    return db;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
};

const ensureIndexes = async () => {
  try {
    if (!db) return;

    const collection = db.collection<UTXO>("utxos");

    // Check if collection exists by listing collections
    const collections = await db.listCollections({ name: "utxos" }).toArray();
    const collectionExists = collections.length > 0;

    let existingIndexes: any[] = [];
    let indexNames: string[] = [];

    // Only get existing indexes if collection exists
    if (collectionExists) {
      existingIndexes = await collection.indexes();
      indexNames = existingIndexes.map((idx) => idx.name);
    }

    // Create index on 'id' field (unique) for fast lookups and deletes
    if (!indexNames.includes("id_1")) {
      try {
        // First, remove duplicates if any exist (only if collection exists)
        if (collectionExists) {
          const pipeline = [
            {
              $group: {
                _id: "$id",
                count: { $sum: 1 },
                docs: { $push: "$_id" },
              },
            },
            {
              $match: {
                count: { $gt: 1 },
              },
            },
          ];

          const duplicates = await collection.aggregate(pipeline).toArray();

          if (duplicates.length > 0) {
            console.log(
              `Found ${duplicates.length} duplicate UTXO groups, cleaning up...`
            );

            for (const dup of duplicates) {
              // Keep the first document, delete the rest
              const docsToDelete = (dup.docs as any[]).slice(1);
              await collection.deleteMany({ _id: { $in: docsToDelete } });
            }

            console.log(`Removed duplicate UTXOs`);
          }
        }

        await collection.createIndex({ id: 1 }, { unique: true });
        console.log("Created unique index on 'id' field");
      } catch (indexError: any) {
        if (indexError.code === 11000) {
          console.error(
            "Still have duplicates after cleanup. Please manually clean the database."
          );
        }
        throw indexError;
      }
    }

    // Create index on 'address' field for fast queries by address
    if (!indexNames.includes("address_1")) {
      await collection.createIndex({ address: 1 });
      console.log("Created index on 'address' field");
    }
  } catch (error) {
    console.error("Error creating indexes:", error);
    throw error;
  }
};

export const saveUTXOs = async (utxos: UTXO[]) => {
  try {
    const db = await getDB();
    // Use ordered: false to continue inserting even if some documents fail due to duplicates
    await db.collection<UTXO>("utxos").insertMany(utxos, { ordered: false });
  } catch (error: any) {
    // If it's a duplicate key error (code 11000), only log a warning for the duplicates
    // but don't throw - some inserts may have succeeded
    if (error.code === 11000) {
      const insertedCount = error.result?.nInserted || 0;
      const duplicateCount = utxos.length - insertedCount;
      if (duplicateCount > 0) {
        console.warn(
          `Skipped ${duplicateCount} duplicate UTXOs, inserted ${insertedCount}`
        );
      }
      return; // Don't throw, continue execution
    }
    console.error("Error saving UTXOs:", error);
    throw error;
  }
};

export const saveMempoolUTXOs = async (utxos: UTXO[]) => {
  try {
    if (utxos.length === 0) return;
    const db = await getDB();

    // For mempool UTXOs, we want to insert only if they don't already exist
    // Use bulkWrite with upsert to handle this efficiently
    const operations = utxos.map((utxo) => ({
      updateOne: {
        filter: { id: utxo.id },
        update: { $setOnInsert: utxo },
        upsert: true,
      },
    }));

    const result = await db.collection<UTXO>("utxos").bulkWrite(operations, {
      ordered: false,
    });

    console.log(
      `Mempool: ${result.upsertedCount} new UTXOs added, ${result.matchedCount} already exist`
    );
  } catch (error: any) {
    console.error("Error saving mempool UTXOs:", error);
    throw error;
  }
};

export const markUTXOsAsConfirmed = async (
  utxoIds: string[],
  blockHeight: number
) => {
  try {
    if (utxoIds.length === 0) return 0;
    const db = await getDB();

    const result = await db
      .collection<UTXO>("utxos")
      .updateMany(
        { id: { $in: utxoIds }, confirmed: false },
        { $set: { confirmed: true, blockHeight: blockHeight } }
      );

    return result.modifiedCount;
  } catch (error) {
    console.error("Error marking UTXOs as confirmed:", error);
    throw error;
  }
};

export const deleteMempoolUTXOs = async (utxoIds: string[]) => {
  try {
    if (utxoIds.length === 0) return 0;
    const db = await getDB();

    // Delete unconfirmed UTXOs that are being spent
    const result = await db.collection<UTXO>("utxos").deleteMany({
      id: { $in: utxoIds },
      confirmed: false,
    });

    return result.deletedCount;
  } catch (error) {
    console.error("Error deleting mempool UTXOs:", error);
    throw error;
  }
};

export const getUTXOs = async (address: string) => {
  try {
    const db = await getDB();
    const utxos = await db
      .collection<UTXO>("utxos")
      .find({ address })
      .toArray();
    return utxos;
  } catch (error) {
    console.error("Error getting UTXOs:", error);
    throw error;
  }
};

export const deleteSpentUTXOs = async (id: string) => {
  try {
    const db = await getDB();
    const deleted = (await db.collection<UTXO>("utxos").deleteOne({ id: id }))
      .acknowledged;
    return deleted;
  } catch (error) {
    console.error("Error deleting spent UTXO:", error);
    throw error;
  }
};

export const batchDeleteSpentUTXOs = async (ids: string[]) => {
  try {
    if (ids.length === 0) return 0;
    const db = await getDB();
    const result = await db
      .collection<UTXO>("utxos")
      .deleteMany({ id: { $in: ids } });
    return result.deletedCount;
  } catch (error) {
    console.error("Error batch deleting spent UTXOs:", error);
    throw error;
  }
};
export const updateIndexingCheckpoint = async (blockHeight: number) => {
  try {
    const db = await getDB();
    await db
      .collection<{ blockHeight: number }>("indexing_checkpoint")
      .updateOne(
        { id: "current_indexing_checkpoint" },
        { $set: { blockHeight } },
        { upsert: true }
      );
  } catch (error) {
    console.error("Error updating indexing checkpoint:", error);
    throw error;
  }
};

export const getIndexingCheckpoint = async () => {
  try {
    const db = await getDB();
    const checkpoint = await db
      .collection<{ blockHeight: number }>("indexing_checkpoint")
      .findOne({ id: "current_indexing_checkpoint" });
    return checkpoint?.blockHeight || 0;
  } catch (error) {
    console.error("Error getting indexing checkpoint:", error);
    throw error;
  }
};
