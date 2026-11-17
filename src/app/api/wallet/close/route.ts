import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { closeWallet } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireUser();
    await closeWallet();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "Failed to close wallet");
  }
}
