export type UTXO = {
  value: number;
  id: string;
  address: string;
  blockHeight: number;
  confirmed: boolean; // true for confirmed blocks, false for mempool
};
