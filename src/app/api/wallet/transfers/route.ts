import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getTransfers } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function flag(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;

    const transfers = await getTransfers(user.id, {
      incoming: flag(params.get("incoming"), true),
      outgoing: flag(params.get("outgoing"), true),
      pending: flag(params.get("pending"), true),
      failed: flag(params.get("failed"), false),
      pool: flag(params.get("pool"), false),
    });

    return NextResponse.json({ transfers });
  } catch (error) {
    return apiError(error, "Failed to read transfers");
  }
}
