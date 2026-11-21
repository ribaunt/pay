const { describe, expect, it } = await import("@/testkit");
const { amountPair, paymentEventData, paymentLinkView, receivedPair } = await import("./serialize");

const record = {
  id: "link-1",
  address: "8sub",
  uri: "monero:8sub",
  label: "Order 42",
  amount: "100000000000",
  receivedAtomic: "150000000000",
  status: "confirmed",
  fiatAmount: "2",
  fiatCurrency: "USD",
  rateUsd: "450.955",
  fxRate: "1",
  rateSources: "coingecko,kraken",
  rateFetchedAt: new Date("2026-11-21T09:00:00.000Z"),
  rateStale: false,
  rateDegraded: false,
  requiredConfirmations: 10,
  confirmations: 10,
  txHash: "tx-1",
  createdAt: new Date("2026-11-21T08:00:00.000Z"),
  expiresAt: null,
  paidAt: new Date("2026-11-21T08:05:00.000Z"),
  cancelledAt: null,
  lateDetectedAt: null,
};

describe("canonical amount pairs", () => {
  it("always exposes XMR and atomic forms together", () => {
    expect(amountPair("100000000000")).toEqual({
      amountXmr: "0.1",
      amountAtomic: "100000000000",
    });
    expect(receivedPair("150000000000")).toEqual({
      receivedXmr: "0.15",
      receivedAtomic: "150000000000",
    });
  });

  it("uses null for both forms when nothing was received", () => {
    expect(receivedPair(null)).toEqual({ receivedXmr: null, receivedAtomic: null });
    expect(receivedPair(undefined)).toEqual({ receivedXmr: null, receivedAtomic: null });
  });
});

describe("paymentLinkView", () => {
  it("is the shared shape for create, renew, list, status, audit and payment requests", () => {
    const view = paymentLinkView(record);

    expect(view).toMatchObject({
      id: "link-1",
      status: "confirmed",
      address: "8sub",
      uri: "monero:8sub",
      label: "Order 42",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: "0.15",
      receivedAtomic: "150000000000",
      fiatAmount: "2",
      fiatCurrency: "USD",
      rateUsd: "450.955",
      fxRate: "1",
      rateSources: "coingecko,kraken",
      rateStale: false,
      rateDegraded: false,
      requiredConfirmations: 10,
      confirmations: 10,
      confirmationsRemaining: 0,
      txHash: "tx-1",
      expiresAt: null,
    });
    expect(view.rateFetchedAt).toBe("2026-11-21T09:00:00.000Z");
    expect(view.createdAt).toBe("2026-11-21T08:00:00.000Z");
    expect(view.paidAt).toBe("2026-11-21T08:05:00.000Z");

    // No raw internal DB field names leak onto the wire.
    expect(view).not.toHaveProperty("amount");
    expect(view).not.toHaveProperty("receivedAtomic_string");
  });
});

describe("paymentEventData", () => {
  it("matches the same amount, rate-neutral and txHash vocabulary as API responses", () => {
    const data = paymentEventData(record);

    expect(data).toMatchObject({
      id: "link-1",
      status: "confirmed",
      amountXmr: "0.1",
      amountAtomic: "100000000000",
      receivedXmr: "0.15",
      receivedAtomic: "150000000000",
      txHash: "tx-1",
      confirmations: 10,
      fiatAmount: "2",
      fiatCurrency: "USD",
    });
    expect(data).not.toHaveProperty("txid");
    expect(data).not.toHaveProperty("amount");
  });

  it("supports event-specific extra fields without renaming canonical ones", () => {
    const data = paymentEventData(record, { fromId: "link-0" });
    expect((data as Record<string, unknown>).fromId).toBe("link-0");
    expect(data.amountAtomic).toBe("100000000000");
  });
});

export {};
