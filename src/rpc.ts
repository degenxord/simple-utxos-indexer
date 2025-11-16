import axios from "axios";
import { logger } from "./logger";
import dotenv from "dotenv";

dotenv.config();

const rpcUrl = process.env.ZCASH_RPC_URL!;

//fetch the block from the rpc
export const getBlock = async (blockHeight: number): Promise<any> => {
  try {
    const query = {
      id: 1,
      method: "getblock",
      params: [blockHeight.toString()],
    };
    const response = await axios.post(rpcUrl, query);
    return response.data;
  } catch (error) {
    logger(`Error fetching block ${blockHeight}, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return await getBlock(blockHeight);
  }
};

//fetch the latest block from the rpc
export const getlatestBlock = async (): Promise<any> => {
  try {
    const query = {
      id: 1,
      method: "getblockcount",
      params: [],
    };
    const response = await axios.post(rpcUrl, query);
    return response.data;
  } catch (error) {
    logger(`Error fetching latest block, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return await getlatestBlock();
  }
};

export const getTransaction = async (txId: string): Promise<any> => {
  try {
    const query = {
      id: 1,
      method: "getrawtransaction",
      params: [txId, 1],
    };
    const response = await axios.post(rpcUrl, query);
    return response.data.result;
  } catch (error) {
    logger(`Error fetching transaction ${txId}, retrying...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return await getTransaction(txId);
  }
};

export const sendTransaction = async (transaction: string) => {
  try {
    const query = {
      id: 1,
      method: "sendrawtransaction",
      params: [transaction],
    };
    const response = await axios.post(rpcUrl, query);
    if (response.data.result) {
      return response.data.result;
    }
    return response.data.error;
  } catch (error) {
    const errorMessage = (error as Error).message;
    throw errorMessage;
    logger(`Error sending transaction, retrying...`);
  }
};
