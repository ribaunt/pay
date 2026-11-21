import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { getMoneroNetwork } from "@/lib/monero/network";
import { createAttestation } from "@/lib/payments/attestations";

export const dynamic = "force-dynamic";

/**
 * Revenue attestation: totals only. No link IDs, addresses, tx hashes, or
 * customer data are included. Verify offline with the server's signing secret.
 */
export async function GET(request: Request) {
  try {
    await requireUser();
    await rateLimit(`attestation:${clientId(request)}`, 10, 60_000);

    const params = new URL(request.url).searchParams;
    const from = new Date(params.get("from") ?? "1970-01-01T00:00:00.000Z");
    const to = new Date(params.get("to") ?? new Date().toISOString());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const storeId = params.get("storeId");
    const payments = await prisma.paymentRequest.findMany({
      where: {
        status: "confirmed",
        paidAt: { gte: from, lte: to },
        ...(storeId ? { storeId } : {}),
      },
      select: { amount: true, fiatAmount: true, fiatCurrency: true },
    });

    const totalAtomic = payments.reduce((sum, payment) => sum + BigInt(payment.amount), 0n);
    const currencies = new Set(
      payments.map((payment) => payment.fiatCurrency).filter(Boolean)
    );
    const fiatCurrency = currencies.size === 1 ? [...currencies][0] : null;
    const fiatTotal =
      fiatCurrency && payments.every((payment) => payment.fiatAmount)
        ? payments
            .reduce((sum, payment) => sum + Number(payment.fiatAmount), 0)
            .toFixed(2)
        : null;

    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is not configured");

    return NextResponse.json(
      createAttestation({
        from,
        to,
        totalAtomic,
        fiatTotal,
        fiatCurrency,
        confirmedCount: payments.length,
        network: getMoneroNetwork(),
      }, secret)
    );
  } catch (error) {
    return apiError(error, "Failed to build attestation");
  }
}
