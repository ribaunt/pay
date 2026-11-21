import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/auth";
import { verifyApiKey } from "@/lib/payments/auth";
import { createPaymentLink, listPaymentLinks } from "@/lib/payments/links";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const key = await verifyApiKey(request, "payment:read");
    if (!key) {
      try {
        await requireUser();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    await rateLimit(`payment-link-list:${key ? `key:${key.id}` : clientId(request)}`, 60, 60_000);

    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return NextResponse.json({
      links: await listPaymentLinks(status ?? undefined, key?.storeId),
    });
  } catch (error) {
    return apiError(error, "Failed to list payment links");
  }
}

export async function POST(request: Request) {
  try {
    const key = await verifyApiKey(request, "payment:write");
    if (!key) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

    await rateLimit(`payment-link:${key.id}`, 30, 60_000);

    const body = (await request.json()) as {
      fiatAmount?: string;
      fiatCurrency?: string;
      amountXmr?: string;
      timeoutSeconds?: number;
      requiredConfirmations?: number;
      zeroConf?: boolean;
      label?: string;
      description?: string;
    };

    const idempotencyKey = request.headers.get("idempotency-key");
    const link = await createPaymentLink(body, {
      apiKeyId: key.id,
      storeId: key.storeId,
      idempotencyKey,
      requestBody: body,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create payment link");
  }
}
