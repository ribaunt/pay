import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/auth";
import { verifyApiKey } from "@/lib/payments/auth";
import { cancelPaymentLink } from "@/lib/payments/links";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const key = await verifyApiKey(request, "payment:write");
    if (!key) {
      try {
        await requireUser();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    await rateLimit(`payment-cancel:${key ? `key:${key.id}` : clientId(request)}`, 30, 60_000);

    const { id } = await params;
    return NextResponse.json(await cancelPaymentLink(id, key?.storeId));
  } catch (error) {
    return apiError(error, "Failed to cancel payment");
  }
}
