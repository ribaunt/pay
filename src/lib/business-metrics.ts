import { SINGLE_USER_ID } from "@/lib/auth";
import { setGauge } from "@/lib/metrics";
import { getWalletInfo } from "@/lib/monero/wallet";
import { prisma } from "@/lib/prisma";

/** Refresh gauges that describe the store's payment state, not just its health. */
export async function collectBusinessMetrics(): Promise<void> {
  const results = await Promise.allSettled([
    prisma.paymentRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.webhookDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.subaddress.count(),
    prisma.subaddress.count({ where: { used: true } }),
    prisma.webhookDelivery.count({
      where: { status: "pending", nextRetryAt: { lt: new Date() } },
    }),
    prisma.paymentRequest.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    getWalletInfo(SINGLE_USER_ID),
  ]);

  const statuses = results[0];
  if (statuses.status === "fulfilled") {
    for (const row of statuses.value) {
      setGauge("pay_payment_requests", row._count._all, { status: row.status });
    }
  }

  const webhooks = results[1];
  if (webhooks.status === "fulfilled") {
    for (const row of webhooks.value) {
      setGauge("pay_webhook_queue", row._count._all, { status: row.status });
    }
  }

  if (results[2].status === "fulfilled") {
    setGauge("pay_subaddresses", results[2].value);
  }
  if (results[3].status === "fulfilled") {
    setGauge("pay_subaddresses", results[3].value, { state: "used" });
  }
  if (results[4].status === "fulfilled") {
    setGauge("pay_webhook_overdue", results[4].value);
  }

  const oldest = results[5];
  if (oldest.status === "fulfilled") {
    setGauge(
      "pay_oldest_pending_link_age_seconds",
      oldest.value ? Math.max(0, (Date.now() - oldest.value.createdAt.getTime()) / 1000) : 0
    );
  }

  const wallet = results[6];
  if (wallet.status === "fulfilled") {
    setGauge("pay_wallet_balance_xmr", Number(wallet.value.balanceXmr));
    setGauge("pay_wallet_unlocked_xmr", Number(wallet.value.unlockedBalanceXmr));
    setGauge("pay_wallet_blocks_to_unlock", wallet.value.blocksToUnlock);
  }
}
