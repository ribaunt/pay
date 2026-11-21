import { prisma } from "@/lib/prisma";
import { walletRpcPing } from "@/lib/monero/rpc";
import { getMoneroNetwork } from "@/lib/monero/network";
import { getWalletHeight } from "@/lib/monero/wallet";
import { getDaemonHeight } from "@/lib/monero/daemon";
import { getPaymentConfig } from "@/lib/config";
import { evaluateHealth } from "@/lib/health";
import { setGauge } from "@/lib/metrics";
import { collectBusinessMetrics } from "@/lib/business-metrics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// A busy wallet RPC (e.g. during initial full-scan sync) can take longer than
// a few seconds to answer even get_version. Keep this generous so a live but
// busy RPC is not reported as down.
const HEALTH_TIMEOUT_MS = 20_000;

let lastRpcUpAt = 0;

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
  const [db, rpcNow] = await Promise.all([
    within(prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false), false),
    within(walletRpcPing(), false),
  ]);
  if (rpcNow) lastRpcUpAt = Date.now();

  // Query the daemon independently. Previously a slow RPC also made the daemon
  // look down, which turned a busy-but-alive node into a degraded health check.
  const [daemonHeight, walletHeight] = await Promise.all([
    within(getDaemonHeight(), 0),
    rpcNow ? within(getWalletHeight().catch(() => 0), 0) : Promise.resolve(0),
  ]);
  const daemon = daemonHeight > 0;

  const config = getPaymentConfig();
  const evaluation = evaluateHealth({
    db,
    rpcNow,
    lastRpcUpAt,
    daemon,
    walletHeight,
    daemonHeight,
    maxSyncLagBlocks: config.maxSyncLagBlocks,
  });
  const { walletRpc, healthy, syncStatus, syncLag } = evaluation;

  setGauge("pay_db_up", db ? 1 : 0);
  // Keep the last good value on transient timeouts: a busy RPC is not a dead
  // RPC, and zeroing these gauges makes dashboards flap during initial sync.
  if (walletRpc) setGauge("pay_wallet_rpc_up", 1);
  if (daemon) setGauge("pay_daemon_up", 1);
  if (walletHeight > 0) setGauge("pay_wallet_height", walletHeight);
  if (daemonHeight > 0) setGauge("pay_daemon_height", daemonHeight);
  setGauge("pay_wallet_sync_lag_blocks", syncLag);
  await within(collectBusinessMetrics(), undefined, 1_500);

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
