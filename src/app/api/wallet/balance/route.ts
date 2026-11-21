import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getWalletInfo } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const {
      balanceXmr,
      balanceAtomic,
      unlockedBalanceXmr,
      unlockedBalanceAtomic,
      blocksToUnlock,
    } = await getWalletInfo(user.id);
    return NextResponse.json({
      balanceXmr,
      balanceAtomic,
      unlockedBalanceXmr,
      unlockedBalanceAtomic,
      blocksToUnlock,
    });
  } catch (error) {
    return apiError(error, "Failed to read balance");
  }
}
