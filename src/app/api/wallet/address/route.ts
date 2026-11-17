import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPrimaryAddress } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ address: await getPrimaryAddress(user.id) });
  } catch (error) {
    return apiError(error, "Failed to read address");
  }
}
