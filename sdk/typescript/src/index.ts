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
  txHash: string | null;
  confirmations: number;
  [key: string]: unknown;
};

export class PayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        ...init?.headers,
      },
    });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }

  createLink(input: CreateLinkInput): Promise<{ link: PaymentLink & { statusToken: string } }> {
    return this.request("/api/payment-links", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listLinks(status?: string): Promise<{ links: PaymentLink[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/api/payment-links${query}`);
  }

  async status(id: string, statusToken: string): Promise<PaymentLink> {
    const response = await fetch(
      `${this.baseUrl}/api/payment-links/${encodeURIComponent(id)}/status`,
      { headers: { "x-status-token": statusToken } }
    );
    const body = (await response.json()) as PaymentLink & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }

  quote(fiatAmount: string, fiatCurrency: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ fiatAmount, fiatCurrency });
    return this.request(`/api/prices/quote?${query}`);
  }

  events(linkId?: string, token?: string): EventSource {
    const params = new URLSearchParams();
    if (linkId) params.set("linkId", linkId);
    if (token) params.set("token", token);
    return new EventSource(`${this.baseUrl}/api/events?${params}`);
  }
}
