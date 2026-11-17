import { prisma } from "@/lib/prisma";
import { getMoneroNetwork } from "@/lib/monero/network";
import { atomicToXmr } from "@/lib/monero/money";

export async function getAuditReport(userId: string) {
  const [wallet, requests] = await Promise.all([
    prisma.wallet.findUnique({
      where: { userId },
      select: { address: true, restoreHeight: true, isWatchOnly: true },
    }),
    prisma.paymentRequest.findMany({
      where: { wallet: { userId } },
      include: { transfers: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    network: getMoneroNetwork(),
    wallet: {
      address: wallet?.address ?? null,
      restoreHeight: wallet?.restoreHeight ?? null,
      isWatchOnly: wallet?.isWatchOnly ?? false,
    },
    payments: requests.map((request) => ({
      id: request.id,
      label: request.label,
      status: request.status,
      address: request.address,
      amountXmr: atomicToXmr(request.amount),
      amountAtomic: request.amount,
      receivedXmr: request.receivedAtomic ? atomicToXmr(request.receivedAtomic) : null,
      fiatAmount: request.fiatAmount,
      fiatCurrency: request.fiatCurrency,
      txHash: request.txHash,
      confirmations: request.confirmations,
      createdAt: request.createdAt.toISOString(),
      paidAt: request.paidAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      transfers: request.transfers.map((transfer) => ({
        txid: transfer.txid,
        amountXmr: atomicToXmr(transfer.amount),
        blockHeight: transfer.blockHeight,
        createdAt: transfer.createdAt.toISOString(),
      })),
    })),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditToCsv(report: Awaited<ReturnType<typeof getAuditReport>>): string {
  const headers = [
    "id",
    "label",
    "status",
    "address",
    "amountXmr",
    "receivedXmr",
    "fiatAmount",
    "fiatCurrency",
    "txHash",
    "confirmations",
    "createdAt",
    "paidAt",
    "network",
  ];

  const rows = report.payments.map((payment) =>
    [
      payment.id,
      payment.label,
      payment.status,
      payment.address,
      payment.amountXmr,
      payment.receivedXmr,
      payment.fiatAmount,
      payment.fiatCurrency,
      payment.txHash,
      payment.confirmations,
      payment.createdAt,
      payment.paidAt,
      report.network,
    ]
      .map(csvCell)
      .join(",")
  );

  return `${headers.join(",")}\n${rows.join("\n")}\n`;
}
