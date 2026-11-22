import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { verifyCronSecret } from "@/lib/payments/auth";
import { prisma } from "@/lib/prisma";
import { cutoff, retentionPolicy } from "@/lib/retention";

export const dynamic = "force-dynamic";

/** Purges records by category. Opt-in per category; never touches open payments. */
export async function POST(request: Request) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }

    const policy = retentionPolicy();
    const closedAt = cutoff(policy.paymentRequestsDays);

    // Only genuinely terminal records are purged, and only by the timestamp
    // of the terminal event. Using createdAt would erase a link that settled
    // recently after being open for a long time, breaking reconciliation and
    // signed revenue attestations.
    const paymentRequests = prisma.paymentRequest.deleteMany({
      where: {
        OR: [
          { status: "confirmed", paidAt: { lt: closedAt } },
          { status: "cancelled", cancelledAt: { lt: closedAt } },
          { status: "expired", txHash: null, expiresAt: { lt: closedAt } },
        ],
      },
    });

    const webhookDeliveries = prisma.webhookDelivery.deleteMany({
      where: {
        createdAt: { lt: cutoff(policy.webhookDeliveriesDays) },
        status: { in: ["delivered", "dead", "failed"] },
      },
    });

    const rateLimitBuckets = prisma.rateLimitBucket.deleteMany({
      where: { createdAt: { lt: cutoff(policy.rateLimitBucketsDays) } },
    });

    const [payments, deliveries, buckets] = await prisma.$transaction([
      paymentRequests,
      webhookDeliveries,
      rateLimitBuckets,
    ]);

    return NextResponse.json({
      paymentRequests: payments.count,
      webhookDeliveries: deliveries.count,
      rateLimitBuckets: buckets.count,
    });
  } catch (error) {
    return apiError(error, "Retention purge failed");
  }
}
