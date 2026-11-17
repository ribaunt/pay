import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { optionalLabel } from "@/lib/validation";
import { createFreshSubaddress, refreshSubaddressUsage } from "@/lib/monero/wallet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await rateLimit(`subaddress-list:${clientId(request)}`, 60, 60_000);
    return NextResponse.json({ subaddresses: await refreshSubaddressUsage(user.id) });
  } catch (error) {
    return apiError(error, "Failed to list subaddresses");
  }
}

export async function POST(request: Request) {
  try {
    await rateLimit(`subaddress:${clientId(request)}`, 30, 60_000);
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { label?: string };

    const subaddress = await createFreshSubaddress(user.id, optionalLabel(body.label));
    return NextResponse.json({ subaddress }, { status: 201 });
  } catch (error) {
    return apiError(error, "Failed to create subaddress");
  }
}
