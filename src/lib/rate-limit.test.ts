const { afterEach, beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock(new URL("./prisma", import.meta.url).href, () => ({
  prisma: {
    rateLimitBucket: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("./prisma");
const { clientId, RateLimitError, rateLimit } = await import("./rate-limit");

const env = process.env as Record<string, string | undefined>;
const originalTrust = env.TRUST_PROXY;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.rateLimitBucket.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.rateLimitBucket.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.rateLimitBucket.update).mockResolvedValue({} as never);
  vi.mocked(prisma.rateLimitBucket.deleteMany).mockResolvedValue({ count: 0 });
});

afterEach(() => {
  if (originalTrust === undefined) delete env.TRUST_PROXY;
  else env.TRUST_PROXY = originalTrust;
});

describe("rateLimit", () => {
  it("allows requests below the limit", async () => {
    vi.mocked(prisma.rateLimitBucket.findUnique).mockResolvedValue({
      key: "k",
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(rateLimit("k", 3, 60_000)).resolves.toBeUndefined();
  });

  it("throws once the limit is exceeded", async () => {
    vi.mocked(prisma.rateLimitBucket.findUnique).mockResolvedValue({
      key: "k",
      count: 1,
      resetAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(rateLimit("k", 1, 60_000)).rejects.toThrow(RateLimitError);
  });

  it("resets after the window", async () => {
    vi.mocked(prisma.rateLimitBucket.findUnique).mockResolvedValue({
      key: "k",
      count: 99,
      resetAt: new Date(Date.now() - 1000),
    } as never);

    await expect(rateLimit("k", 1, 60_000)).resolves.toBeUndefined();
    expect(prisma.rateLimitBucket.upsert).toHaveBeenCalled();
  });
});

describe("clientId", () => {
  it("ignores XFF by default", () => {
    delete env.TRUST_PROXY;
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientId(request)).toBe("local");
  });

  it("uses XFF only when TRUST_PROXY is enabled", () => {
    env.TRUST_PROXY = "1";
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4" } });
    expect(clientId(request)).toBe("1.2.3.4");
  });
});

export {};
