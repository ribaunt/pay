import { NextResponse } from "next/server";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyApiKey } from "@/lib/payments/auth";
import { getPaymentLinkStatus, listPaymentLinks } from "@/lib/payments/links";
import { paymentLinkView } from "@/lib/api/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 1_000;
const MAX_STREAM_MS = 5 * 60_000;
const HEARTBEAT_EVERY = 15;

type Snapshot = { id: string; status: string; confirmations: number; receivedAtomic: string | null };

function snapshot(link: { id: string; status: string; confirmations: number; receivedAtomic: string | null }): Snapshot {
  return {
    id: link.id,
    status: link.status,
    confirmations: link.confirmations,
    receivedAtomic: link.receivedAtomic,
  };
}

function same(a: Snapshot | undefined, b: Snapshot): boolean {
  return Boolean(
    a &&
      a.id === b.id &&
      a.status === b.status &&
      a.confirmations === b.confirmations &&
      a.receivedAtomic === b.receivedAtomic
  );
}

/**
 * Server-sent events for payment-link transitions. Clients can subscribe to a
 * single link with its status token, or to all links with an API key/session.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const linkId = url.searchParams.get("linkId");
  // Bearer token travels in a header so it never lands in URLs, proxy logs,
  // browser history or Referer headers.
  const token = request.headers.get("x-status-token");

  if (linkId && token) {
    const status = await getPaymentLinkStatus(linkId, token);
    if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });
  } else {
    const key = await verifyApiKey(request, "payment:read");
    if (!key) {
      try {
        await requireUser();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    await rateLimit(`events:${clientId(request)}`, 60, 60_000);
  }

  const encoder = new TextEncoder();
  const key = linkId ? null : await verifyApiKey(request, "payment:read");
  let last = new Map<string, Snapshot>();
  let ticks = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const poll = async () => {
        if (request.signal.aborted) return;
        try {
          let links;
          if (linkId && token) {
            const status = await getPaymentLinkStatus(linkId, token);
            links = status ? [status] : [];
          } else {
            links = await listPaymentLinks(undefined, key?.storeId);
          }

          const current = new Map<string, Snapshot>();
          for (const link of links) {
            const item = snapshot(link);
            current.set(item.id, item);
            if (!same(last.get(item.id), item)) {
              send("payment.update", paymentLinkView({ ...link, amount: link.amountAtomic }));
            }
          }
          for (const id of last.keys()) {
            if (!current.has(id)) send("payment.removed", { id });
          }
          last = current;

          ticks += 1;
          if (ticks % HEARTBEAT_EVERY === 0) controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // Transient DB errors must not kill the stream.
        }
      };

      await poll();
      const interval = setInterval(poll, POLL_MS);
      const stop = setTimeout(() => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }, MAX_STREAM_MS);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        clearTimeout(stop);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
