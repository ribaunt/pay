import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { inc } from "@/lib/metrics";
import { verifyCronSecret } from "@/lib/payments/auth";
import { settlePaymentLinks } from "@/lib/payments/links";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }

    const result = await settlePaymentLinks();
    return NextResponse.json(result);
  } catch (error) {
    inc("pay_settlement_errors_total");
    return apiError(error, "Settlement failed");
  }
}
