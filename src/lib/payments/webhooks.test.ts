const { createHmac } = await import("node:crypto");
const { EventEmitter } = await import("node:events");
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

await vi.mock("node:https", () => {
  const request = vi.fn((_options: unknown, callback: (res: InstanceType<typeof EventEmitter> & { statusCode: number }) => void) => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    queueMicrotask(() => {
      res.emit("data", Buffer.from("ok"));
      res.emit("end");
    });
    callback(res);
    const req = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    return req;
  });
  return { request, Agent: class {} };
});

const { prisma } = await import("@/lib/prisma");
const { encryptSecret, WEBHOOK_SECRET_PURPOSE } = await import("@/lib/crypto");
const { isPrivateIp, assertPublicUrl, resolvePublicAddress } = await import("@/lib/ssrf");
const { request: httpsRequest } = await import("node:https");
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
  vi.mocked(httpsRequest).mockImplementation((_options: unknown, callback: (res: InstanceType<typeof EventEmitter> & { statusCode: number }) => void) => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    queueMicrotask(() => {
      res.emit("data", Buffer.from("ok"));
      res.emit("end");
    });
    callback(res as never);
    return Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() }) as never;
  });
});

describe("SSRF helpers", () => {
  it("rejects private, mapped, unique-local and documentation addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "169.254.169.254",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fd12::1",
      "fe80::1",
      "2001:db8::1",
      "::1",
    ]) {
      expect(isPrivateIp(address)).toBe(true);
    }
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });

  it("rejects numeric and local hostnames at URL validation", () => {
    expect(() => assertPublicUrl("https://127.0.0.1/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://2130706433/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://0x7f000001/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://localhost/hook")).toThrow("private address");
    expect(() => assertPublicUrl("https://user:pass@example.com/hook")).toThrow("credentials");
  });

  it("rejects mixed public/private DNS responses", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ] as never);
    await expect(resolvePublicAddress("example.com")).rejects.toThrow("private address");
  });
});

describe("registerWebhook", () => {
  it("returns a one-time secret and stores it encrypted with AAD", async () => {
    const result = await registerWebhook({ url: "https://example.com/hook" });
    expect(result.secret).toMatch(/^whsec_/);

    const create = vi.mocked(prisma.webhookEndpoint.create).mock.calls[0][0] as {
      data: { id: string; secret: string };
    };
    expect(create.data.secret).toMatch(/^v2\./);
    expect(create.data.id).toBeTruthy();
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
  it("pins the connection to the validated IP and preserves TLS hostname", async () => {
    const secret = "whsec_test";
    const endpointId = "endpoint-1";
    const payload = JSON.stringify({ event: "payment.confirmed" });

    vi.mocked(prisma.webhookDelivery.findMany).mockResolvedValue([
      { id: "delivery-1", endpointId, event: "payment.confirmed", payload, attempts: 0 },
    ] as never);
    vi.mocked(prisma.webhookEndpoint.findUnique).mockResolvedValue({
      id: endpointId,
      url: "https://example.com/hook",
      secret: encryptSecret(secret, WEBHOOK_SECRET_PURPOSE, endpointId),
      enabled: true,
    } as never);

    const result = await dispatchWebhooks();
    expect(result).toEqual({ sent: 1, failed: 0 });

    const options = vi.mocked(httpsRequest).mock.calls[0][0] as {
      hostname: string;
      servername: string;
      headers: Record<string, string>;
      lookup: (host: string, opts: unknown, cb: (err: Error | null, address: string, family: number) => void) => void;
    };
    expect(options.hostname).toBe("example.com");
    expect(options.servername).toBe("example.com");
    expect(options.headers.host).toBe("example.com");

    const pinned = await new Promise<{ address: string; family: number }>((resolve) => {
      options.lookup("example.com", {}, (err, address, family) => {
        expect(err).toBeNull();
        resolve({ address, family });
      });
    });
    expect(pinned).toEqual({ address: "93.184.216.34", family: 4 });

    const signatureHeader = options.headers["x-pay-signature"];
    expect(signatureHeader).toBe(
      `sha256=${createHmac("sha256", secret)
        .update(`delivery-1.payment.confirmed.${payload}`)
        .digest("hex")}`
    );
  });
});

export {};
