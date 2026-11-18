const { describe, expect, it } = await import("@/testkit");
const { apiError } = await import("./api-response");
const { MoneroRpcError } = await import("./monero/rpc");

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
});

export {};
