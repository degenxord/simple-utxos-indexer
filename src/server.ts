import express from "express";
import cors from "cors";
import { getUTXOs } from "./db";
import { rateLimit } from "express-rate-limit";

const app = express();

// If behind a reverse proxy like nginx, make sure to let Express trust the proxy headers
// This MUST be set before any middleware that uses IP addresses
app.set("trust proxy", 1);

// Proper rate limit middleware to avoid issues behind proxies (like Nginx)
const limiter = rateLimit({
  windowMs: 1 * 1000, // 1 second window
  max: 100000, // Limit to 100000 requests per window per IP
  standardHeaders: true, // Send standardized rate limit info in headers
  legacyHeaders: false, // Disable old X-RateLimit-* headers
  validate: false, // Disable strict validation for proxy headers
});

app.use(limiter);

app.use(cors({ origin: "*" }));

app.get("/:address", async (req, res) => {
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
