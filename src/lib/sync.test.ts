const { describe, expect, it } = await import("@/testkit");
const { computeSyncProgress } = await import("./sync");

describe("computeSyncProgress", () => {
  it("reports percentage from the restore height", () => {
    const result = computeSyncProgress({
      restoreHeight: 100,
      walletHeight: 150,
      daemonHeight: 200,
      now: 10_000,
    });
    expect(result.blocksScanned).toBe(50);
    expect(result.totalBlocks).toBe(100);
    expect(result.percent).toBe(50);
    expect(result.syncLag).toBe(50);
    expect(result.status).toBe("syncing");
  });

  it("reports synced at the tip", () => {
    const result = computeSyncProgress({
      restoreHeight: 100,
      walletHeight: 200,
      daemonHeight: 200,
      maxSyncLagBlocks: 10,
    });
    expect(result.percent).toBe(100);
    expect(result.status).toBe("synced");
    expect(result.syncLag).toBe(0);
  });

  it("estimates time remaining from two samples", () => {
    const result = computeSyncProgress({
      restoreHeight: 0,
      walletHeight: 200,
      daemonHeight: 400,
      previousHeight: 100,
      previousAt: 0,
      now: 10_000,
    });
    // 10 blocks/sec over 200 blocks remaining = 20 seconds.
    expect(result.estimatedSecondsRemaining).toBe(20);
  });

  it("is unavailable without daemon or wallet height", () => {
    expect(
      computeSyncProgress({ restoreHeight: 0, walletHeight: 100, daemonHeight: 0 }).status
    ).toBe("unavailable");
    expect(
      computeSyncProgress({ restoreHeight: 0, walletHeight: 0, daemonHeight: 100 }).status
    ).toBe("unavailable");
  });
});

export {};
