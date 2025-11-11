## Zcash UTXOs Indexer

A simple TypeScript service that indexes Zcash transparent UTXOs from certain block height into MongoDB and exposes a minimal HTTP API to query UTXOs by address.

### Features

- Indexes blocks starting from a predefined height and keeps up with the chain
- Stores UTXOs in MongoDB with basic indexes
- Exposes `GET /api/utxos/:address` to fetch UTXOs

### Prerequisites

- Node.js 18+
- MongoDB (local or remote)
- A Zcash node RPC endpoint (JSON-RPC)

### Quick Start

1. Install dependencies (also add TypeScript tooling for the start script):

```bash
npm install
npm install -D ts-node typescript
```

2. Create a `.env` file in the project root:

```bash
# MongoDB connection string
MONGO_URI=mongodb://localhost:27017

# Zcash JSON-RPC endpoint (replace user:pass/host/port as appropriate)
ZCASH_RPC_URL=http://user:pass@127.0.0.1:8232
```

3. Start the indexer and API server:

```bash
npm start
```

This will:

- Start indexing UTXOs from a configured start height
- Run an HTTP server on port 3040

### API

- GET `/api/utxos/:address`
  - Returns an array of UTXOs for the given transparent address
  - Response fields: `value`, `txid`, `vout`, `address`, `blockHeight`

Example:

```bash
curl http://localhost:3040/api/utxos/t1ExampleZcashAddress...
```

### Configuration Notes

- Start height: hardcoded in `src/index.ts` (`START_HEIGHT`) and advanced automatically using a MongoDB checkpoint.
- Database: uses database `utxo-indexer` with collections `utxos` and `indexing_checkpoint`.
- Ports: HTTP server listens on `3040`.

### Project Scripts

- `npm run build` — Build the Indexer in ./dist
- `npm start` - Will Start Indexer to Sync Block

### License

ISC
