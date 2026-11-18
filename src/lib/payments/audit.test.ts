const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    wallet: { findUnique: vi.fn() },
    paymentRequest: { findMany: vi.fn() },
  },
}));

await vi.mock("@/lib/monero/network", () => ({ getMoneroNetwork: () => "mainnet" }));

const { prisma } = await import("@/lib/prisma");
const { auditToCsv, getAuditReport } = await import("./audit");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.wallet.findUnique).mockResolvedValue({
    address: "4wallet",
    restoreHeight: 100,
    isWatchOnly: true,
  } as never);
  vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
    {
      id: "p1",
      label: 'invoice, "special"',
      status: "confirmed",
      address: "8sub",
      amount: "100000000000",
      receivedAtomic: "100000000000",
      fiatAmount: null,
      fiatCurrency: null,
      txHash: "tx1",
      confirmations: 10,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      paidAt: new Date("2026-01-01T00:01:00Z"),
      cancelledAt: null,
      transfers: [
        {
          txid: "tx1",
          amount: "100000000000",
          blockHeight: 100,
          createdAt: new Date("2026-01-01T00:01:00Z"),
        },
      ],
    },
  ] as never);
});

describe("audit report", () => {
  it("contains no secret key material", async () => {
    const report = await getAuditReport("single-user");
    const serialized = JSON.stringify(report);

    expect(serialized).not.toContain("viewKey");
    expect(serialized).not.toContain("spend");
    expect(report.network).toBe("mainnet");
    expect(report.payments[0].amountXmr).toBe("0.1");
  });

  it("escapes CSV cells", async () => {
    const report = await getAuditReport("single-user");
    const csv = auditToCsv(report);

    expect(csv).toContain('"invoice, ""special"""');
    expect(csv.split("\n")[0]).toContain("amountXmr");
  });

  it("neutralizes CSV formula prefixes", async () => {
    vi.mocked(prisma.paymentRequest.findMany).mockResolvedValue([
      {
        id: "p2",
        label: "=SUM(A1)",
        status: "pending",
        address: "8sub",
        amount: "100000000000",
        receivedAtomic: null,
        fiatAmount: null,
        fiatCurrency: null,
        txHash: null,
        confirmations: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        paidAt: null,
        cancelledAt: null,
        transfers: [],
      },
    ] as never);

    const csv = auditToCsv(await getAuditReport("single-user"));
    expect(csv).toContain(`"'=SUM(A1)"`);
  });
});

export {};
