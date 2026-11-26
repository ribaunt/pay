import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import {
  PayClient,
  PayError,
  PaymentEventStream,
  verifyAttestation,
  verifyWebhookSignature,
  type Attestation,
} from "./index";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("PayClient", () => {
  it("sends the API key and idempotency key when creating a link", async () => {
    let url = "";
    let headers = new Headers();
    globalThis.fetch = async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return json({ link: { id: "link-1" } }, { status: 201 });
    };

    const result = await new PayClient("http://pay.test", "key-1").createLink(
      { amountXmr: "0.01" },
      "retry-1"
    );

    assert.equal(url, "http://pay.test/api/payment-links");
    assert.equal(headers.get("x-api-key"), "key-1");
    assert.equal(headers.get("idempotency-key"), "retry-1");
    assert.equal(result.link.id, "link-1");
  });

  it("sends the status token in a header, never in the URL", async () => {
    let url = "";
    let headers = new Headers();
    globalThis.fetch = async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return json({ id: "link-1", status: "pending" });
    };

    await new PayClient("http://pay.test", "key-1").status("link-1", "secret-token");

    assert.equal(url, "http://pay.test/api/payment-links/link-1/status");
    assert.equal(headers.get("x-status-token"), "secret-token");
    assert.equal(headers.get("x-api-key"), null);
    assert.ok(!url.includes("secret-token"));
  });

  it("streams events with the status token in a header", async () => {
    let url = "";
    let headers = new Headers();
    globalThis.fetch = async (input, init) => {
      url = String(input);
      headers = new Headers(init?.headers);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: payment.update\ndata: {"id":"link-1","status":"confirmed"}\n\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    const stream = new PayClient("http://pay.test", "key-1").events("link-1", "secret-token");
    const received: unknown[] = [];
    stream.addEventListener("payment.update", (data) => received.push(data));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stream.close();

    assert.equal(url, "http://pay.test/api/events?linkId=link-1");
    assert.equal(headers.get("x-status-token"), "secret-token");
    assert.ok(!url.includes("secret-token"));
    assert.deepEqual(received, [{ id: "link-1", status: "confirmed" }]);
  });

  it("retries a 429 using Retry-After and exposes the status on failure", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return json(
        { error: "Too many requests" },
        { status: 429, headers: { "retry-after": "0" } }
      );
    };

    const client = new PayClient("http://pay.test", "key-1", { retries: 1 });
    const error = await client.listLinks().catch((cause: unknown) => cause);

    assert.equal(calls, 2);
    assert.ok(error instanceof PayError);
    assert.equal(error.status, 429);
  });

  it("captures the session and CSRF cookies on login", async () => {
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/api/auth/csrf")) {
        return json(
          { token: "csrf-token" },
          { headers: { "set-cookie": "pay_csrf=csrf-cookie; Path=/" } }
        );
      }
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("content-type"), "application/json");
      return json({ ok: true }, { headers: { "set-cookie": "pay_session=session-cookie; Path=/" } });
    };

    const client = new PayClient("http://pay.test", "key-1");
    await client.login("dev@example.com", "dev-password");
    let sessionHeaders = new Headers();
    globalThis.fetch = async (_input, init) => {
      sessionHeaders = new Headers(init?.headers);
      return json({ user: { email: "dev@example.com" } });
    };
    await client.me();

    assert.equal(sessionHeaders.get("cookie"), "pay_session=session-cookie; pay_csrf=csrf-cookie");
  });
});

describe("signature helpers", () => {
  it("verifies webhook signatures", () => {
    const secret = "whsec_test";
    const signature = `sha256=${createHmac("sha256", secret)
      .update("delivery-1.payment.confirmed.{}")
      .digest("hex")}`;
    assert.equal(verifyWebhookSignature(secret, "delivery-1", "payment.confirmed", "{}", signature), true);
    assert.equal(verifyWebhookSignature(secret, "delivery-1", "payment.late", "{}", signature), false);
  });

  it("verifies attestations", () => {
    const secret = "session-secret";
    const fields = {
      kind: "ribaunt-pay-revenue-attestation",
      version: 1,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
      network: "mainnet",
      confirmedCount: 1,
      totalXmr: "0.1",
      totalAtomic: "100000000000",
      fiatTotal: null,
      fiatCurrency: null,
      generatedAt: "2026-02-01T00:00:00.000Z",
    };
    const signature = createHmac("sha256", secret).update(JSON.stringify(fields)).digest("hex");
    const attestation: Attestation = { ...fields, signature };
    assert.equal(verifyAttestation(attestation, secret), true);
    assert.equal(verifyAttestation(attestation, "wrong-secret"), false);
  });
});
