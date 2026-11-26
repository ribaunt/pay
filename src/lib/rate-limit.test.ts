const { afterEach, beforeEach, describe, expect, it, vi } = await import("@/testkit");
const { Prisma } = await import("@prisma/client");

await vi.mock(new URL("./prisma", import.meta.url).href, () => ({
  prisma: {
    rateLimitBucket: {
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const { prisma } = await import("./prisma");
const { clientId, RateLimitError, rateLimit } = await import("./rate-limit");

const env = process.env as Record<string, string | undefined>;
const originalTrust = env.TRUST_PROXY;

const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

type Bucket = { count: number; resetAt: number };

/** In-memory Prisma mock with atomic conditional updates. */
function useStore() {
  const buckets = new Map<string, Bucket>();
  vi.mocked(prisma.rateLimitBucket.create).mockImplementation(async ({ data }: { data: { key: string; count: number; resetAt: Date } }) => {
    if (buckets.has(data.key)) throw uniqueError();
    buckets.set(data.key, { count: data.count, resetAt: data.resetAt.getTime() });
    return {} as never;
  });
  vi.mocked(prisma.rateLimitBucket.updateMany).mockImplementation(async ({ where, data }: {
    where: { key: string; resetAt?: { gt?: Date; lte?: Date }; count?: { lt?: number } };
    data: { count?: number | { increment?: number }; resetAt?: Date };
  }) => {
    const bucket = buckets.get(where.key);
    if (!bucket) return { count: 0 } as never;
    if (where.resetAt?.gt && bucket.resetAt > where.resetAt.gt.getTime()) {
      if (where.count?.lt !== undefined && bucket.count >= where.count.lt) return { count: 0 } as never;
      bucket.count += (data.count as { increment: number }).increment;
      return { count: 1 } as never;
    }
    if (where.resetAt?.lte && bucket.resetAt <= where.resetAt.lte.getTime()) {
      bucket.count = 1;
      bucket.resetAt = (data.resetAt as Date).getTime();
      return { count: 1 } as never;
    }
    return { count: 0 } as never;
  });
  return buckets;
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore();
});

afterEach(() => {
  if (originalTrust === undefined) delete env.TRUST_PROXY;
  else env.TRUST_PROXY = originalTrust;
});

describe("rateLimit", () => {
  it("allows requests below the limit", async () => {
    await expect(rateLimit("k", 3, 60_000)).resolves.toBeUndefined();
    await expect(rateLimit("k", 3, 60_000)).resolves.toBeUndefined();
  });

  it("throws once the limit is exceeded", async () => {
    await rateLimit("k", 1, 60_000);
    await expect(rateLimit("k", 1, 60_000)).rejects.toThrow(RateLimitError);
  });

  it("carries a retry hint in seconds", async () => {
    await rateLimit("k", 1, 90_000);
    const error = await rateLimit("k", 1, 90_000).catch((cause: unknown) => cause);
    expect(error).toHaveProperty("retryAfterSeconds", 90);
  });

  it("resets after the window", async () => {
    const buckets = useStore();
    buckets.set("k", { count: 99, resetAt: Date.now() - 1000 });
    await expect(rateLimit("k", 1, 60_000)).resolves.toBeUndefined();
  });

  it("blocks parallel requests past the limit", async () => {
    const attempts = Array.from({ length: 20 }, () => rateLimit("burst", 5, 60_000));
    const results = await Promise.allSettled(attempts);
    const allowed = results.filter((result) => result.status === "fulfilled").length;
    expect(allowed).toBe(5);
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
