import { prisma } from "@/lib/prisma";
import { walletRpcPing } from "@/lib/monero/rpc";
import { getMoneroNetwork } from "@/lib/monero/network";
import { getWalletHeight } from "@/lib/monero/wallet";
import { getDaemonHeight } from "@/lib/monero/daemon";
import { getPaymentConfig } from "@/lib/config";
import { setGauge } from "@/lib/metrics";
import { collectBusinessMetrics } from "@/lib/business-metrics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const [db, walletRpc] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    walletRpcPing(),
  ]);

  let daemon = false;
  let walletHeight = 0;
  let daemonHeight = 0;

  if (walletRpc) {
    const results = await Promise.allSettled([getDaemonHeight(), getWalletHeight()]);
    if (results[0].status === "fulfilled") {
      daemon = true;
      daemonHeight = results[0].value;
    }
    if (results[1].status === "fulfilled") walletHeight = results[1].value;
  }

  const syncLag = Math.max(0, daemonHeight - walletHeight);
  const maxLag = getPaymentConfig().maxSyncLagBlocks;
  const syncStatus =
    !daemon || walletHeight === 0
      ? "unavailable"
      : syncLag > maxLag
        ? "syncing"
        : "synced";

  setGauge("pay_db_up", db ? 1 : 0);
  setGauge("pay_wallet_rpc_up", walletRpc ? 1 : 0);
  setGauge("pay_daemon_up", daemon ? 1 : 0);
  setGauge("pay_wallet_height", walletHeight);
  setGauge("pay_daemon_height", daemonHeight);
  setGauge("pay_wallet_sync_lag_blocks", syncLag);
  await collectBusinessMetrics();

  const healthy = db && walletRpc && daemon;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      network: getMoneroNetwork(),
      accessMode: process.env.ACCESS_MODE ?? "clearnet",
      remoteNode: {
        configured: Boolean(process.env.MONERO_DAEMON_ADDRESS),
        mode: process.env.MONERO_DAEMON_MODE ?? "full-scan",
        proxy: process.env.MONERO_DAEMON_PROXY ? "socks5" : "none",
        viewKeySentToDaemon: false,
        lightWallet: false,
      },
      services: { db, walletRpc, daemon },
      sync: { walletHeight, daemonHeight, syncLag, status: syncStatus },
    },
    { status: healthy ? 200 : 503 }
  );
}
