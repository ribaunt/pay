export type SyncStatus = "unavailable" | "syncing" | "synced";

export type SyncProgressInput = {
  restoreHeight: number | null;
  walletHeight: number;
  daemonHeight: number;
  maxSyncLagBlocks?: number;
  previousHeight?: number;
  previousAt?: number;
  now?: number;
};

export type SyncProgress = {
  restoreHeight: number;
  walletHeight: number;
  daemonHeight: number;
  blocksScanned: number;
  totalBlocks: number;
  percent: number;
  syncLag: number;
  status: SyncStatus;
  estimatedSecondsRemaining: number | null;
};

/**
 * Pure sync-progress calculation shared by the /api/sync endpoint and tests.
 * Percent is relative to the restore height, and the ETA uses the last two
 * samples so it stays meaningful during a long initial scan.
 */
export function computeSyncProgress(input: SyncProgressInput): SyncProgress {
  const restoreHeight = Math.max(0, input.restoreHeight ?? 0);
  const walletHeight = Math.max(0, input.walletHeight);
  const daemonHeight = Math.max(0, input.daemonHeight);
  const maxLag = Math.max(0, input.maxSyncLagBlocks ?? 10);

  const totalBlocks = Math.max(0, daemonHeight - restoreHeight);
  const blocksScanned = Math.max(
    0,
    Math.min(walletHeight, daemonHeight) - restoreHeight
  );
  const percent =
    totalBlocks === 0
      ? walletHeight >= daemonHeight && daemonHeight > 0
        ? 100
        : 0
      : Math.min(100, Math.round((blocksScanned / totalBlocks) * 1000) / 10);

  const syncLag = Math.max(0, daemonHeight - walletHeight);
  const status: SyncStatus =
    daemonHeight === 0 || walletHeight === 0
      ? "unavailable"
      : syncLag <= maxLag
        ? "synced"
        : "syncing";

  let estimatedSecondsRemaining: number | null = null;
  const now = input.now ?? Date.now();
  if (
    input.previousHeight !== undefined &&
    input.previousAt !== undefined &&
    now > input.previousAt
  ) {
    const rate = (walletHeight - input.previousHeight) / ((now - input.previousAt) / 1000);
    if (rate > 0) estimatedSecondsRemaining = Math.round(syncLag / rate);
  }

  return {
    restoreHeight,
    walletHeight,
    daemonHeight,
    blocksScanned,
    totalBlocks,
    percent,
    syncLag,
    status,
    estimatedSecondsRemaining,
  };
}
