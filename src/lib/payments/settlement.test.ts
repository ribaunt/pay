const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/auth", () => ({
  SINGLE_USER_ID: "single-user",
  AuthError: class AuthError extends Error {},
}));
await vi.mock(new URL("./webhooks", import.meta.url).href, () => ({ emitWebhook: vi.fn().mockResolvedValue(0) }));

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: vi.fn(async () => [{ locked: true }]) })
    ),
    paymentRequest: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    paymentRequestTransfer: {
      upsert: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

await vi.mock("@/lib/monero/wallet", () => ({
  createPaymentRequestAtomic: vi.fn(),
  markSubaddressUsed: vi.fn(),
  getTransfers: vi.fn(),
  getTransfersSince: vi.fn(),
  getWalletHeight: vi.fn(),
}));

const { prisma } = await import("@/lib/prisma");
const { createPaymentRequestAtomic, getTransfersSince, getWalletHeight } = await import("@/lib/monero/wallet");
const { emitWebhook } = await import("./webhooks");
const { cancelPaymentLink, renewPaymentLink, settlePaymentLinks } = await import("./links");
const { ConflictError, NotFoundError } = await import("@/lib/api-response");

const now = new Date();

function request(overrides: Record<string, unknown>) {
  return {
    id: "req-1",
    amount: "100000000000",
    status: "pending",
    expiresAt: null,
    txHash: null,
    paidAt: null,
    confirmations: 0,
    address: "addr-1",
    ...overrides,
  };
}

/** First query returns unfinished links, second returns historical links. */
function useLinks(links: unknown[]) {
  vi.mocked(prisma.paymentRequest.findMany)
    .mockResolvedValueOnce(links as never)
    .mockResolvedValue([] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWalletHeight).mockResolvedValue(1000);
  vi.mocked(prisma.paymentRequest.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.paymentRequestTransfer.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.wallet.findUnique).mockResolvedValue({ id: "wallet-1", settlementCursorHeight: 0 } as never);
  vi.mocked(prisma.wallet.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(createPaymentRequestAtomic).mockResolvedValue({
    address: "8new",
    addressIndex: 2,
    amountXmr: "0.1",
    amountAtomic: "100000000000",
    uri: "monero:8new",
  });
});

describe("settlePaymentLinks", () => {
  it("scans incrementally from the stored cursor", async () => {
    vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
      id: "wallet-1",
      settlementCursorHeight: 1000,
    } as never);
    useLinks([
      request({ id: "cursor-1", address: "addr-cursor" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);
    vi.mocked(getWalletHeight).mockResolvedValue(1000);

    await settlePaymentLinks();

    expect(getTransfersSince).toHaveBeenCalledWith("single-user", 1000);
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
  });

  it("serves unfinished links before historical ones", async () => {
    vi.mocked(prisma.paymentRequest.findMany)
      .mockResolvedValueOnce([request({ id: "fresh", address: "addr-fresh" })] as never)
      .mockResolvedValueOnce([
        request({ id: "old", address: "addr-old", status: "late" }),
      ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);

    const result = await settlePaymentLinks();

    expect(result.processed).toBe(2);
    const calls = vi.mocked(prisma.paymentRequest.findMany).mock.calls;
    expect(calls[0][0]).toMatchObject({
      where: { status: { in: ["pending", "detected", "confirming"] } },
      take: 200,
    });
    expect(calls[1][0]).toMatchObject({
      where: { status: { in: ["expired", "late", "underpaid", "overpaid"] } },
      take: 199,
    });
  });

  it("skips database writes when nothing changed", async () => {
    useLinks([
      request({
        id: "noop-1",
        address: "addr-noop",
        status: "confirming",
        txHash: "tx-noop",
        paidAt: new Date("2026-01-01T00:00:00Z"),
        confirmations: 6,
        receivedAtomic: "100000000000",
        transfers: [
          {
            txid: "tx-noop",
            amount: "100000000000",
            blockHeight: 995,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        ],
      }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      {
        txHash: "tx-noop",
        address: "addr-noop",
        blockHeight: 995,
        amountXmr: "0.1",
        type: "in",
        timestamp: now.toISOString(),
      },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequestTransfer.upsert).not.toHaveBeenCalled();
    expect(prisma.paymentRequest.updateMany).not.toHaveBeenCalled();
    expect(emitWebhook).not.toHaveBeenCalled();
  });

  it("emits a canonical webhook payload on status transitions", async () => {
    useLinks([
      request({ id: "hook-1", address: "addr-hook", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-hook", address: "addr-hook", blockHeight: 995, amountXmr: "0.1", amountAtomic: "100000000000", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(emitWebhook).toHaveBeenCalled();
    const [event, data] = vi.mocked(emitWebhook).mock.calls[0];
    expect(event).toBe("payment.confirming");
    expect(data).toMatchObject({
      id: "hook-1",
      status: "confirming",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: "0.1",
      receivedAtomic: "100000000000",
      txHash: "tx-hook",
      confirmations: 6,
    });
    expect(data).not.toHaveProperty("txid");
  });

  it("expires an unpaid pending link", async () => {
    useLinks([
      request({ id: "expired-1", status: "pending", expiresAt: new Date(now.getTime() - 1000) }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);

    const result = await settlePaymentLinks();

    expect(result.processed).toBe(1);
    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "expired-1", status: "pending" },
      data: { status: "expired" },
    });
    const [event, data] = vi.mocked(emitWebhook).mock.calls[0];
    expect(event).toBe("payment.expired");
    expect(data).toMatchObject({
      id: "expired-1",
      status: "expired",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: null,
      receivedAtomic: null,
    });
  });

  it("detects a pooled payment", async () => {
    useLinks([
      request({ id: "detect-1", address: "addr-2" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-2", address: "addr-2", blockHeight: 0, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "detect-1", status: "pending" },
        data: expect.objectContaining({ status: "detected", txHash: "tx-2", confirmations: 0 }),
      })
    );
  });

  it("confirms a covered zero-conf payment in the mempool", async () => {
    useLinks([
      request({ id: "zero-1", address: "addr-zero", status: "detected", zeroConf: true }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-zero", address: "addr-zero", blockHeight: 0, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "confirmed", confirmations: 0 }),
      })
    );
  });

  it("marks a mostly confirmed payment as confirming", async () => {
    useLinks([
      request({ id: "confirm-1", address: "addr-3", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-3", address: "addr-3", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "confirming", confirmations: 6 }),
      })
    );
  });

  it("confirms a payment with enough confirmations", async () => {
    useLinks([
      request({ id: "confirmed-1", address: "addr-4", status: "confirming" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-4", address: "addr-4", blockHeight: 990, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "confirmed", confirmations: 11 }),
      })
    );
  });

  it("sums multiple transfers and marks an overpayment", async () => {
    useLinks([
      request({ id: "dup-1", address: "addr-dup", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-a", address: "addr-dup", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
      { txHash: "tx-b", address: "addr-dup", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "overpaid",
          receivedAtomic: "200000000000",
          confirmations: 6,
        }),
      })
    );
  });

  it("marks a late payment after expiry", async () => {
    useLinks([
      request({ id: "late-1", address: "addr-5", status: "expired", expiresAt: new Date(now.getTime() - 1000) }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-5", address: "addr-5", blockHeight: 999, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "late", txHash: "tx-5" }),
      })
    );
  });

  it("keeps tracking confirmations for an already late payment", async () => {
    useLinks([
      request({ id: "late-2", address: "addr-late", status: "late", txHash: "tx-late" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-late", address: "addr-late", blockHeight: 990, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "late", confirmations: 11 }),
      })
    );
  });

  it("skips the pass when another sweep holds the advisory lock", async () => {
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: (client: unknown) => Promise<unknown>) =>
      fn({ $queryRaw: vi.fn(async () => [{ locked: false }]) })
    );

    const result = await settlePaymentLinks();

    expect(result).toEqual({ processed: 0, skipped: true });
    expect(prisma.paymentRequest.findMany).not.toHaveBeenCalled();
  });

  it("fails the pass without writing state when wallet height is unavailable", async () => {
    useLinks([
      request({ id: "height-1", address: "addr-height", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-height", address: "addr-height", blockHeight: 990, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);
    vi.mocked(getWalletHeight).mockRejectedValueOnce(new Error("RPC timeout"));

    await expect(settlePaymentLinks()).rejects.toThrow("RPC timeout");
    expect(prisma.paymentRequest.updateMany).not.toHaveBeenCalled();
    expect(emitWebhook).not.toHaveBeenCalled();
  });

  it("advances the scan cursor only if it is still behind", async () => {
    vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
      id: "wallet-1",
      settlementCursorHeight: 100,
    } as never);
    useLinks([
      request({ id: "cursor-2", address: "addr-cursor-2" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);
    vi.mocked(getWalletHeight).mockResolvedValue(200);

    await settlePaymentLinks();

    expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
      where: { id: "wallet-1", settlementCursorHeight: { lt: 190 } },
      data: { settlementCursorHeight: 190 },
    });
  });
});

describe("cancelPaymentLink", () => {
  it("cancels a waiting request with no observed transaction", async () => {
    const result = await cancelPaymentLink("cancel-1");

    expect(result).toMatchObject({
      id: "cancel-1",
      status: "cancelled",
      amountXmr: "0",
      amountAtomic: "0",
      receivedXmr: null,
      receivedAtomic: null,
    });

    const [event, data] = vi.mocked(emitWebhook).mock.calls[0];
    expect(event).toBe("payment.cancelled");
    expect(data).toMatchObject({ id: "cancel-1", status: "cancelled", txHash: null });
    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "cancel-1", status: "pending", txHash: null, paidAt: null },
      data: expect.objectContaining({ status: "cancelled" }),
    });
  });

  it("refuses to cancel when a transaction was already seen", async () => {
    vi.mocked(prisma.paymentRequest.updateMany).mockResolvedValue({ count: 0 });

    await expect(cancelPaymentLink("cancel-2")).rejects.toThrow(ConflictError);
  });

  it("scopes cancellation to the caller's store", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue({ id: "cancel-1" } as never);

    await cancelPaymentLink("cancel-1", "store-a");

    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "cancel-1", storeId: "store-a" },
      select: { id: true },
    });
    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storeId: "store-a" }) })
    );
  });

  it("hides another store's link from cancellation", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue(null);

    await expect(cancelPaymentLink("cancel-1", "store-a")).rejects.toThrow(NotFoundError);
    expect(prisma.paymentRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe("partial payments", () => {
  it("recovers from an underpayment after a top-up", async () => {
    useLinks([
      request({
        id: "topup-1",
        address: "addr-topup",
        status: "underpaid",
        receivedAtomic: "40000000000",
      }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-1", address: "addr-topup", blockHeight: 995, amountXmr: "0.04", type: "in", timestamp: now.toISOString() },
      { txHash: "tx-2", address: "addr-topup", blockHeight: 995, amountXmr: "0.06", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "confirming",
          receivedAtomic: "100000000000",
          confirmations: 6,
        }),
      })
    );
  });

  it("marks an underpayment and stores the received amount", async () => {
    useLinks([
      request({ id: "partial-1", address: "addr-partial", status: "pending" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-partial", address: "addr-partial", blockHeight: 995, amountXmr: "0.04", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "underpaid", receivedAtomic: "40000000000" }),
      })
    );
  });

  it("expires an underpaid link at its deadline", async () => {
    useLinks([
      request({
        id: "underpaid-expired",
        status: "underpaid",
        txHash: "tx-partial",
        expiresAt: new Date(now.getTime() - 1000),
      }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);

    const result = await settlePaymentLinks();

    expect(result.processed).toBe(1);
    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "underpaid-expired", status: "underpaid" },
      data: { status: "expired" },
    });
  });

  it("moves a partially paid link past its deadline to late", async () => {
    useLinks([
      request({
        id: "underpaid-late",
        address: "addr-underpaid",
        status: "underpaid",
        txHash: "tx-partial",
        expiresAt: new Date(now.getTime() - 1000),
      }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-partial", address: "addr-underpaid", blockHeight: 990, amountXmr: "0.04", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "underpaid-late", status: "underpaid" },
        data: expect.objectContaining({ status: "late", receivedAtomic: "40000000000" }),
      })
    );
  });
});

describe("renewPaymentLink", () => {
  it("renews an expired payment with no transaction", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue({
      id: "expired-link",
      status: "expired",
      txHash: null,
      paidAt: null,
      amount: "100000000000",
      label: "test",
      fiatAmount: null,
      fiatCurrency: null,
      rateUsd: null,
      fxRate: null,
      rateSources: null,
      rateFetchedAt: null,
      rateStale: false,
      rateDegraded: false,
      requiredConfirmations: null,
      apiKeyId: null,
    } as never);
    vi.mocked(prisma.paymentRequest.create).mockResolvedValue({
      id: "new-link",
      amount: "100000000000",
      status: "pending",
      expiresAt: null,
    } as never);

    const result = await renewPaymentLink("expired-link");

    expect(result.id).toBe("new-link");
    expect(result).toMatchObject({
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: null,
      receivedAtomic: null,
      statusUrl: "/api/payment-links/new-link/status",
    });
    expect(typeof result.statusToken).toBe("string");
    expect(prisma.paymentRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ renewedFromId: "expired-link" }),
      })
    );
    const [event, data] = vi.mocked(emitWebhook).mock.calls[0];
    expect(event).toBe("payment.renewed");
    expect(data).toMatchObject({
      id: "new-link",
      fromId: "expired-link",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
    });
  });

  it("refuses to renew a paid payment", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue({
      id: "paid-link",
      status: "confirmed",
      txHash: "tx-1",
    } as never);

    await expect(renewPaymentLink("paid-link")).rejects.toThrow(ConflictError);
  });

  it("hides another store's link from renewal", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue(null);

    await expect(renewPaymentLink("expired-link", "store-a")).rejects.toThrow(NotFoundError);
    expect(prisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      where: { id: "expired-link", storeId: "store-a" },
    });
    expect(prisma.paymentRequest.create).not.toHaveBeenCalled();
  });
});

export {};
