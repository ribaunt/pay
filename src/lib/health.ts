export type HealthEvaluationInput = {
  db: boolean;
  rpcNow: boolean;
  lastRpcUpAt: number;
  daemon: boolean;
  walletHeight: number;
  daemonHeight: number;
  maxSyncLagBlocks: number;
  now?: number;
  staleAfterMs?: number;
};

export type HealthEvaluation = {
  walletRpc: boolean;
  healthy: boolean;
  syncStatus: "unavailable" | "syncing" | "synced";
  syncLag: number;
};

/**
 * A wallet RPC that is busy scanning blocks can miss a short health ping.
 * Treat a recently successful ping as live for a bounded grace period, and
 * separate daemon health from RPC health so the daemon is always checked.
 */
export function evaluateHealth(input: HealthEvaluationInput): HealthEvaluation {
  const now = input.now ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? 5 * 60_000;
  const walletRpc =
    input.rpcNow || (input.lastRpcUpAt > 0 && now - input.lastRpcUpAt <= staleAfterMs);

  const syncLag = Math.max(0, input.daemonHeight - input.walletHeight);
  const syncStatus =
    !input.daemon || input.walletHeight === 0
      ? "unavailable"
      : syncLag > input.maxSyncLagBlocks
        ? "syncing"
        : "synced";

  return {
    walletRpc,
    healthy: input.db && input.daemon && walletRpc,
    syncStatus,
    syncLag,
  };
}
