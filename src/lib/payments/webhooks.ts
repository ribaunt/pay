import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { inc } from "@/lib/metrics";
import { decryptSecret, encryptSecret, WEBHOOK_SECRET_PURPOSE } from "@/lib/crypto";
import { assertPublicUrl, postPinned, resolvePublicAddress } from "@/lib/ssrf";
import { redact } from "@/lib/redact";

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

const EVENT_NAMES = new Set<string>(WEBHOOK_EVENTS);

/** Normalize a comma-separated event list and reject unknown names. */
export function normalizeEvents(raw?: string): string {
  const value = raw?.trim();
  if (!value || value === "*") return "*";

  const events = value.split(",").map((item) => item.trim());
  for (const event of events) {
    if (!EVENT_NAMES.has(event)) throw new Error(`Invalid webhook event: ${event || "(empty)"}`);
  }
  return events.join(",");
}

function loadWebhookSecret(value: string, endpointId: string): string {
  return value.startsWith("v1.") || value.startsWith("v2.")
    ? decryptSecret(value, WEBHOOK_SECRET_PURPOSE, endpointId)
    : value;
}

export async function registerWebhook(options: {
  url: string;
  events?: string;
  apiKeyId?: string | null;
  storeId?: string | null;
}) {
  const target = assertPublicUrl(options.url);
  await resolvePublicAddress(target.hostname);

  const events = normalizeEvents(options.events);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const endpointId = randomUUID();

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      id: endpointId,
      url: target.url.toString(),
      events,
      secret: encryptSecret(secret, WEBHOOK_SECRET_PURPOSE, endpointId),
      apiKeyId: options.apiKeyId ?? null,
      storeId: options.storeId ?? null,
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
  const storeId = typeof payload.storeId === "string" ? payload.storeId : null;
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      enabled: true,
      ...(storeId ? { OR: [{ storeId: null }, { storeId }] } : { storeId: null }),
    },
  });
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });

  const matching = endpoints.filter(
    (endpoint) =>
      endpoint.events === "*" ||
      endpoint.events.split(",").some((name) => name.trim() === event)
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
      // Revalidate and pin on every delivery: validating at registration is not
      // enough because DNS can change between validation and connection.
      const target = assertPublicUrl(endpoint.url);
      const pinned = await resolvePublicAddress(target.hostname);
      const response = await postPinned(
        target,
        pinned,
        {
          "content-type": "application/json",
          "x-pay-event": delivery.event,
          "x-pay-delivery-id": delivery.id,
          "x-pay-signature": signature(
            loadWebhookSecret(endpoint.secret, endpoint.id),
            delivery.id,
            delivery.event,
            delivery.payload
          ),
        },
        delivery.payload
      );

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
        inc("pay_webhook_retries_total", { event: delivery.event });
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
        inc("pay_webhook_retries_total", { event: delivery.event });
        failed += 1;
        inc("pay_webhook_failures_total", { event: delivery.event });
      }
    } catch (error) {
      const attempts = delivery.attempts + 1;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          error: redact(error instanceof Error ? error.message : String(error)),
          nextRetryAt: attempts >= 6 ? null : new Date(Date.now() + 2 ** attempts * 1000),
          status: attempts >= 6 ? "dead" : "pending",
        },
      });
      failed += 1;
      inc("pay_webhook_failures_total", { event: delivery.event });
      if (attempts < 6) inc("pay_webhook_retries_total", { event: delivery.event });
    }
  }

  return { sent, failed };
}
