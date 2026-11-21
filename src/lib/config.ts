import { getMoneroNetwork } from "./monero/network";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

export function getPaymentConfig() {
  return {
    defaultTimeoutSeconds: intEnv("PAYMENT_DEFAULT_TIMEOUT_SECONDS", 1800),
    minTimeoutSeconds: intEnv("PAYMENT_MIN_TIMEOUT_SECONDS", 60),
    maxTimeoutSeconds: intEnv("PAYMENT_MAX_TIMEOUT_SECONDS", 86400),
    requiredConfirmations: intEnv("PAYMENT_REQUIRED_CONFIRMATIONS", 10),
    maxSyncLagBlocks: intEnv("HEALTH_MAX_SYNC_LAG_BLOCKS", 10),
    allowZeroConf: process.env.PAYMENT_ALLOW_ZERO_CONF === "1",
  };
}

export function getPriceConfig() {
  return {
    cacheTtlMs: intEnv("PRICE_CACHE_TTL_SECONDS", 60) * 1000,
    maxStaleMs: intEnv("PRICE_MAX_STALENESS_SECONDS", 300) * 1000,
    httpTimeoutMs: intEnv("PRICE_HTTP_TIMEOUT_MS", 5000),
    outlierBps: intEnv("PRICE_OUTLIER_THRESHOLD_BPS", 500),
  };
}

export function getNetworkConfig() {
  return { network: getMoneroNetwork() };
}
