import { createHmac, timingSafeEqual } from "node:crypto";

export type CreateLinkInput = {
  amountXmr?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  timeoutSeconds?: number;
  requiredConfirmations?: number;
  zeroConf?: boolean;
  label?: string;
  description?: string;
};

export type PaymentLink = {
  id: string;
  storeId: string | null;
  status: string;
  address: string | null;
  uri: string | null;
  label: string | null;
  amountXmr: string;
  amountAtomic: string;
  receivedXmr: string | null;
  receivedAtomic: string | null;
  coveredXmr: string;
  coveredAtomic: string;
  unlockedXmr: string;
  unlockedAtomic: string;
  complete: boolean;
  zeroConf: boolean;
  fiatAmount: string | null;
  fiatCurrency: string | null;
  rateUsd: string | null;
  fxRate: string | null;
  rateSources: string | null;
  rateFetchedAt: string | null;
  rateStale: boolean;
  rateDegraded: boolean;
  requiredConfirmations: number | null;
  confirmations: number;
  confirmationsRemaining: number;
  txHash: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  lateDetectedAt: string | null;
};

export type CreatedLink = { link: PaymentLink & { statusUrl: string; statusToken: string } };
export type Quote = {
  fiatAmount: string;
  fiatCurrency: string;
  amountXmr: string;
  amountAtomic: string;
  rateUsd: string;
  fxRate: string;
  sources: string[];
  fetchedAt: string;
  stale: boolean;
  degraded: boolean;
};
export type WebhookEndpoint = {
  id: string;
  url: string;
  events: string;
  enabled: boolean;
  createdAt: string;
};
export type Attestation = {
  kind: string;
  version: number;
  from: string;
  to: string;
  network: string;
  confirmedCount: number;
  totalXmr: string;
  totalAtomic: string;
  fiatTotal: string | null;
  fiatCurrency: string | null;
  generatedAt: string;
  signature: string;
};

export class PayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(message);
    this.name = "PayError";
  }
}

export type PayClientOptions = {
  timeoutMs?: number;
  retries?: number;
  sessionCookie?: string;
  csrfToken?: string;
};

type AuthMode = "key" | "session" | "public";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal stream parser: EventSource cannot send the x-status-token header. */
export class PaymentEventStream {
  private readonly controller = new AbortController();
  private readonly listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(url: string, headers: Record<string, string>) {
    void this.run(url, headers);
  }

  addEventListener(type: string, listener: (data: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  close(): void {
    this.controller.abort();
  }

  private emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(data);
  }

  private async run(url: string, headers: Record<string, string>): Promise<void> {
    try {
      const response = await fetch(url, { headers, signal: this.controller.signal });
      if (!response.ok || !response.body) {
        this.emit("error", { status: response.status });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let event = "message";
      let dataLines: string[] = [];

      const dispatch = () => {
        if (dataLines.length === 0) return;
        const raw = dataLines.join("\n");
        try {
          this.emit(event, JSON.parse(raw));
        } catch {
          this.emit(event, raw);
        }
        event = "message";
        dataLines = [];
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line === "") {
            dispatch();
          } else if (line.startsWith("event: ")) {
            event = line.slice(7);
          } else if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          }
        }
      }
      dispatch();
    } catch (error) {
      if (!this.controller.signal.aborted) this.emit("error", error);
    }
  }
}

export class PayClient {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private sessionCookie: string | null;
  private csrfToken: string | null;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: PayClientOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 2;
    this.sessionCookie = options.sessionCookie ?? null;
    this.csrfToken = options.csrfToken ?? null;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    auth: AuthMode = "key"
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (auth === "key") headers.set("x-api-key", this.apiKey);
    if (auth === "session") {
      if (this.sessionCookie) headers.set("cookie", this.sessionCookie);
      if (init.method && init.method !== "GET" && this.csrfToken) {
        headers.set("x-csrf-token", this.csrfToken);
      }
    }

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) return (await response.json()) as T;

      const retryAfter = Number(response.headers.get("retry-after") ?? 0) || null;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.retries) {
        await delay(retryAfter ? retryAfter * 1000 : 2 ** attempt * 100);
        continue;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new PayError(response.status, body.error ?? `HTTP ${response.status}`, retryAfter);
    }
  }

  /** Sign in with env credentials and capture the session and CSRF cookies. */
  async login(email: string, password: string): Promise<void> {
    const csrf = await fetch(`${this.baseUrl}/api/auth/csrf`);
    const csrfCookie = csrf.headers
      .getSetCookie()
      .find((value) => value.startsWith("pay_csrf="))
      ?.split(";")[0];
    const { token } = (await csrf.json()) as { token: string };

    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new PayError(response.status, "Login failed");
    const session = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("pay_session="))
      ?.split(";")[0];
    this.sessionCookie = [session, csrfCookie].filter(Boolean).join("; ") || null;
    this.csrfToken = token;
  }

  me(): Promise<{ user: { email: string } }> {
    return this.request("/api/auth/me", {}, "session");
  }

  async logout(): Promise<void> {
    await this.request("/api/auth/logout", { method: "POST" }, "session");
    this.sessionCookie = null;
    this.csrfToken = null;
  }

  createLink(input: CreateLinkInput, idempotencyKey?: string): Promise<CreatedLink> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    return this.request(
      "/api/payment-links",
      { method: "POST", headers, body: JSON.stringify(input) },
      "key"
    );
  }

  listLinks(status?: string): Promise<{ links: PaymentLink[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/api/payment-links${query}`);
  }

  async status(id: string, statusToken: string): Promise<PaymentLink> {
    const response = await fetch(
      `${this.baseUrl}/api/payment-links/${encodeURIComponent(id)}/status`,
      { headers: { "x-status-token": statusToken }, signal: AbortSignal.timeout(this.timeoutMs) }
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new PayError(response.status, body.error ?? `HTTP ${response.status}`);
    }
    return (await response.json()) as PaymentLink;
  }

  cancel(id: string): Promise<{ id: string }> {
    return this.request(
      `/api/payment-links/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
      "key"
    );
  }

  renew(id: string): Promise<CreatedLink> {
    return this.request(
      `/api/payment-links/${encodeURIComponent(id)}/renew`,
      { method: "POST" },
      "key"
    );
  }

  quote(fiatAmount: string, fiatCurrency: string): Promise<Quote> {
    const query = new URLSearchParams({ fiatAmount, fiatCurrency });
    return this.request(`/api/prices/quote?${query}`, {}, "public");
  }

  currencies(): Promise<{ currencies: string[] }> {
    return this.request("/api/prices/currencies", {}, "public");
  }

  verifyProof(proof: {
    txHash: string;
    address: string;
    message?: string;
  }): Promise<{ valid: boolean }> {
    return this.request(
      "/api/public/payment-proofs/verify",
      { method: "POST", body: JSON.stringify(proof) },
      "public"
    );
  }

  listWebhooks(): Promise<{ webhooks: WebhookEndpoint[] }> {
    return this.request("/api/webhooks");
  }

  registerWebhook(input: { url: string; events?: string }): Promise<{
    webhook: WebhookEndpoint & { secret: string };
  }> {
    return this.request(
      "/api/webhooks",
      { method: "POST", body: JSON.stringify(input) },
      "key"
    );
  }

  audit(format: "json" | "csv" = "json"): Promise<unknown> {
    return this.request(`/api/wallet/audit?format=${format}`);
  }

  metrics(): Promise<string> {
    return this.request("/api/metrics", {}, "key");
  }

  attestation(from: string, to: string, storeId?: string): Promise<Attestation> {
    const params = new URLSearchParams({ from, to });
    if (storeId) params.set("storeId", storeId);
    return this.request(`/api/admin/attestations?${params}`, {}, "session");
  }

  listStores(): Promise<{ stores: Array<{ id: string; name: string }> }> {
    return this.request("/api/admin/stores", {}, "session");
  }

  events(linkId?: string, token?: string): PaymentEventStream {
    const params = new URLSearchParams();
    const headers: Record<string, string> = {};
    if (linkId && token) {
      params.set("linkId", linkId);
      // The bearer token travels in a header so it never lands in URLs or logs.
      headers["x-status-token"] = token;
    } else {
      headers["x-api-key"] = this.apiKey;
    }
    return new PaymentEventStream(`${this.baseUrl}/api/events?${params}`, headers);
  }
}

/** Verify the HMAC sent in x-pay-signature over deliveryId + event + raw body. */
export function verifyWebhookSignature(
  secret: string,
  deliveryId: string,
  event: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = `sha256=${createHmac("sha256", secret)
    .update(`${deliveryId}.${event}.${rawBody}`)
    .digest("hex")}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verify a signed aggregate revenue attestation offline. */
export function verifyAttestation(attestation: Attestation, secret: string): boolean {
  const { signature, ...unsigned } = attestation;
  const expected = createHmac("sha256", secret)
    .update(JSON.stringify(unsigned))
    .digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
