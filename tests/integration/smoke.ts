/**
 * Smoke test against a running stack. Use APP_URL to target dev (:3001) or prod (:3000).
 */
export {};
const APP = process.env.APP_URL ?? "http://localhost:3000";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
  console.log(`ok: ${message}`);
}

async function main() {
  const health = await fetch(`${APP}/api/health`).then((r) => r.json());
  assert(health.status === "ok", "health check is green");

  const unauth = await fetch(`${APP}/api/wallet`);
  assert(unauth.status === 401, "wallet routes require authentication");

  const login = await fetch(`${APP}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.SINGLE_USER_EMAIL,
      password: process.env.SINGLE_USER_PASSWORD,
    }),
  });
  assert(login.ok, "env credentials sign in");
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

  const csrfResponse = await fetch(`${APP}/api/auth/csrf`, { headers: { cookie } });
  assert(csrfResponse.ok, "CSRF token is issued for the session");
  const csrfCookie = csrfResponse.headers
    .getSetCookie()
    .find((value) => value.startsWith("pay_csrf="))
    ?.split(";")[0] ?? "";
  const { token: csrfToken } = (await csrfResponse.json()) as { token: string };
  const cookieWithCsrf = [cookie, csrfCookie].filter(Boolean).join("; ");

  const me = await fetch(`${APP}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
  assert(me.user?.email === process.env.SINGLE_USER_EMAIL, "session resolves to the single user");

  const apiKey = process.env.PAYMENT_API_KEY;
  const created = await fetch(`${APP}/api/payment-links`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey ?? "" },
    body: JSON.stringify({ fiatAmount: "1", fiatCurrency: "USD", timeoutSeconds: 0 }),
  });
  assert(created.status === 201, "fiat payment link created");
  const { link } = (await created.json()) as {
    link: { id: string; statusUrl: string; statusToken: string; status: string };
  };
  assert(link.status === "pending", "new link starts pending");

  const status = await fetch(`${APP}${link.statusUrl}`, {
    headers: { "x-status-token": link.statusToken },
  }).then((r) => r.json());
  assert(status.status === "pending", "public status endpoint reads pending link");

  const cancelled = await fetch(`${APP}/api/payment-links/${link.id}/cancel`, {
    method: "POST",
    headers: { cookie: cookieWithCsrf, origin: APP, "x-csrf-token": csrfToken },
  });
  assert(cancelled.status === 200, "waiting link can be cancelled");

  const after = await fetch(`${APP}${link.statusUrl}`, {
    headers: { "x-status-token": link.statusToken },
  }).then((r) => r.json());
  assert(after.status === "cancelled", "status endpoint reflects cancellation");

  const cron = await fetch(`${APP}/api/cron/payment-links`, {
    method: "POST",
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  assert(cron.ok, "settlement cron is protected and callable");

  console.log("Integration smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
