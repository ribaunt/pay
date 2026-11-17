import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { getSupportedCurrencies } from "@/lib/pricing/oracle";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await rateLimit(`currencies:${clientId(request)}`, 60, 60_000);
    return NextResponse.json({ currencies: await getSupportedCurrencies() });
  } catch (error) {
    return apiError(error, "Failed to list currencies");
  }
}
