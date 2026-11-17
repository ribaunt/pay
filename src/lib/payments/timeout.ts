import { getPaymentConfig } from "@/lib/config";

export type TimeoutResult = { expiresAt: Date | null; timeoutSeconds: number | null };

/** Resolve a client timeout into a bounded expiry. `0` means never expires. */
export function resolvePaymentTimeout(value: unknown, now = new Date()): TimeoutResult {
  const config = getPaymentConfig();

  if (value === undefined || value === null || value === "") {
    const seconds = clamp(config.defaultTimeoutSeconds, config);
    return { expiresAt: new Date(now.getTime() + seconds * 1000), timeoutSeconds: seconds };
  }

  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Invalid timeoutSeconds");
  }

  if (seconds === 0) return { expiresAt: null, timeoutSeconds: 0 };

  return {
    expiresAt: new Date(now.getTime() + clamp(seconds, config) * 1000),
    timeoutSeconds: clamp(seconds, config),
  };
}

function clamp(seconds: number, config: ReturnType<typeof getPaymentConfig>): number {
  return Math.min(
    config.maxTimeoutSeconds,
    Math.max(config.minTimeoutSeconds, Math.floor(seconds))
  );
}

export function isExpired(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}
