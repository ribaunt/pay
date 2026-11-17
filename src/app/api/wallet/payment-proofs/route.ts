import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createPaymentProof, listPaymentProofs } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await rateLimit(`proof:${clientId(request)}`, 30, 60_000);
    const user = await requireUser();
    const body = (await request.json()) as {
      txHash?: string;
      address?: string;
      message?: string;
    };

    const proof = await createPaymentProof(user.id, body);
    return NextResponse.json({ proof }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create payment proof");
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ proofs: await listPaymentProofs(user.id) });
  } catch (error) {
    return apiError(error, "Failed to list payment proofs");
  }
}
