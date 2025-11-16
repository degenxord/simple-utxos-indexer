import {
  batchDeleteSpentUTXOs,
  deleteMempoolUTXOs,
  saveMempoolUTXOs,
} from "./db";
import { getRawMemPool, getTransaction } from "./rpc";

// Track processed transactions to avoid re-processing
const processedTxs = new Set<string>();

const extractMempoolUTXOs = async (txId: string) => {
  try {
    const txData = await getTransaction(txId);

    const outputs: any[] = [];
    const inputs: any[] = [];

    // Extract inputs (UTXOs being spent)
    if (txData.vin && txData.vin.length > 0) {
      inputs.push(
        ...txData.vin
          .filter((input: any) => input.txid && input.vout !== undefined) // Filter out coinbase
          .map((input: any) => ({
            id: `${input.txid}:${input.vout}`,
          }))
      );
    }

    // Extract outputs (new unconfirmed UTXOs)
    if (txData.vout && txData.vout.length > 0) {
      outputs.push(
        ...txData.vout
          .map((output: any) => {
            if (!output.scriptPubKey?.addresses) {
              return null;
            }
            return {
              value: output.valueSat,
              address: output.scriptPubKey?.addresses[0],
              id: `${txId}:${output.n}`,
              blockHeight: 0, // Mempool transactions don't have a block height yet
              confirmed: false, // Mark as unconfirmed
            };
          })
          .filter((output: any) => output !== null)
      );
    }

    return { outputs, inputs };
  } catch (error) {
    console.error(`Error extracting mempool UTXOs for tx ${txId}:`, error);
    return { outputs: [], inputs: [] };
  }
};

const mempoolScanner = async () => {
  console.log("Mempool scanner started");

  while (true) {
    try {
      const memPool = await getRawMemPool();

      // Remove transactions that are no longer in mempool
      const currentMempoolSet = new Set(memPool);
      const removedTxs = Array.from(processedTxs).filter(
        (tx) => !currentMempoolSet.has(tx)
      );

      if (removedTxs.length > 0) {
        console.log(
          `${removedTxs.length} transactions left mempool (likely confirmed)`
        );
        removedTxs.forEach((tx) => processedTxs.delete(tx));
      }

      // Process new transactions
      const newTxs = memPool.filter((tx: string) => !processedTxs.has(tx));

      if (newTxs.length > 0) {
        console.log(`Processing ${newTxs.length} new mempool transactions`);

        for (const txId of newTxs) {
          const { outputs, inputs } = await extractMempoolUTXOs(txId);

          // Save new unconfirmed UTXOs
          if (outputs.length > 0) {
            await saveMempoolUTXOs(outputs);
          }

          // Delete ALL UTXOs (confirmed + mempool) that are being spent by this transaction
          // Once a UTXO is used as input in mempool, it cannot be used again (double-spend protection)
          if (inputs.length > 0) {
            const inputIds = inputs.map((input) => input.id);

            // Delete unconfirmed (mempool) UTXOs
            const mempoolDeleted = await deleteMempoolUTXOs(inputIds);

            // Delete confirmed UTXOs
            const confirmedDeleted = await batchDeleteSpentUTXOs(inputIds);

            const totalDeleted = mempoolDeleted + confirmedDeleted;
            if (totalDeleted > 0) {
              console.log(
                `Tx ${txId}: Deleted ${totalDeleted} spent UTXOs (${confirmedDeleted} confirmed, ${mempoolDeleted} mempool)`
              );
            }
          }

          // Mark transaction as processed
          processedTxs.add(txId);
        }
      }

      // Wait 5 seconds before next scan
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error("Error in mempool scanner:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

mempoolScanner().catch((error) => {
  console.error("Mempool scanner crashed:", error);
  process.exit(1);
});
