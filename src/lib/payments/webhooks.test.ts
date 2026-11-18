const { createHmac } = await import("node:crypto");
const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/prisma", () => ({
  prisma: {
    webhookEndpoint: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    webhookDelivery: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

await vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

const { prisma } = await import("@/lib/prisma");
const { encryptSecret } = await import("@/lib/crypto");
const { dispatchWebhooks, emitWebhook, registerWebhook } = await import("./webhooks");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.webhookEndpoint.findMany).mockResolvedValue([]);
  vi.mocked(prisma.webhookEndpoint.create).mockResolvedValue({
    id: "endpoint-1",
    url: "https://example.com/hook",
    secret: "whsec_test",
    events: "*",
    enabled: true,
    apiKeyId: null,
    createdAt: new Date(),
  } as never);
  vi.mocked(prisma.webhookDelivery.createMany).mockResolvedValue({ count: 1 });
  vi.mocked(prisma.webhookDelivery.findMany).mockResolvedValue([]);
  vi.mocked(prisma.webhookDelivery.update).mockResolvedValue({} as never);
});

describe("registerWebhook", () => {
  it("returns a one-time secret and stores it encrypted", async () => {
    const result = await registerWebhook({ url: "https://example.com/hook" });
    expect(result.secret).toMatch(/^whsec_/);

    const create = vi.mocked(prisma.webhookEndpoint.create).mock.calls[0][0];
    expect((create.data as { secret: string }).secret).toMatch(/^v1\./);
  });

  it("rejects private literal addresses", async () => {
    await expect(registerWebhook({ url: "https://127.0.0.1/hook" })).rejects.toThrow(
      "private address"
    );
  });

  it("rejects private DNS results", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(registerWebhook({ url: "https://example.com/hook" })).rejects.toThrow(
      "private address"
    );
  });
});

describe("emitWebhook", () => {
  it("creates one delivery per matching endpoint", async () => {
    vi.mocked(prisma.webhookEndpoint.findMany).mockResolvedValue([
      { id: "e1", events: "*", enabled: true },
      { id: "e2", events: "payment.confirmed", enabled: true },
    ] as never);

    expect(await emitWebhook("payment.confirmed", { id: "link-1" })).toBe(2);
    expect(prisma.webhookDelivery.createMany).toHaveBeenCalled();
  });
});

describe("dispatchWebhooks", () => {
  it("signs deliveries with the decrypted secret and disables redirects", async () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({ event: "payment.confirmed" });

    vi.mocked(prisma.webhookDelivery.findMany).mockResolvedValue([
      { id: "delivery-1", endpointId: "e1", event: "payment.confirmed", payload, attempts: 0 },
    ] as never);
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue({
      id: "e1",
      url: "https://example.com/hook",
      secret: encryptSecret(secret),
      enabled: true,
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchWebhooks();

    expect(result).toEqual({ sent: 1, failed: 0 });
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; redirect?: string };
    expect(init.redirect).toBe("manual");
    const expected = `sha256=${createHmac("sha256", secret)
      .update(`delivery-1.payment.confirmed.${payload}`)
      .digest("hex")}`;
    expect(init.headers["x-pay-signature"]).toBe(expected);
  });
});

export {};
