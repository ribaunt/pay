export type RpcResponse<T> = {
  id: string;
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
};

export type AddressResult = {
  address: string;
  info: string;
  addresses: Array<{ address: string; label: string; address_index: number; used: boolean }>;
};

export type BalanceResult = {
  balance: number;
  unlocked_balance: number;
  blocks_to_unlock: number;
  time_to_unlock: number;
  multisig_import_needed: boolean;
};

export type TransferResult = {
  tx_hash: string;
  fee: number;
  tx_key?: string;
  amount?: number;
};

export type MakeUriResult = {
  uri: string;
};

export type CreateAddressResult = {
  address: string;
  address_index: number;
  address_indices: number[];
  addresses: string[];
};

export type GenerateFromKeysResult = Record<string, never>;

export type TransferEntry = {
  txid: string;
  payment_id: string;
  type: string;
  amount: number;
  block_height?: number;
  height?: number;
  timestamp: number;
  address?: string;
  unlock_time?: number;
  fee?: number;
  destinations?: Array<{ address: string; amount: number }>;
};

export type GetTransfersResult = {
  in?: TransferEntry[];
  out?: TransferEntry[];
  pending?: TransferEntry[];
  failed?: TransferEntry[];
  pool?: TransferEntry[];
};

export type TxProofResult = {
  signature: string;
};

export type CheckTxProofResult = {
  confirmations: number;
  good: boolean;
  in_pool: boolean;
  received: number;
};
