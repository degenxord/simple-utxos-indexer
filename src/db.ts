import { Db, MongoClient, ObjectId } from "mongodb";
import { UTXO } from "./types";
import dotenv from "dotenv";

dotenv.config();

let db: Db | null = null;

const getDB = async () => {
  try {
    if (db) return db;
    const client = await MongoClient.connect(process.env.MONGO_URI!);
    db = client.db("utxo-indexer");
    return db;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
};

export const saveUTXOs = async (utxos: UTXO[]) => {
  try {
    const db = await getDB();
    await db.collection<UTXO>("utxos").insertMany(utxos);

    if (!db.collection<UTXO>("utxos").indexExists(["id", "address"])) {
      await db
        .collection<UTXO>("utxos")
        .createIndex({ id: 1 }, { unique: true });

      await db
        .collection<UTXO>("utxos")
        .createIndex({ address: 1 }, { unique: false });
    }
  } catch (error) {
    console.error("Error saving UTXOs:", error);
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
    const deleted = (await db.collection<UTXO>("utxos").deleteOne({ id }))
      .acknowledged;

    return deleted;
  } catch (error) {
    console.error("Error deleting spent UTXOs:", error);
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
