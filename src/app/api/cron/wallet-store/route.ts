import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { verifyCronSecret } from "@/lib/payments/auth";
import { storeWallet } from "@/lib/monero/wallet";

export const dynamic = "force-dynamic";

/** Persist the wallet scan position so restarts resume instead of rescanning. */
export async function POST(request: Request) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }
    const stored = await storeWallet();
    return NextResponse.json({ stored });
  } catch (error) {
    return apiError(error, "Failed to store wallet");
  }
}
