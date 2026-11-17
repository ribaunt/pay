import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { verifyApiKey } from "@/lib/payments/auth";
import { renderMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const key = await verifyApiKey(request, "metrics:read");
    if (!key) {
      try {
        await requireUser();
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    await rateLimit(`metrics:${key ? `key:${key.id}` : clientId(request)}`, 60, 60_000);

    return new NextResponse(renderMetrics(), {
      headers: { "content-type": "text/plain; version=0.0.4" },
    });
  } catch {
    return NextResponse.json({ error: "Metrics unavailable" }, { status: 500 });
  }
}
