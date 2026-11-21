const { createHash } = await import("node:crypto");
const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/auth", () => ({
  SINGLE_USER_ID: "single-user",
  AuthError: class AuthError extends Error {},
}));
await vi.mock(new URL("./webhooks", import.meta.url).href, () => ({ emitWebhook: vi.fn().mockResolvedValue(0) }));

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    wallet: { findUnique: vi.fn() },
    paymentRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

await vi.mock("@/lib/monero/wallet", () => ({
  createPaymentRequestAtomic: vi.fn(),
  createFreshSubaddress: vi.fn(),
  markSubaddressUsed: vi.fn(),
  getTransfers: vi.fn(),
  getWalletHeight: vi.fn(),
}));

await vi.mock("@/lib/pricing/oracle", () => ({
  getPriceQuote: vi.fn(),
}));

const { prisma } = await import("@/lib/prisma");
const { createPaymentRequestAtomic } = await import("@/lib/monero/wallet");
const { getPriceQuote } = await import("@/lib/pricing/oracle");
const { emitWebhook } = await import("./webhooks");
const { createPaymentLink } = await import("./links");

const LINK_RESPONSE = {
  id: "link-1",
  address: "8test",
  amount: "100000000000",
  uri: "monero:8test",
  status: "pending",
  expiresAt: null,
  fiatAmount: null,
  fiatCurrency: null,
  rateUsd: null,
  rateSources: null,
  requiredConfirmations: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.wallet.findUnique).mockResolvedValue({ id: "wallet-1" } as never);
  vi.mocked(createPaymentRequestAtomic).mockResolvedValue({
    address: "8test",
    addressIndex: 1,
    amountXmr: "0.1",
    amountAtomic: "100000000000",
    uri: "monero:8test",
    label: "payment",
  });
  vi.mocked(getPriceQuote).mockResolvedValue({
    currency: "USD",
    usdPerXmr: 200,
    fiatPerUsd: 1,
    sources: ["coingecko"],
    fetchedAt: new Date().toISOString(),
    stale: false,
    degraded: false,
  });
  vi.mocked(prisma.paymentRequest.create).mockResolvedValue({
    id: "link-1",
    fiatAmount: null,
    fiatCurrency: null,
    rateUsd: null,
    rateSources: null,
    requiredConfirmations: 2,
    expiresAt: null,
  } as never);
  vi.mocked(prisma.paymentRequest.update).mockResolvedValue({} as never);
  vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue(null);
});

describe("createPaymentLink", () => {
  it("returns the canonical link shape and emits a canonical webhook payload", async () => {
    const result = await createPaymentLink({ amountXmr: "0.1", timeoutSeconds: 0 });

    expect(result).toMatchObject({
      id: "link-1",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: null,
      receivedAtomic: null,
      txHash: null,
      statusUrl: "/api/payment-links/link-1/status",
    });
    expect(typeof result.statusToken).toBe("string");
    expect(result).not.toHaveProperty("amount");

    const [event, data] = vi.mocked(emitWebhook).mock.calls[0];
    expect(event).toBe("payment.created");
    expect(data).toMatchObject({
      id: "link-1",
      status: "pending",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: null,
      receivedAtomic: null,
      txHash: null,
    });
  });

  it("stores a per-link confirmation threshold", async () => {
    const result = await createPaymentLink({
      amountXmr: "0.1",
      timeoutSeconds: 0,
      requiredConfirmations: 2,
    });

    expect(result.requiredConfirmations).toBe(2);
    expect(prisma.paymentRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requiredConfirmations: 2 }),
      })
    );
  });

  it("rejects an invalid confirmation threshold", async () => {
    await expect(
      createPaymentLink({ amountXmr: "0.1", requiredConfirmations: 0 })
    ).rejects.toThrow("Invalid requiredConfirmations");
  });

  it("returns the cached response for a repeated idempotency key", async () => {
    // First call creates the reservation and snapshot.
    const first = await createPaymentLink(
      { amountXmr: "0.1", timeoutSeconds: 0 },
      { apiKeyId: "key-1", idempotencyKey: "idem-1", requestBody: { amountXmr: "0.1" } }
    );
    expect(first.id).toBe("link-1");

    // Snapshot response is stored on the reservation update.
    const update = vi.mocked(prisma.paymentRequest.update).mock.calls[0][0];
    const snapshot = (update.data as { responseSnapshot: string }).responseSnapshot;
    expect(snapshot).toBeTruthy();

    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue({
      id: "link-1",
      requestHash: createHash("sha256")
        .update(JSON.stringify({ amountXmr: "0.1" }))
        .digest("hex"),
      responseSnapshot: snapshot,
    } as never);

    const second = await createPaymentLink(
      { amountXmr: "0.1", timeoutSeconds: 0 },
      { apiKeyId: "key-1", idempotencyKey: "idem-1", requestBody: { amountXmr: "0.1" } }
    );

    expect(second).toEqual(JSON.parse(snapshot));
    expect(createPaymentRequestAtomic).toHaveBeenCalledTimes(1);
  });

  it("conflicts when the same idempotency key has a different body", async () => {
    vi.mocked(prisma.paymentRequest.findFirst).mockResolvedValue({
      id: "link-1",
      requestHash: "different",
      responseSnapshot: JSON.stringify(LINK_RESPONSE),
    } as never);

    await expect(
      createPaymentLink(
        { amountXmr: "0.2" },
        { apiKeyId: "key-1", idempotencyKey: "idem-1", requestBody: { amountXmr: "0.2" } }
      )
    ).rejects.toThrow("different request");
  });
});

export {};
