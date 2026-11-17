import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { prisma } from "@/lib/prisma";
import { inc } from "@/lib/metrics";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export const WEBHOOK_EVENTS = [
  "payment.created",
  "payment.detected",
  "payment.confirming",
  "payment.confirmed",
  "payment.underpaid",
  "payment.overpaid",
  "payment.expired",
  "payment.cancelled",
  "payment.late",
  "payment.renewed",
] as const;

function isPrivateIp(address: string): boolean {
  let ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  if (ip.includes(".")) {
    const octets = ip.split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 192 && b === 0 ||
      a === 198 && (b === 18 || b === 19)
    );
  }

  return (
    ip === "::1" ||
    ip === "::" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  );
}

function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use https in production");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid webhook URL");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URL must not contain credentials");
  }

  const host = url.hostname.toLowerCase();
  if (isIP(host) ? isPrivateIp(host) : host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Webhook URL must not target a private address");
  }

  return url;
}

async function assertPublicUrlResolved(url: URL): Promise<void> {
  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0) throw new Error("Webhook host did not resolve");
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Webhook URL must not target a private address");
  }
}

function loadWebhookSecret(value: string): string {
  return value.startsWith("v1.") ? decryptSecret(value) : value;
}

export async function registerWebhook(options: {
  url: string;
  events?: string;
  apiKeyId?: string | null;
}) {
  const url = assertPublicUrl(options.url);
  await assertPublicUrlResolved(url);

  const events = options.events?.trim() || "*";
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      url: url.toString(),
      events,
      secret: encryptSecret(secret),
      apiKeyId: options.apiKeyId ?? null,
    },
  });

  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    secret,
  };
}

export async function emitWebhook(event: string, payload: Record<string, unknown>) {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { enabled: true } });
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });

  const matching = endpoints.filter(
    (endpoint) => endpoint.events === "*" || endpoint.events.split(",").includes(event)
  );

  if (matching.length === 0) return 0;

  await prisma.webhookDelivery.createMany({
    data: matching.map((endpoint) => ({ endpointId: endpoint.id, event, payload: body })),
  });
  inc("pay_webhook_deliveries_total", { event }, matching.length);

  return matching.length;
}

function signature(secret: string, deliveryId: string, event: string, body: string): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${deliveryId}.${event}.${body}`)
    .digest("hex")}`;
}

export async function dispatchWebhooks() {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: "pending",
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    take: 100,
  });

  let sent = 0;
  let failed = 0;

  for (const delivery of due) {
    const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: delivery.endpointId } });
    if (!endpoint || !endpoint.enabled) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "failed", error: "Endpoint disabled" },
      });
      failed += 1;
      inc("pay_webhook_failures_total", { event: delivery.event });
      continue;
    }

    try {
      await assertPublicUrlResolved(new URL(endpoint.url));

      const response = await fetch(endpoint.url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "x-pay-event": delivery.event,
          "x-pay-delivery-id": delivery.id,
          "x-pay-signature": signature(
            loadWebhookSecret(endpoint.secret),
            delivery.id,
            delivery.event,
            delivery.payload
          ),
        },
        body: delivery.payload,
        signal: AbortSignal.timeout(5000),
      });

      const attempts = delivery.attempts + 1;
      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "delivered", attempts, deliveredAt: new Date(), lastStatus: response.status },
        });
        sent += 1;
        inc("pay_webhook_delivered_total", { event: delivery.event });
      } else if (attempts >= 6) {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: "dead", attempts, lastStatus: response.status, error: `HTTP ${response.status}` },
        });
        failed += 1;
        inc("pay_webhook_failures_total", { event: delivery.event });
      } else {
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            lastStatus: response.status,
            error: `HTTP ${response.status}`,
            nextRetryAt: new Date(Date.now() + 2 ** attempts * 1000),
          },
        });
        failed += 1;
        inc("pay_webhook_failures_total", { event: delivery.event });
      }
    } catch (error) {
      const attempts = delivery.attempts + 1;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          error: error instanceof Error ? error.message : String(error),
          nextRetryAt: attempts >= 6 ? null : new Date(Date.now() + 2 ** attempts * 1000),
          status: attempts >= 6 ? "dead" : "pending",
        },
      });
      failed += 1;
      inc("pay_webhook_failures_total", { event: delivery.event });
    }
  }

  return { sent, failed };
}
