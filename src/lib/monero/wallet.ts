import { createHash } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { SINGLE_USER_ID } from "@/lib/auth";
import { getMoneroNetwork } from "./network";
import { encryptSecret, VIEW_KEY_PURPOSE } from "@/lib/crypto";
import {
  requireMoneroAddress,
  requireViewKey,
  requireTxHash,
  requireSignature,
  optionalLabel,
  optionalMessage,
  optionalRestoreHeight,
} from "@/lib/validation";
import { MoneroRpcError, walletRpc } from "./rpc";
import { atomicToRpcNumber, atomicToXmr, xmrToAtomic } from "./money";
import type {
  AddressResult,
  BalanceResult,
  CreateAddressResult,
  GetTransfersResult,
  MakeUriResult,
  TransferEntry,
  TransferResult,
  TxProofResult,
  CheckTxProofResult,
} from "./types";

const WALLET_PASSWORD = process.env.MONERO_WALLET_PASSWORD ?? "pay";

/**
 * monero-wallet-rpc serves a single open wallet at a time. Serialize open/close
 * transitions and track which file is loaded so switching users is safe.
 */
let openLock: Promise<void> | null = null;
let openWalletFile: string | null = null;

async function getWalletConfig(userId: string) {
  return prisma.wallet.findUnique({ where: { userId } });
}

async function doEnsureOpen(userId: string): Promise<void> {
  const config = await getWalletConfig(userId);
  if (!config?.walletFile) {
    throw new Error("No wallet configured for this user. Complete setup first.");
  }

  if (openWalletFile === config.walletFile) {
    // Verifying with get_address here makes a busy wallet RPC close and reopen
    // the wallet on every transient timeout, which stalls all other calls.
    return;
  }

  try {
    await walletRpc("close_wallet");
  } catch {
    // Nothing was loaded.
  }

  try {
    await walletRpc("open_wallet", {
      filename: config.walletFile,
      password: WALLET_PASSWORD,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      throw new MoneroRpcError(
        "Wallet file exists but MONERO_WALLET_PASSWORD did not match it",
        (error as MoneroRpcError).code
      );
    }
    throw error;
  }

  openWalletFile = config.walletFile;
}

export function ensureWalletOpen(userId: string): Promise<void> {
  if (!openLock) {
    openLock = doEnsureOpen(userId).finally(() => {
      openLock = null;
    });
  }
  return openLock;
}

export type WalletInfo = {
  name: string;
  address: string;
  balanceXmr: string;
  balanceAtomic: string;
  unlockedBalanceXmr: string;
  unlockedBalanceAtomic: string;
  blocksToUnlock: number;
};

export async function getWalletInfo(userId: string): Promise<WalletInfo> {
  await ensureWalletOpen(userId);

  const [addressResult, balance, config] = await Promise.all([
    walletRpc<AddressResult>("get_address", { account_index: 0, address_index: 0 }),
    walletRpc<BalanceResult>("get_balance", { account_index: 0 }),
    getWalletConfig(userId),
  ]);

  return {
    name: config?.walletFile ?? openWalletFile ?? "unknown",
    address: addressResult.address,
    balanceXmr: atomicToXmr(balance.balance),
    balanceAtomic: BigInt(balance.balance).toString(),
    unlockedBalanceXmr: atomicToXmr(balance.unlocked_balance),
    unlockedBalanceAtomic: BigInt(balance.unlocked_balance).toString(),
    blocksToUnlock: balance.blocks_to_unlock,
  };
}

/**
 * Restore a watch-only wallet. Only the private view key and the public spend
 * key embedded in the primary address are used — no spend key is requested.
 * The view key is encrypted before it touches Postgres.
 */
/** Best-effort cleanup of files produced by a rejected keypair. */
async function removeWalletFiles(walletFile: string): Promise<void> {
  const dir = process.env.MONERO_WALLET_DIR ?? "/data/wallets";
  try {
    const files = await readdir(dir);
    await Promise.all(
      files
        .filter((name) => name === walletFile || name.startsWith(`${walletFile}.`))
        .map((name) => unlink(join(dir, name)).catch(() => {}))
    );
  } catch {
    // The wallet directory may be managed elsewhere; cleanup is best effort.
  }
}

export async function setupWatchOnlyWallet(
  userId: string,
  options: {
    address?: unknown;
    viewKey?: unknown;
    restoreHeight?: unknown;
    description?: unknown;
  }
): Promise<WalletInfo> {
  const address = requireMoneroAddress(options.address, "primary address");
  const viewKey = requireViewKey(options.viewKey);
  const restoreHeight = optionalRestoreHeight(options.restoreHeight);
  const description = optionalLabel(options.description);

  let walletFile = `watch-${getMoneroNetwork()}-${createHash("sha256")
    .update(`${userId}:${address}:${viewKey}`)
    .digest("hex")
    .slice(0, 16)}`;

  try {
    await walletRpc("close_wallet");
  } catch {
    // No wallet was open.
  }
  openWalletFile = null;

  const generateArgs = {
    password: WALLET_PASSWORD,
    address,
    viewkey: viewKey,
    restore_height: restoreHeight,
    language: "English",
    autosave_current: true,
  };

  try {
    await walletRpc("generate_from_keys", { filename: walletFile, ...generateArgs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;

    walletFile = `${walletFile}-${Date.now().toString(36)}`;
    await walletRpc("generate_from_keys", { filename: walletFile, ...generateArgs });
  }
  // monero-wallet-rpc only detects a mismatched address/view-key pair when the
  // generated files are reopened. Retry through transient busy/timeout errors
  // so a wallet that starts scanning immediately is not rejected by mistake.
  let validationError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await walletRpc("close_wallet");
      await walletRpc("open_wallet", { filename: walletFile, password: WALLET_PASSWORD });
      validationError = null;
      break;
    } catch (error) {
      validationError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (validationError) {
    const message =
      validationError instanceof Error ? validationError.message : String(validationError);
    if (/correspond|password|keys/i.test(message)) {
      await removeWalletFiles(walletFile);
      openWalletFile = null;
      throw new Error("The address and view key do not correspond to the same wallet");
    }
    // A busy RPC is inconclusive; the already generated wallet is still usable.
  }
  openWalletFile = walletFile;

  const encryptedViewKey = encryptSecret(viewKey, VIEW_KEY_PURPOSE, userId);

  await prisma.wallet.upsert({
    where: { userId },
    update: {
      name: walletFile,
      walletFile,
      address,
      viewKey: encryptedViewKey,
      restoreHeight,
      isWatchOnly: true,
      description,
    },
    create: {
      name: walletFile,
      walletFile,
      address,
      viewKey: encryptedViewKey,
      restoreHeight,
      isWatchOnly: true,
      description,
      userId,
    },
  });

  // A freshly generated wallet has no balance, and querying it while the RPC
  // starts scanning can time out. Return the known values so setup completes.
  return {
    name: walletFile,
    address,
    balanceXmr: "0",
    balanceAtomic: "0",
    unlockedBalanceXmr: "0",
    unlockedBalanceAtomic: "0",
    blocksToUnlock: 0,
  };
}

export type Subaddress = {
  address: string;
  addressIndex: number;
  label?: string;
  used?: boolean;
  lastUsedAt?: Date | null;
};

export async function createSubaddress(
  userId: string,
  label?: string,
  accountIndex = 0
): Promise<Subaddress> {
  await ensureWalletOpen(userId);

  const result = await walletRpc<CreateAddressResult>("create_address", {
    account_index: accountIndex,
    ...(label ? { label } : {}),
  });

  return { address: result.address, addressIndex: result.address_index, label };
}

/** Create a new Monero account (major index) for a store. */
export async function createWalletAccount(label: string): Promise<number> {
  await ensureWalletOpen(SINGLE_USER_ID);
  const result = await walletRpc<{ account_index: number }>("create_account", { label });
  return result.account_index;
}

export async function listSubaddresses(userId: string): Promise<Subaddress[]> {
  await ensureWalletOpen(userId);

  const result = await walletRpc<AddressResult>("get_address", { account_index: 0 });

  return (result.addresses ?? []).map((entry) => ({
    address: entry.address,
    addressIndex: entry.address_index,
    label: entry.label || undefined,
    used: entry.used,
  }));
}

export async function storeSubaddress(userId: string, subaddress: Subaddress) {
  const config = await getWalletConfig(userId);
  if (!config) return null;

  return prisma.subaddress.upsert({
    where: {
      walletId_addressIndex: {
        walletId: config.id,
        addressIndex: subaddress.addressIndex,
      },
    },
    update: { label: subaddress.label, used: subaddress.used ?? false },
    create: {
      walletId: config.id,
      address: subaddress.address,
      addressIndex: subaddress.addressIndex,
      label: subaddress.label,
      used: subaddress.used ?? false,
    },
  });
}

export async function refreshSubaddressUsage(userId: string) {
  const config = await getWalletConfig(userId);
  if (!config) return [];

  const fromRpc = await listSubaddresses(userId);
  for (const entry of fromRpc) {
    const stored = await prisma.subaddress.findUnique({
      where: {
        walletId_addressIndex: {
          walletId: config.id,
          addressIndex: entry.addressIndex,
        },
      },
    });

    await prisma.subaddress.upsert({
      where: {
        walletId_addressIndex: {
          walletId: config.id,
          addressIndex: entry.addressIndex,
        },
      },
      update: {
        used: entry.used ?? false,
        lastUsedAt:
          entry.used && !stored?.used
            ? new Date()
            : entry.used
              ? stored?.lastUsedAt ?? new Date()
              : null,
      },
      create: {
        walletId: config.id,
        address: entry.address,
        addressIndex: entry.addressIndex,
        label: entry.label,
        used: entry.used ?? false,
        lastUsedAt: entry.used ? new Date() : null,
      },
    });
  }

  return prisma.subaddress.findMany({
    where: { walletId: config.id },
    orderBy: { addressIndex: "asc" },
  });
}

export async function markSubaddressUsed(walletId: string, address: string) {
  await prisma.subaddress.updateMany({
    where: { walletId, address, used: false },
    data: { used: true, lastUsedAt: new Date() },
  });
}

export async function createFreshSubaddress(userId: string, label?: string, accountIndex = 0) {
  const subaddress = await createSubaddress(userId, label, accountIndex);
  await storeSubaddress(userId, subaddress);
  return subaddress;
}

export async function getPrimaryAddress(userId: string): Promise<string> {
  await ensureWalletOpen(userId);
  const result = await walletRpc<AddressResult>("get_address", {
    account_index: 0,
    address_index: 0,
  });
  return result.address;
}

export type PaymentRequest = {
  address: string;
  addressIndex: number;
  amountXmr: string;
  amountAtomic: string;
  uri: string;
  label?: string;
};

export async function createPaymentRequestAtomic(
  userId: string,
  atomic: bigint,
  label?: string,
  accountIndex = 0
): Promise<PaymentRequest> {
  await ensureWalletOpen(userId);

  const subaddress = await createFreshSubaddress(userId, label ?? "payment", accountIndex);

  const result = await walletRpc<MakeUriResult>("make_uri", {
    address: subaddress.address,
    amount: atomicToRpcNumber(atomic),
    ...(label ? { tx_description: label } : {}),
  });

  return {
    address: subaddress.address,
    addressIndex: subaddress.addressIndex,
    amountXmr: atomicToXmr(atomic),
    amountAtomic: atomic.toString(),
    uri: result.uri,
    label,
  };
}

export async function createPaymentRequest(
  userId: string,
  amountXmr: string,
  label?: string
): Promise<PaymentRequest> {
  return createPaymentRequestAtomic(userId, xmrToAtomic(amountXmr), label);
}

export async function getWalletHeight(): Promise<number> {
  await ensureWalletOpen(SINGLE_USER_ID);
  const result = await walletRpc<{ height: number }>("get_height");
  return result.height;
}

export type SendPaymentResult = {
  txHash: string;
  feeXmr: string;
  txKey?: string;
};

export async function sendPayment(
  userId: string,
  options: {
    address: string;
    amountXmr: string;
    priority?: number;
    paymentId?: string;
  }
): Promise<SendPaymentResult> {
  const { address, amountXmr, priority = 2, paymentId } = options;
  const destination = requireMoneroAddress(address);

  await ensureWalletOpen(userId);
  const atomic = xmrToAtomic(amountXmr);

  const result = await walletRpc<TransferResult>("transfer", {
    destinations: [{ address: destination, amount: atomicToRpcNumber(atomic) }],
    priority,
    get_tx_key: true,
    ...(paymentId ? { payment_id: paymentId } : {}),
  });

  return {
    txHash: result.tx_hash,
    feeXmr: atomicToXmr(result.fee),
    txKey: result.tx_key,
  };
}

export type NormalizedTransfer = {
  txHash: string;
  type: string;
  amountXmr: string;
  amountAtomic: string;
  feeXmr?: string;
  feeAtomic?: string;
  timestamp: string;
  blockHeight: number;
  address?: string;
  paymentId?: string;
};

function normalizeTransfer(entry: TransferEntry): NormalizedTransfer {
  return {
    txHash: entry.txid,
    type: entry.type,
    amountXmr: atomicToXmr(entry.amount),
    amountAtomic: BigInt(entry.amount).toString(),
    ...(entry.fee !== undefined
      ? { feeXmr: atomicToXmr(entry.fee), feeAtomic: BigInt(entry.fee).toString() }
      : {}),
    timestamp: new Date(entry.timestamp * 1000).toISOString(),
    blockHeight: entry.block_height ?? entry.height ?? 0,
    address: entry.address,
    paymentId: entry.payment_id || undefined,
  };
}

export async function getTransfers(
  userId: string,
  options?: {
    incoming?: boolean;
    outgoing?: boolean;
    pending?: boolean;
    failed?: boolean;
    pool?: boolean;
  }
): Promise<NormalizedTransfer[]> {
  const {
    incoming = true,
    outgoing = true,
    pending = true,
    failed = false,
    pool = false,
  } = options ?? {};

  await ensureWalletOpen(userId);

  const result = await walletRpc<GetTransfersResult>("get_transfers", {
    in: incoming,
    out: outgoing,
    pending,
    failed,
    pool,
    filter_by_height: false,
  });

  return [
    ...(result.in ?? []),
    ...(result.out ?? []),
    ...(result.pending ?? []),
    ...(result.failed ?? []),
    ...(result.pool ?? []),
  ]
    .map(normalizeTransfer)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/**
 * Incremental variant used by settlement. Confirmed transfers are read from
 * `minHeight` onward; pool/pending transfers are always read in full because
 * they have no block height yet.
 */
export async function getTransfersSince(
  userId: string,
  minHeight: number
): Promise<NormalizedTransfer[]> {
  if (minHeight <= 0) return getTransfers(userId, { incoming: true, pool: true });

  await ensureWalletOpen(userId);

  const [confirmed, pending] = await Promise.all([
    walletRpc<GetTransfersResult>("get_transfers", {
      in: true,
      out: false,
      pending: false,
      failed: false,
      pool: false,
      filter_by_height: true,
      min_height: minHeight,
    }),
    walletRpc<GetTransfersResult>("get_transfers", {
      in: false,
      out: false,
      pending: true,
      failed: false,
      pool: true,
      filter_by_height: false,
    }),
  ]);

  const seen = new Set<string>();
  return [...(confirmed.in ?? []), ...(pending.pending ?? []), ...(pending.pool ?? [])]
    .map(normalizeTransfer)
    .filter((transfer) => {
      if (seen.has(transfer.txHash)) return false;
      seen.add(transfer.txHash);
      return true;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export type PaymentProof = {
  txHash: string;
  address: string;
  message: string;
  signature: string;
};

/** Generate a Monero transaction proof from the recipient's watch-only wallet. */
export async function createPaymentProof(
  userId: string,
  options: { txHash?: unknown; address?: unknown; message?: unknown }
): Promise<PaymentProof> {
  const txHash = requireTxHash(options.txHash);
  const address = requireMoneroAddress(options.address);
  const message = optionalMessage(options.message);

  await ensureWalletOpen(userId);

  const result = await walletRpc<TxProofResult>("get_tx_proof", {
    txid: txHash,
    address,
    message,
  });

  const config = await getWalletConfig(userId);
  if (!config) throw new Error("No wallet configured for this user");

  await prisma.paymentProof.upsert({
    where: {
      walletId_txHash_address_message: {
        walletId: config.id,
        txHash,
        address,
        message,
      },
    },
    update: { signature: result.signature },
    create: {
      walletId: config.id,
      txHash,
      address,
      message,
      signature: result.signature,
    },
  });

  return { txHash, address, message, signature: result.signature };
}

export async function listPaymentProofs(userId: string) {
  const config = await getWalletConfig(userId);
  if (!config) return [];

  return prisma.paymentProof.findMany({
    where: { walletId: config.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export type PaymentProofVerification = {
  good: boolean;
  confirmations: number;
  inPool: boolean;
  receivedXmr: string;
  receivedAtomic: string;
};

/**
 * Verify a proof without any account. Any loaded wallet can drive the RPC call;
 * it does not need to be the wallet that generated the proof.
 */
export async function verifyPaymentProof(options: {
  txHash?: unknown;
  address?: unknown;
  message?: unknown;
  signature?: unknown;
}): Promise<PaymentProofVerification> {
  const txHash = requireTxHash(options.txHash);
  const address = requireMoneroAddress(options.address);
  const message = optionalMessage(options.message);
  const signature = requireSignature(options.signature);

  const anyWallet = await prisma.wallet.findFirst({ select: { userId: true } });
  if (!anyWallet) throw new Error("No wallet is configured; proof verification unavailable");

  await ensureWalletOpen(anyWallet.userId);

  const result = await walletRpc<CheckTxProofResult>("check_tx_proof", {
    txid: txHash,
    address,
    message,
    signature,
  });

  return {
    good: result.good,
    confirmations: result.confirmations,
    inPool: result.in_pool,
    receivedXmr: atomicToXmr(result.received),
    receivedAtomic: BigInt(result.received).toString(),
  };
}

export async function closeWallet(): Promise<void> {
  await walletRpc("close_wallet");
  openWalletFile = null;
}

/**
 * Flush the wallet's scan position to disk. monero-wallet-rpc only persists
 * progress on store/close, so calling this periodically prevents a container
 * restart from replaying thousands of already-scanned blocks.
 */
export async function storeWallet(): Promise<boolean> {
  if (!openWalletFile) return false;
  try {
    await walletRpc("store");
    return true;
  } catch {
    // A busy RPC or a wallet that was just closed is not an error worth failing
    // a settlement sweep over. The next sweep will try again.
    return false;
  }
}
