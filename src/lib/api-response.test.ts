const { describe, expect, it } = await import("@/testkit");
const { apiError, NotFoundError } = await import("./api-response");
const { MoneroRpcError } = await import("./monero/rpc");
const { RateLimitError } = await import("./rate-limit");

describe("apiError", () => {
  it("hides internal messages on upstream failures", async () => {
    const response = apiError(
      new MoneroRpcError("Could not reach monero-wallet-rpc at http://wallet-rpc:18082")
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe("Upstream service unavailable");
    expect(JSON.stringify(body)).not.toContain("wallet-rpc:18082");
  });

  it("keeps validation messages for clients", async () => {
    const response = apiError(new Error("Invalid XMR amount"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid XMR amount");
  });

  it("maps scoped misses to 404", async () => {
    const response = apiError(new NotFoundError("Payment not found"));
    expect(response.status).toBe(404);
  });

  it("tells clients when to retry a rate-limited request", async () => {
    const response = apiError(new RateLimitError(60));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
  });
});

export {};
