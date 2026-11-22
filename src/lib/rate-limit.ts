import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { inc } from "./metrics";

export class RateLimitError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

/**
 * Shared, Postgres-backed rate limiter that works across replicas.
 *
 * All counter updates are conditional single statements, so concurrent
 * requests cannot interleave a read and a write to bypass the limit.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);

  // First request for this key: create the bucket atomically.
  try {
    await prisma.rateLimitBucket.create({ data: { key, count: 1, resetAt } });
    return;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
  }

  // Bucket exists: increment only while it is live and below the limit.
  const incremented = await prisma.rateLimitBucket.updateMany({
    where: { key, resetAt: { gt: now }, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  if (incremented.count > 0) return;

  // Expired bucket: reset it atomically.
  const reset = await prisma.rateLimitBucket.updateMany({
    where: { key, resetAt: { lte: now } },
    data: { count: 1, resetAt },
  });
  if (reset.count > 0) return;

  inc("pay_rate_limit_hits_total", { route: key.split(":")[0] ?? "unknown" });
  throw new RateLimitError();
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
