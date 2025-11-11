import express from "express";
import cors from "cors";
import { getUTXOs } from "./db";

const app = express();

app.use(cors());

app.get("/api/utxos/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const utxos = await getUTXOs(address);

    if (!utxos || utxos.length === 0) {
      res.status(404).json({ error: "No UTXOs found for this address" });
      return;
    }

    const utxosResponse = utxos.map((utxo) => {
      return {
        value: utxo.value,
        txid: utxo.id.split(":")[0],
        vout: parseInt(utxo.id.split(":")[1]),
        address: utxo.address,
        blockHeight: utxo.blockHeight,
      };
    });

    return res.json(utxosResponse);
  } catch (error) {
    console.error("Error getting UTXOs:", error);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
});

app.listen(3040, () => {
  console.log("Server is running on port 3040");
});
