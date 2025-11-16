import {
  batchDeleteSpentUTXOs,
  deleteMempoolUTXOs,
  getIndexingCheckpoint,
  markUTXOsAsConfirmed,
  saveUTXOs,
  updateIndexingCheckpoint,
} from "./db";
import { logger } from "./logger";
import { getBlock, getlatestBlock, getTransaction } from "./rpc";
import "./server";

//define the start height
const START_HEIGHT = parseInt(process.env.START_HEIGHT || "3131019");
const BATCH_SIZE = 10; // Process 10 blocks in parallel

const indexUTXOs = async (blockHeight: number) => {
  const block = await getBlock(blockHeight);

  if (!block.result) throw new Error("Failed to fetch block");

  const { result: blockData } = block;

  //array of transactions in the block
  const txs = blockData.tx;

  const inputs: any[] = [];
  const outputs: any[] = [];

  for (const [index, tx] of txs.entries()) {
    const txData = await getTransaction(tx);

    // For non-coinbase transactions, process inputs (spent UTXOs)
    // Coinbase transactions (index 0) don't have valid inputs to spend
    if (index !== 0 && txData.vin && txData.vin.length > 0) {
      inputs.push(
        ...txData.vin
          .filter((input: any) => input.txid && input.vout !== undefined) // Filter out coinbase inputs
          .map((input: any) => {
            return {
              value: input.valueSat,
              id: `${input.txid}:${input.vout}`,
              address: input.address,
            };
          })
      );
    }

    // Process outputs for ALL transactions including coinbase
    // These are the new UTXOs being created
    outputs.push(
      ...txData.vout
        .map((output: any) => {
          if (!output.scriptPubKey?.addresses) {
            return null;
          }
          return {
            value: output.valueSat,
            address: output.scriptPubKey?.addresses[0],
            id: `${tx}:${output.n}`,
            blockHeight: blockHeight,
            confirmed: true, // Block UTXOs are confirmed
          };
        })
        .filter((output: any) => output !== null)
    );
  }

  // First, try to mark any existing mempool UTXOs as confirmed
  if (outputs.length > 0) {
    const outputIds = outputs.map((output) => output.id);
    const confirmedCount = await markUTXOsAsConfirmed(outputIds, blockHeight);
    if (confirmedCount > 0) {
      console.log(`Marked ${confirmedCount} mempool UTXOs as confirmed`);
    }

    // Then save the UTXOs (will skip duplicates that were just confirmed)
    logger(`saving ${outputs.length} utxos`);
    await saveUTXOs(outputs);
  }

  if (inputs.length > 0) {
    console.log(`Cleaning up ${inputs.length} spent utxos`);
    const inputIds = inputs.map((input) => input.id);

    // Delete mempool UTXOs that are being spent
    const mempoolDeleted = await deleteMempoolUTXOs(inputIds);
    if (mempoolDeleted > 0) {
      console.log(`Deleted ${mempoolDeleted} spent mempool UTXOs`);
    }

    // Delete confirmed UTXOs that are being spent
    const deletedCount = await batchDeleteSpentUTXOs(inputIds);
    console.log(`Deleted ${deletedCount} spent confirmed UTXOs`);
  }
};

const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

let currentBlockHeight = 0;
let latestBlockHeight = 0;

const getIndexingHeight = async () => {
  const checkpoint = await getIndexingCheckpoint();

  if (checkpoint) {
    return checkpoint;
  }
  return START_HEIGHT;
};

const initialize = async () => {
  const latestBlock = await getlatestBlock();

  if (!latestBlock.result) throw new Error("Failed to fetch latest block");

  latestBlockHeight = latestBlock.result;

  if (currentBlockHeight === 0) {
    const checkpoint = await getIndexingHeight();
    logger(`Starting to index utxos for Zcash from block ${checkpoint}`);
    currentBlockHeight = checkpoint;
  }
};

let isIndexing = true;

const startIndexing = async () => {
  if (currentBlockHeight === 0) {
    logger("Indexer loaded successfully, starting indexing job...");
  }

  await initialize();

  while (latestBlockHeight > currentBlockHeight && isIndexing) {
    // Calculate how many blocks to process in this batch
    const remainingBlocks = latestBlockHeight - currentBlockHeight;
    const batchSize = Math.min(BATCH_SIZE, remainingBlocks);

    // Create array of block heights to process
    const blockHeights = Array.from(
      { length: batchSize },
      (_, i) => currentBlockHeight + i
    );

    logger(
      `Processing batch of ${batchSize} blocks: ${blockHeights[0]} to ${
        blockHeights[batchSize - 1]
      }`
    );

    try {
      // Process blocks sequentially to avoid race conditions
      // (UTXOs created in block N might be spent in block N+1)
      for (const height of blockHeights) {
        logger(`Indexing block ${height}`);
        await indexUTXOs(height);
        logger(`Successfully indexed block ${height}`);
      }

      // Update current block height after successful batch processing
      currentBlockHeight += batchSize;

      // Update the checkpoint after the entire batch is processed
      await updateIndexingCheckpoint(currentBlockHeight);
      logger(`Batch complete. Updated checkpoint to ${currentBlockHeight}`);

      await sleep(1000);
    } catch (error) {
      logger(
        `Error processing batch starting at block ${currentBlockHeight}: ${error}`
      );
      throw error;
    }
  }

  if (!isIndexing) {
    logger("Indexing job stopped, exiting...");
    process.exit(0);
  }

  logger("Waiting for 10 seconds before refetching the latest block...");
  await sleep(10 * 1000); //wait for 10 seconds before restarting the indexing
  await startIndexing(); //restart the indexing
};

startIndexing().catch((error) => {
  logger(`Error starting indexing: ${error}`);
  process.exit(1);
});

//handle SIGINT and SIGTERM

process.on("SIGINT", () => {
  logger("SIGINT received, stopping indexing job...");
  isIndexing = false;
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger("SIGTERM received, stopping indexing job...");
  isIndexing = false;
  process.exit(0);
});
