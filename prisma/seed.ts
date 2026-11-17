/**
 * Idempotent dev seed. Run while the dev profile is up:
 *   npm run seed
 */
export {};
const API = process.env.SEED_API_URL ?? "http://localhost:3001";

const WALLETS = {
  mainnet: {
    address:
      "46W8kLbMPuo7QBYDqsQyn2Nf3nW5G3v9K3LaWCB6uAbkV6uEJKqun776N9z2UrN4UoYEn2AWXbtQ5EK2D8vxTo2NDWpxPJo",
    viewKey: "00c0a2d31bfb5d279f6eb032d984fd3f6d7e689a529d86a85f4b6a869caf420c",
  },
  stagenet: {
    address:
      "55cnAtwDo1ZTD7zo23MRYUWiRQCBDy87TfbsRxnTUSJS9fM2dYjgeceVcyzNzbR8VpGM4zbVAdDYvGshBTf8NTpv2h7ZseS",
    viewKey: "e8d1d024c00d88d6cc2a9a4fb1224d83ae1506a14a21df3cd4f174b250ac8c0b",
  },
} as const;

const network = (process.env.MONERO_NETWORK ?? "mainnet").toLowerCase() as keyof typeof WALLETS;
const wallet = WALLETS[network] ?? WALLETS.mainnet;

async function call(path: string, init: RequestInit = {}, cookie?: string) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

async function main() {
  const login = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: process.env.SINGLE_USER_EMAIL,
      password: process.env.SINGLE_USER_PASSWORD,
    }),
  });
  if (!login.response.ok) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);

  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";

  const existing = await call("/api/wallet", {}, cookie);
  if (!existing.response.ok || !existing.data.wallet) {
    const setup = await call(
      "/api/wallet/setup",
      {
        method: "POST",
        body: JSON.stringify({
          address: wallet.address,
          viewKey: wallet.viewKey,
          restoreHeight: Number(process.env.SEED_RESTORE_HEIGHT ?? 0),
          description: "dev seed wallet",
        }),
      },
      cookie
    );
    if (!setup.response.ok) throw new Error(`Setup failed: ${JSON.stringify(setup.data)}`);
    console.log(`Created ${network} watch-only wallet`);
  } else {
    console.log(`Wallet already configured: ${existing.data.wallet.name}`);
  }

  const current = await call("/api/wallet/payment-requests", {}, cookie);
  const labels = new Set<string>(
    (current.data.requests ?? []).map((request: { label?: string }) => request.label)
  );

  for (const label of ["seed-invoice-1", "seed-invoice-2"]) {
    if (labels.has(label)) continue;
    const created = await call(
      "/api/wallet/payment-requests",
      {
        method: "POST",
        body: JSON.stringify({ amountXmr: "0.001", timeoutSeconds: 0, label }),
      },
      cookie
    );
    if (!created.response.ok) throw new Error(`Payment creation failed: ${JSON.stringify(created.data)}`);
    console.log(`Created ${label}: ${created.data.payment.address}`);
  }

  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
