import { prisma } from "@/lib/prisma";
import { getMoneroNetwork } from "@/lib/monero/network";
import { atomicToXmr } from "@/lib/monero/money";
import { paymentLinkView } from "@/lib/api/serialize";

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
      ...paymentLinkView(request),
      transfers: request.transfers.map((transfer) => ({
        txHash: transfer.txid,
        amountXmr: atomicToXmr(transfer.amount),
        amountAtomic: BigInt(transfer.amount).toString(),
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
    "amountAtomic",
    "receivedXmr",
    "receivedAtomic",
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
      payment.amountAtomic,
      payment.receivedXmr,
      payment.receivedAtomic,
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
