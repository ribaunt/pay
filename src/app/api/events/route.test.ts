const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  clientId: vi.fn(),
  RateLimitError: class RateLimitError extends Error {},
}));
await vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
await vi.mock("@/lib/payments/auth", () => ({ verifyApiKey: vi.fn() }));
await vi.mock("@/lib/payments/links", () => ({
  getPaymentLinkStatus: vi.fn(),
  listPaymentLinks: vi.fn(),
}));
await vi.mock("@/lib/api/serialize", () => ({
  paymentLinkView: vi.fn((link: unknown) => link),
}));

const { rateLimit, clientId } = await import("@/lib/rate-limit");
const { verifyApiKey } = await import("@/lib/payments/auth");
const { getPaymentLinkStatus, listPaymentLinks } = await import("@/lib/payments/links");
const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimit).mockResolvedValue(undefined);
  vi.mocked(clientId).mockImplementation(() => "local");
  vi.mocked(verifyApiKey).mockResolvedValue({
    id: "key-1",
    name: "test",
    scopes: "payment:read",
    storeId: null,
  });
  vi.mocked(listPaymentLinks).mockResolvedValue([]);
  vi.mocked(getPaymentLinkStatus).mockResolvedValue(null);
});

async function open(url: string, headers?: Record<string, string>) {
  const controller = new AbortController();
  try {
    const response = await GET(
      new Request(`http://localhost${url}`, { headers, signal: controller.signal })
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    return response;
  } finally {
    controller.abort();
  }
}

describe("GET /api/events rate limits", () => {
  it("buckets single-link streams by a hash of the status token", async () => {
    vi.mocked(getPaymentLinkStatus).mockResolvedValue({
      id: "link-1",
      status: "pending",
      confirmations: 0,
      receivedAtomic: null,
      amountAtomic: "100000000000",
    } as never);

    const response = await open("/api/events?linkId=link-1", {
      "x-status-token": "secret-token",
    });

    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    const [bucket, limit] = vi.mocked(rateLimit).mock.calls[0];
    expect(bucket).toMatch(/^events-status:[a-f0-9]{64}$/);
    expect(bucket).not.toContain("secret-token");
    expect(limit).toBe(10);
  });

  it("still limits key-authenticated streams", async () => {
    const response = await open("/api/events");

    expect(response.status).toBe(200);
    expect(rateLimit).toHaveBeenCalledWith("events:local", 60, 60_000);
  });
});

export {};
