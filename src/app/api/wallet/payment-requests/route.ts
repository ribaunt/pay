import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createPaymentRequest } from "@/lib/monero/wallet";
import { apiError } from "@/lib/api-response";
import { clientId, rateLimit } from "@/lib/rate-limit";
import { optionalLabel, requireXmrAmount } from "@/lib/validation";
import { resolvePaymentTimeout } from "@/lib/payments/timeout";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await rateLimit(`payment:${clientId(request)}`, 30, 60_000);
    const user = await requireUser();

    const body = (await request.json()) as { amountXmr?: string; label?: string };
    if (!body.amountXmr) {
      return NextResponse.json({ error: "amountXmr is required" }, { status: 400 });
    }

    const label = optionalLabel(body.label);
    const { expiresAt } = resolvePaymentTimeout(
      (body as { timeoutSeconds?: number }).timeoutSeconds
    );
    const payment = await createPaymentRequest(
      user.id,
      requireXmrAmount(body.amountXmr),
      label
    );

    const config = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!config) throw new Error("No wallet configured for this user");

    await prisma.subaddress.upsert({
      where: {
        walletId_addressIndex: {
          walletId: config.id,
          addressIndex: payment.addressIndex,
        },
      },
      update: { label: payment.label },
      create: {
        walletId: config.id,
        address: payment.address,
        addressIndex: payment.addressIndex,
        label: payment.label,
      },
    });

    const record = await prisma.paymentRequest.create({
      data: {
        walletId: config.id,
        address: payment.address,
        amount: payment.amountAtomic,
        uri: payment.uri,
        label: payment.label,
        expiresAt,
      },
    });

    return NextResponse.json(
      {
        payment: {
          ...record,
          amountXmr: payment.amountXmr,
          addressIndex: payment.addressIndex,
          expiresAt: record.expiresAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return apiError(error, "Failed to create payment request");
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const requests = await prisma.paymentRequest.findMany({
      where: { wallet: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ requests });
  } catch (error) {
    return apiError(error, "Failed to list payment requests");
  }
}
