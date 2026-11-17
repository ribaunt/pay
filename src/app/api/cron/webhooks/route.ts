import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { verifyCronSecret } from "@/lib/payments/auth";
import { dispatchWebhooks } from "@/lib/payments/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }
    return NextResponse.json(await dispatchWebhooks());
  } catch (error) {
    return apiError(error, "Webhook dispatch failed");
  }
}
