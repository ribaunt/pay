/** Fail fast on missing production secrets. Import and call from runtime paths only. */
export function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    "SESSION_SECRET",
    "WALLET_ENCRYPTION_KEY",
    "MONERO_RPC_USER",
    "MONERO_RPC_PASSWORD",
    "MONERO_WALLET_PASSWORD",
    "POSTGRES_PASSWORD",
    "SINGLE_USER_EMAIL",
    "SINGLE_USER_PASSWORD",
    "PAYMENT_API_KEY",
    "CRON_SECRET",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  if ((process.env.SESSION_SECRET ?? "").length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }

  if (!/^[0-9a-fA-F]{64}$/.test(process.env.WALLET_ENCRYPTION_KEY ?? "")) {
    throw new Error("WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }

  const daemonMode = process.env.MONERO_DAEMON_MODE ?? "full-scan";
  if (daemonMode !== "full-scan") {
    throw new Error("MONERO_DAEMON_MODE must be 'full-scan'; light-wallet mode is not supported");
  }

  if ((process.env.SINGLE_USER_PASSWORD ?? "").length < 12) {
    throw new Error("SINGLE_USER_PASSWORD must be at least 12 characters");
  }

  const minimums: Array<[string, number]> = [
    ["MONERO_RPC_PASSWORD", 16],
    ["MONERO_WALLET_PASSWORD", 16],
    ["POSTGRES_PASSWORD", 16],
    ["PAYMENT_API_KEY", 24],
    ["CRON_SECRET", 24],
  ];
  for (const [name, minimum] of minimums) {
    if ((process.env[name] ?? "").length < minimum) {
      throw new Error(`${name} must be at least ${minimum} characters`);
    }
  }
}
