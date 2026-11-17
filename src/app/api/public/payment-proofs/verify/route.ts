import { NextResponse } from "next/server";
import { verifyPaymentProof } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Public verification: no account, no session, no personal data required. */
export async function POST(request: Request) {
  try {
    await rateLimit(`proof-verify:${clientId(request)}`, 30, 60_000);
    const body = (await request.json()) as {
      txHash?: string;
      address?: string;
      message?: string;
      signature?: string;
    };

    const result = await verifyPaymentProof(body);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "Failed to verify payment proof");
  }
}
