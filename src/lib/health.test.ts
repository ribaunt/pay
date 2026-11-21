const { describe, expect, it } = await import("@/testkit");
const { evaluateHealth } = await import("./health");

const base = {
  db: true,
  daemon: true,
  walletHeight: 100,
  daemonHeight: 200,
  maxSyncLagBlocks: 10,
  now: 100_000,
};

describe("evaluateHealth", () => {
  it("stays healthy while syncing when the RPC ping was recently good", () => {
    const result = evaluateHealth({
      ...base,
      rpcNow: false,
      lastRpcUpAt: 95_000,
    });
    expect(result.walletRpc).toBe(true);
    expect(result.healthy).toBe(true);
    expect(result.syncStatus).toBe("syncing");
  });

  it("becomes degraded after the RPC grace period expires", () => {
    const result = evaluateHealth({
      ...base,
      rpcNow: false,
      lastRpcUpAt: 0,
    });
    expect(result.walletRpc).toBe(false);
    expect(result.healthy).toBe(false);
  });

  it("does not let daemon health depend on RPC health", () => {
    const result = evaluateHealth({
      ...base,
      rpcNow: false,
      lastRpcUpAt: 0,
      daemon: false,
      daemonHeight: 0,
    });
    expect(result.healthy).toBe(false);
    expect(result.syncStatus).toBe("unavailable");
  });
});

export {};
