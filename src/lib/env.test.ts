const { afterEach, describe, expect, it } = await import("@/testkit");
const { assertProductionEnv } = await import("./env");

const KEYS = [
  "NODE_ENV",
  "SESSION_SECRET",
  "WALLET_ENCRYPTION_KEY",
  "MONERO_RPC_USER",
  "MONERO_RPC_PASSWORD",
  "SINGLE_USER_EMAIL",
  "SINGLE_USER_PASSWORD",
  "PAYMENT_API_KEY",
  "CRON_SECRET",
  "MONERO_DAEMON_MODE",
  "MONERO_RPC_PASSWORD",
  "MONERO_WALLET_PASSWORD",
  "POSTGRES_PASSWORD",
] as const;

const env = process.env as Record<string, string | undefined>;
const snapshot = Object.fromEntries(KEYS.map((key) => [key, env[key]]));

function setEnv(key: string, value?: string) {
  if (value === undefined) delete env[key];
  else env[key] = value;
}

afterEach(() => {
  for (const key of KEYS) setEnv(key, snapshot[key]);
});

function setValidProductionEnv() {
  setEnv("NODE_ENV", "production");
  setEnv("SESSION_SECRET", "a".repeat(32));
  setEnv("WALLET_ENCRYPTION_KEY", "b".repeat(64));
  setEnv("MONERO_RPC_USER", "monero");
  setEnv("MONERO_RPC_PASSWORD", "rpc-password-long-enough");
  setEnv("MONERO_WALLET_PASSWORD", "wallet-password-long-enough");
  setEnv("POSTGRES_PASSWORD", "postgres-password-long-enough");
  setEnv("SINGLE_USER_EMAIL", "admin@example.com");
  setEnv("SINGLE_USER_PASSWORD", "a-long-single-user-password");
  setEnv("PAYMENT_API_KEY", "payment-api-key-long-enough-for-tests");
  setEnv("CRON_SECRET", "cron-secret-long-enough-for-tests");
  setEnv("MONERO_DAEMON_MODE", "full-scan");
}

describe("assertProductionEnv", () => {
  it("does nothing outside production", () => {
    setEnv("NODE_ENV", "test");
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it("throws when required secrets are missing", () => {
    setEnv("NODE_ENV", "production");
    setEnv("SESSION_SECRET");
    setEnv("WALLET_ENCRYPTION_KEY");
    expect(() => assertProductionEnv()).toThrow("Missing required production environment");
  });

  it("throws when the session secret is too short", () => {
    setValidProductionEnv();
    setEnv("SESSION_SECRET", "short");
    expect(() => assertProductionEnv()).toThrow("at least 32 characters");
  });

  it("throws when the encryption key is not 64 hex characters", () => {
    setValidProductionEnv();
    setEnv("WALLET_ENCRYPTION_KEY", "not-hex");
    expect(() => assertProductionEnv()).toThrow("64 hex characters");
  });

  it("rejects light-wallet daemon mode", () => {
    setValidProductionEnv();
    setEnv("MONERO_DAEMON_MODE", "light");
    expect(() => assertProductionEnv()).toThrow("light-wallet mode is not supported");
  });

  it("rejects weak wallet and database passwords", () => {
    setValidProductionEnv();
    setEnv("MONERO_WALLET_PASSWORD", "pay");
    expect(() => assertProductionEnv()).toThrow("MONERO_WALLET_PASSWORD");
  });

  it("throws when the single-user password is too short", () => {
    setValidProductionEnv();
    setEnv("SINGLE_USER_PASSWORD", "short");
    expect(() => assertProductionEnv()).toThrow("SINGLE_USER_PASSWORD must be at least 12");
  });

  it("passes with valid configuration", () => {
    setValidProductionEnv();
    expect(() => assertProductionEnv()).not.toThrow();
  });
});

export {};
