import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { verifyApiKey } from "@/lib/payments/auth";
import { registerWebhook } from "@/lib/payments/webhooks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    let apiKeyId: string | null = null;
    const key = await verifyApiKey(request, "webhook:read");
    if (key) apiKeyId = key.id;
    else await requireUser();

    await rateLimit(`webhook-list:${key ? `key:${key.id}` : clientId(request)}`, 60, 60_000);

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: apiKeyId ? { apiKeyId } : key?.storeId ? { storeId: key.storeId } : undefined,
      select: { id: true, url: true, events: true, enabled: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ webhooks: endpoints });
  } catch (error) {
    return apiError(error, "Failed to list webhooks");
  }
}

export async function POST(request: Request) {
  try {
    const key = await verifyApiKey(request, "webhook:write");
    if (!key) await requireUser();
    await rateLimit(`webhook-create:${key ? `key:${key.id}` : clientId(request)}`, 10, 60_000);

    const body = (await request.json()) as { url?: string; events?: string };
    if (!body.url) return NextResponse.json({ error: "url is required" }, { status: 400 });

    const webhook = await registerWebhook({
      url: body.url,
      events: body.events,
      apiKeyId: key?.id ?? null,
      storeId: key?.storeId ?? null,
    });
    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to register webhook");
  }
}
