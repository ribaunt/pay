import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPaymentConfig } from "@/lib/config";
import { getWalletHeight } from "@/lib/monero/wallet";
import { getDaemonHeight } from "@/lib/monero/daemon";
import { computeSyncProgress } from "@/lib/sync";

export const dynamic = "force-dynamic";

// In-memory rate sample. /api/sync is a progress view, not a source of truth.
let previous: { height: number; at: number } | undefined;

export async function GET() {
  const [config, wallet] = await Promise.all([
    Promise.resolve(getPaymentConfig()),
    prisma.wallet.findFirst({ select: { restoreHeight: true } }),
  ]);

  const walletHeight = await getWalletHeight().catch(() => 0);
  const daemonHeight = await getDaemonHeight().catch(() => 0);
  const now = Date.now();

  const progress = computeSyncProgress({
    restoreHeight: wallet?.restoreHeight ?? null,
    walletHeight,
    daemonHeight,
    maxSyncLagBlocks: config.maxSyncLagBlocks,
    previousHeight: previous?.height,
    previousAt: previous?.at,
    now,
  });

  if (walletHeight > 0) previous = { height: walletHeight, at: now };

  return NextResponse.json(progress);
}
