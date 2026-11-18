const { createHash } = await import("node:crypto");
const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
await vi.mock("@/lib/prisma", () => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("@/lib/prisma");
const { verifyApiKey } = await import("./auth");

const env = process.env as Record<string, string | undefined>;
const RAW = "pk_test_api_key_long_enough_123456";
const HASH = createHash("sha256").update(RAW).digest("hex");

function request(key = RAW) {
  return new Request("http://localhost/api/payment-links", {
    headers: { "x-api-key": key },
  });
}

beforeEach(() => {
  env.NODE_ENV = "test";
  vi.clearAllMocks();
  env.PAYMENT_API_KEY = RAW;
  vi.mocked(prisma.apiKey.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.apiKey.create).mockResolvedValue({
    id: "key-1",
    name: "bootstrap-env-key",
    scopes: "*",
    revokedAt: null,
    expiresAt: null,
  } as never);
  vi.mocked(prisma.apiKey.update).mockResolvedValue({} as never);
});

describe("verifyApiKey", () => {
  it("bootstraps the env key into a scoped database key", async () => {
    const result = await verifyApiKey(request());

    expect(result?.id).toBe("key-1");
    expect(prisma.apiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ keyHash: HASH, scopes: "payment:write,payment:read" }),
      })
    );
  });

  it("rejects a key without the required scope", async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      id: "key-2",
      name: "read-only",
      scopes: "payment:read",
      revokedAt: null,
      expiresAt: null,
    } as never);

    expect(await verifyApiKey(request(), "payment:write")).toBeNull();
    expect(await verifyApiKey(request(), "payment:read")).not.toBeNull();
  });

  it("rejects a revoked key", async () => {
    vi.mocked(prisma.apiKey.findUnique).mockResolvedValue({
      id: "key-3",
      name: "revoked",
      scopes: "*",
      revokedAt: new Date(),
      expiresAt: null,
    } as never);

    expect(await verifyApiKey(request())).toBeNull();
  });
});

export {};
