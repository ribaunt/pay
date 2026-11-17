import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setupWatchOnlyWallet } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await rateLimit(`setup:${clientId(request)}`, 5, 60_000);
    const user = await requireUser();

    const body = (await request.json()) as {
      address?: string;
      viewKey?: string;
      restoreHeight?: number | string;
      description?: string;
    };

    if (!body.address || !body.viewKey) {
      return NextResponse.json(
        { error: "address and viewKey are required" },
        { status: 400 }
      );
    }

    const wallet = await setupWatchOnlyWallet(user.id, body);
    return NextResponse.json({ wallet });
  } catch (error) {
    return apiError(error, "Failed to set up watch-only wallet");
  }
}
