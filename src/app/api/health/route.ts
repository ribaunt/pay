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

// A busy wallet RPC (e.g. during initial full-scan sync) can take longer than
// a few seconds to answer even get_version. Keep this generous so a live but
// busy RPC is not reported as down.
const HEALTH_TIMEOUT_MS = 20_000;

/** Never let a busy wallet RPC hold the health endpoint open. */
async function within<T>(promise: Promise<T>, fallback: T, ms = HEALTH_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const [db, walletRpc] = await Promise.all([
    within(prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false), false),
    within(walletRpcPing(), false),
  ]);

  let daemon = false;
  let walletHeight = 0;
  let daemonHeight = 0;

  if (walletRpc) {
    const results = await Promise.allSettled([
      within(getDaemonHeight(), 0),
      within(getWalletHeight(), 0),
    ]);
    if (results[0].status === "fulfilled" && results[0].value > 0) {
      daemon = true;
      daemonHeight = results[0].value;
    }
    if (results[1].status === "fulfilled" && results[1].value > 0) {
      walletHeight = results[1].value;
    }
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
  // Keep the last good value on transient timeouts: a busy RPC is not a dead
  // RPC, and zeroing these gauges makes dashboards flap during initial sync.
  if (walletRpc) setGauge("pay_wallet_rpc_up", 1);
  if (daemon) setGauge("pay_daemon_up", 1);
  if (walletHeight > 0) setGauge("pay_wallet_height", walletHeight);
  if (daemonHeight > 0) setGauge("pay_daemon_height", daemonHeight);
  setGauge("pay_wallet_sync_lag_blocks", syncLag);
  await within(collectBusinessMetrics(), undefined, 1_500);

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
