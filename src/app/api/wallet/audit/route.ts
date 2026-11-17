import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { verifyApiKey } from "@/lib/payments/auth";
import { auditToCsv, getAuditReport } from "@/lib/payments/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const key = await verifyApiKey(request, "payment:read");
    let userId: string;
    if (key) {
      // The single-user model has one account; API-key access is read-only.
      userId = "single-user";
    } else {
      userId = (await requireUser()).id;
    }

    await rateLimit(`audit:${key ? `key:${key.id}` : clientId(request)}`, 30, 60_000);

    const format = new URL(request.url).searchParams.get("format") ?? "json";
    const report = await getAuditReport(userId);

    if (format === "csv") {
      return new NextResponse(auditToCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="pay-audit.csv"',
        },
      });
    }

    return NextResponse.json(report);
  } catch (error) {
    return apiError(error, "Failed to build audit report");
  }
}
