#!/usr/bin/env node
// Configure the watch-only wallet from environment variables.
// Runs after migrations and after the API is listening. Safe to re-run.

const base = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const address = process.env.MONERO_WALLET_ADDRESS?.trim() ?? "";
const viewKey = process.env.MONERO_WALLET_VIEW_KEY?.trim() ?? "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!address || !viewKey) {
  console.log("wallet bootstrap: MONERO_WALLET_ADDRESS/VIEW_KEY not set, skipping");
  process.exit(0);
}

async function waitForApi() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok || response.status === 503) return;
    } catch {
      // Not listening yet.
    }
    await sleep(2000);
  }
  throw new Error("API did not become reachable in time");
}

async function login() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.SINGLE_USER_EMAIL,
      password: process.env.SINGLE_USER_PASSWORD,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`sign-in failed with HTTP ${response.status}`);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

async function main() {
  await waitForApi();
  const cookie = await login();

  const current = await fetch(`${base}/api/wallet`, {
    headers: { cookie },
    signal: AbortSignal.timeout(10000),
  });
  if (current.ok) {
    console.log("wallet bootstrap: wallet already configured, skipping");
    return;
  }

  const body = {
    address,
    viewKey,
    restoreHeight: Number(process.env.MONERO_WALLET_RESTORE_HEIGHT ?? 0),
  };
  if (process.env.MONERO_WALLET_DESCRIPTION) body.description = process.env.MONERO_WALLET_DESCRIPTION;

  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/wallet/setup`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (response.ok) {
        const { wallet } = await response.json();
        console.log(`wallet bootstrap: configured ${wallet.address}`);
        return;
      }
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(3000);
  }
  throw lastError ?? new Error("wallet bootstrap failed");
}

main().catch((error) => {
  console.error("wallet bootstrap failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
