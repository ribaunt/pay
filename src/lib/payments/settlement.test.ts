const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/auth", () => ({
  SINGLE_USER_ID: "single-user",
  AuthError: class AuthError extends Error {},
}));
await vi.mock(new URL("./webhooks", import.meta.url).href, () => ({ emitWebhook: vi.fn().mockResolvedValue(0) }));

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentRequest: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    paymentRequestTransfer: {
      upsert: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
const { ConflictError } = await import("@/lib/api-response");

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWalletHeight).mockResolvedValue(1000);
  vi.mocked(prisma.paymentRequest.update).mockResolvedValue({} as never);
  vi.mocked(prisma.paymentRequest.updateMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.paymentRequestTransfer.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.wallet.findUnique).mockResolvedValue({ id: "wallet-1", settlementCursorHeight: 0 } as never);
  vi.mocked(prisma.wallet.update).mockResolvedValue({} as never);
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
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "cursor-1", address: "addr-cursor" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);
    vi.mocked(getWalletHeight).mockResolvedValue(1000);

    await settlePaymentLinks();

    expect(getTransfersSince).toHaveBeenCalledWith("single-user", 1000);
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it("skips database writes when nothing changed", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
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
    expect(prisma.paymentRequest.update).not.toHaveBeenCalled();
    expect(emitWebhook).not.toHaveBeenCalled();
  });

  it("emits a canonical webhook payload on status transitions", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
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
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "expired-1", status: "pending", expiresAt: new Date(now.getTime() - 1000) }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([]);

    const result = await settlePaymentLinks();

    expect(result.processed).toBe(1);
    expect(prisma.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "expired-1" },
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
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "detect-1", address: "addr-2" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-2", address: "addr-2", blockHeight: 0, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "detect-1" },
        data: expect.objectContaining({ status: "detected", txHash: "tx-2", confirmations: 0 }),
      })
    );
  });

  it("marks a mostly confirmed payment as confirming", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "confirm-1", address: "addr-3", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-3", address: "addr-3", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "confirming", confirmations: 6 }),
      })
    );
  });

  it("confirms a payment with enough confirmations", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "confirmed-1", address: "addr-4", status: "confirming" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-4", address: "addr-4", blockHeight: 990, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "confirmed", confirmations: 11 }),
      })
    );
  });

  it("sums multiple transfers and marks an overpayment", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "dup-1", address: "addr-dup", status: "detected" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-a", address: "addr-dup", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
      { txHash: "tx-b", address: "addr-dup", blockHeight: 995, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
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
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "late-1", address: "addr-5", status: "expired", expiresAt: new Date(now.getTime() - 1000) }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-5", address: "addr-5", blockHeight: 999, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "late", txHash: "tx-5" }),
      })
    );
  });

  it("keeps tracking confirmations for an already late payment", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "late-2", address: "addr-late", status: "late", txHash: "tx-late" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-late", address: "addr-late", blockHeight: 990, amountXmr: "0.1", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "late", confirmations: 11 }),
      })
    );
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
});

describe("partial payments", () => {
  it("recovers from an underpayment after a top-up", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
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

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
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
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      request({ id: "partial-1", address: "addr-partial", status: "pending" }),
    ] as never);
    vi.mocked(getTransfersSince).mockResolvedValue([
      { txHash: "tx-partial", address: "addr-partial", blockHeight: 995, amountXmr: "0.04", type: "in", timestamp: now.toISOString() },
    ] as never);

    await settlePaymentLinks();

    expect(prisma.paymentRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "underpaid", receivedAtomic: "40000000000" }),
      })
    );
  });
});

describe("renewPaymentLink", () => {
  it("renews an expired payment with no transaction", async () => {
    vi.mocked(prisma.paymentRequest.findUnique).mockResolvedValue({
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
    vi.mocked(prisma.paymentRequest.findUnique).mockResolvedValue({
      id: "paid-link",
      status: "confirmed",
      txHash: "tx-1",
    } as never);

    await expect(renewPaymentLink("paid-link")).rejects.toThrow(ConflictError);
  });
});

export {};
