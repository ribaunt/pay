import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { getPaymentLinkStatus } from "@/lib/payments/links";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await rateLimit(`payment-status:${clientId(request)}`, 60, 60_000);
    const { id } = await params;
    const token = request.headers.get("x-status-token");

    const status = await getPaymentLinkStatus(id, token);
    if (!status) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(status);
  } catch (error) {
    return apiError(error, "Failed to read payment status");
  }
}
