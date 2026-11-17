import { prisma } from "./prisma";
import { inc } from "./metrics";

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

/** Shared, Postgres-backed rate limiter. Works across app replicas and restarts. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const bucket = await prisma.rateLimitBucket.findUnique({ where: { key } });

  if (!bucket || bucket.resetAt <= now) {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: 1, resetAt },
      update: { count: 1, resetAt },
    });
    return;
  }

  if (bucket.count >= limit) {
    inc("pay_rate_limit_hits_total", { route: key.split(":")[0] ?? "unknown" });
    throw new RateLimitError();
  }

  await prisma.rateLimitBucket.update({
    where: { key },
    data: { count: { increment: 1 } },
  });

  // Opportunistic cleanup of stale buckets.
  if (Math.random() < 0.01) {
    await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }).catch(() => {});
  }
}

/**
 * Do not trust client-supplied X-Forwarded-For unless a trusted reverse proxy
 * explicitly overwrites it. TRUST_PROXY=1 enables XFF handling.
 */
export function clientId(request: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for");
    const value = forwarded?.split(",")[0]?.trim();
    if (value) return value;
  }
  return "local";
}
