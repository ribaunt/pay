import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/api-response";
import { getPaymentConfig } from "@/lib/config";
import { inc } from "@/lib/metrics";
import { SINGLE_USER_ID } from "@/lib/auth";
import { optionalLabel } from "@/lib/validation";
import { atomicToXmr, xmrToAtomic } from "@/lib/monero/money";
import {
  createPaymentRequestAtomic,
  getTransfers,
  getWalletHeight,
  markSubaddressUsed,
} from "@/lib/monero/wallet";
import { fiatToAtomic } from "@/lib/pricing/convert";
import { getPriceQuote } from "@/lib/pricing/oracle";
import { isExpired, resolvePaymentTimeout } from "./timeout";
import { emitWebhook } from "./webhooks";

async function emit(event: string, payload: Record<string, unknown>) {
  try {
    await emitWebhook(event, payload);
  } catch {
    // Webhook failure must never break payment processing.
  }
}

export type CreateLinkInput = {
  fiatAmount?: unknown;
  fiatCurrency?: unknown;
  amountXmr?: unknown;
  timeoutSeconds?: unknown;
  requiredConfirmations?: unknown;
  label?: unknown;
  description?: unknown;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(token: string, hash: string): boolean {
  const left = Buffer.from(hashToken(token));
  const right = Buffer.from(hash);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type CreateLinkOptions = {
  apiKeyId?: string;
  idempotencyKey?: string | null;
  requestBody?: unknown;
};

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function createPaymentLink(input: CreateLinkInput, options: CreateLinkOptions = {}) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: SINGLE_USER_ID } });
  if (!wallet) throw new Error("Wallet is not configured. Complete setup first.");

  const idempotencyKeyHash =
    options.apiKeyId && options.idempotencyKey
      ? hashToken(`${options.apiKeyId}:${options.idempotencyKey}`)
      : null;
  const bodyHash = requestHash(options.requestBody ?? input);

  if (idempotencyKeyHash) {
    const existing = await prisma.paymentRequest.findFirst({
      where: {
        apiKeyId: options.apiKeyId,
        idempotencyKeyHash,
        idempotencyExpiresAt: { gt: new Date() },
      },
    });

    if (existing) {
      if (existing.requestHash !== bodyHash) {
        throw new ConflictError("Idempotency key was already used with a different request");
      }
      if (!existing.responseSnapshot) {
        throw new ConflictError("Original request is still processing");
      }
      return JSON.parse(existing.responseSnapshot);
    }
  }

  let atomic: bigint;
  let fiatData: {
    fiatAmount: string | null;
    fiatCurrency: string | null;
    rateUsd: string | null;
    fxRate: string | null;
    rateSources: string | null;
    rateFetchedAt: Date | null;
    rateStale: boolean;
    rateDegraded: boolean;
  } = {
    fiatAmount: null,
    fiatCurrency: null,
    rateUsd: null,
    fxRate: null,
    rateSources: null,
    rateFetchedAt: null,
    rateStale: false,
    rateDegraded: false,
  };

  if (input.fiatAmount !== undefined && input.fiatAmount !== null && input.fiatAmount !== "") {
    if (typeof input.fiatAmount !== "string" || !/^\d+(\.\d{1,12})?$/.test(input.fiatAmount)) {
      throw new Error("Invalid fiatAmount");
    }
    if (typeof input.fiatCurrency !== "string") throw new Error("fiatCurrency is required");

    const currency = input.fiatCurrency.trim().toUpperCase();
    const quote = await getPriceQuote(currency);
    atomic = fiatToAtomic(input.fiatAmount, quote.usdPerXmr, quote.fiatPerUsd);

    fiatData = {
      fiatAmount: input.fiatAmount,
      fiatCurrency: currency,
      rateUsd: quote.usdPerXmr.toString(),
      fxRate: quote.fiatPerUsd.toString(),
      rateSources: quote.sources.join(","),
      rateFetchedAt: new Date(quote.fetchedAt),
      rateStale: quote.stale,
      rateDegraded: quote.degraded,
    };
  } else if (input.amountXmr !== undefined) {
    atomic = xmrToAtomic(String(input.amountXmr));
  } else {
    throw new Error("fiatAmount or amountXmr is required");
  }

  let requiredConfirmations: number | null = null;
  if (input.requiredConfirmations !== undefined && input.requiredConfirmations !== null) {
    const value = Number(input.requiredConfirmations);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new Error("Invalid requiredConfirmations");
    }
    requiredConfirmations = value;
  }

  const label = optionalLabel(input.label) ?? "payment";
  const { expiresAt } = resolvePaymentTimeout(input.timeoutSeconds);
  const token = randomBytes(32).toString("base64url");

  let reservation;
  try {
    reservation = await prisma.paymentRequest.create({
      data: {
        walletId: wallet.id,
        address: "",
        amount: "",
        uri: "",
        status: "processing",
        label,
        expiresAt,
        publicTokenHash: hashToken(token),
        apiKeyId: options.apiKeyId ?? null,
        idempotencyKeyHash,
        requestHash: idempotencyKeyHash ? bodyHash : null,
        idempotencyExpiresAt: idempotencyKeyHash ? new Date(Date.now() + 86_400_000) : null,
        requiredConfirmations,
        ...fiatData,
      },
    });
  } catch (error) {
    if (!idempotencyKeyHash || !isUniqueViolation(error)) throw error;

    const existing = await prisma.paymentRequest.findFirst({
      where: { apiKeyId: options.apiKeyId, idempotencyKeyHash },
    });
    if (!existing || existing.requestHash !== bodyHash || !existing.responseSnapshot) {
      throw new ConflictError("Duplicate idempotency key with a different request");
    }
    return JSON.parse(existing.responseSnapshot);
  }

  try {
    const request = await createPaymentRequestAtomic(SINGLE_USER_ID, atomic, label);

    const response = {
      id: reservation.id,
      uri: request.uri,
      address: request.address,
      amountXmr: atomicToXmr(atomic),
      amountAtomic: request.amountAtomic,
      fiatAmount: reservation.fiatAmount,
      fiatCurrency: reservation.fiatCurrency,
      rateUsd: reservation.rateUsd,
      rateSources: reservation.rateSources,
      requiredConfirmations: reservation.requiredConfirmations,
      status: "pending",
      expiresAt: reservation.expiresAt,
      statusUrl: `/api/payment-links/${reservation.id}/status`,
      statusToken: token,
    };

    await prisma.paymentRequest.update({
      where: { id: reservation.id },
      data: {
        address: request.address,
        amount: request.amountAtomic,
        uri: request.uri,
        status: "pending",
        responseSnapshot: idempotencyKeyHash ? JSON.stringify(response) : null,
      },
    });

    inc("pay_payment_links_created_total");
    await emit("payment.created", {
      id: reservation.id,
      amountXmr: response.amountXmr,
      expiresAt: response.expiresAt,
    });

    return response;
  } catch (error) {
    await prisma.paymentRequest.delete({ where: { id: reservation.id } }).catch(() => {});
    throw error;
  }
}

export async function getPaymentLinkStatus(id: string, token: string | null) {
  if (!token) return null;

  const record = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!record?.publicTokenHash || !tokenMatches(token, record.publicTokenHash)) return null;

  return {
    id: record.id,
    status: record.status,
    amountXmr: atomicToXmr(record.amount),
    amountAtomic: record.amount,
    fiatAmount: record.fiatAmount,
    fiatCurrency: record.fiatCurrency,
    expiresAt: record.expiresAt,
    paidAt: record.paidAt,
    cancelledAt: record.cancelledAt,
    lateDetectedAt: record.lateDetectedAt,
    txHash: record.txHash,
    confirmations: record.confirmations,
    receivedAtomic: record.receivedAtomic,
    receivedXmr: record.receivedAtomic ? atomicToXmr(record.receivedAtomic) : null,
    requiredConfirmations:
      record.requiredConfirmations ?? getPaymentConfig().requiredConfirmations,
    confirmationsRemaining: Math.max(
      0,
      (record.requiredConfirmations ?? getPaymentConfig().requiredConfirmations) -
        record.confirmations
    ),
  };
}

/** Cancel only a waiting request with no observed transaction. */
export async function cancelPaymentLink(id: string) {
  const result = await prisma.paymentRequest.updateMany({
    where: {
      id,
      status: "pending",
      txHash: null,
      paidAt: null,
    },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new ConflictError("Payment can only be cancelled while it is waiting for a transaction");
  }

  await emit("payment.cancelled", { id });
  return { id, status: "cancelled" };
}

export async function renewPaymentLink(id: string) {
  const previous = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!previous) throw new ConflictError("Payment not found");
  if (previous.status !== "expired") {
    throw new ConflictError("Only expired payments can be renewed");
  }
  if (previous.txHash || previous.paidAt) {
    throw new ConflictError("Payment already has a transaction and cannot be renewed");
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: SINGLE_USER_ID } });
  if (!wallet) throw new Error("Wallet is not configured. Complete setup first.");

  let atomic = BigInt(previous.amount);
  let quoteData: {
    rateUsd: string | null;
    fxRate: string | null;
    rateSources: string | null;
    rateFetchedAt: Date | null;
    rateStale: boolean;
    rateDegraded: boolean;
  } = {
    rateUsd: previous.rateUsd,
    fxRate: previous.fxRate,
    rateSources: previous.rateSources,
    rateFetchedAt: previous.rateFetchedAt,
    rateStale: previous.rateStale,
    rateDegraded: previous.rateDegraded,
  };

  if (previous.fiatAmount && previous.fiatCurrency) {
    const quote = await getPriceQuote(previous.fiatCurrency);
    atomic = fiatToAtomic(previous.fiatAmount, quote.usdPerXmr, quote.fiatPerUsd);
    quoteData = {
      rateUsd: quote.usdPerXmr.toString(),
      fxRate: quote.fiatPerUsd.toString(),
      rateSources: quote.sources.join(","),
      rateFetchedAt: new Date(quote.fetchedAt),
      rateStale: quote.stale,
      rateDegraded: quote.degraded,
    };
  }

  const request = await createPaymentRequestAtomic(
    SINGLE_USER_ID,
    atomic,
    previous.label ?? "payment"
  );
  const token = randomBytes(32).toString("base64url");
  const { expiresAt } = resolvePaymentTimeout(undefined);

  const record = await prisma.paymentRequest.create({
    data: {
      walletId: wallet.id,
      address: request.address,
      amount: request.amountAtomic,
      uri: request.uri,
      label: previous.label,
      expiresAt,
      publicTokenHash: hashToken(token),
      fiatAmount: previous.fiatAmount,
      fiatCurrency: previous.fiatCurrency,
      ...quoteData,
      requiredConfirmations: previous.requiredConfirmations,
      renewedFromId: previous.id,
      apiKeyId: previous.apiKeyId,
    },
  });

  await emit("payment.renewed", { id: record.id, fromId: previous.id });

  return {
    id: record.id,
    uri: record.uri,
    address: record.address,
    amountXmr: atomicToXmr(atomic),
    amountAtomic: record.amount,
    status: record.status,
    expiresAt: record.expiresAt,
    statusUrl: `/api/payment-links/${record.id}/status`,
    statusToken: token,
  };
}

export async function listPaymentLinks(status?: string) {
  return prisma.paymentRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function settlePaymentLinks() {
  const defaultConfirmations = getPaymentConfig().requiredConfirmations;

  const active = await prisma.paymentRequest.findMany({
    where: {
      status: {
        in: [
          "pending",
          "detected",
          "confirming",
          "expired",
          "late",
          "underpaid",
          "overpaid",
        ],
      },
    },
    take: 200,
  });
  if (active.length === 0) return { processed: 0 };

  const transfers = await getTransfers(SINGLE_USER_ID, { incoming: true, pool: true });
  const height = await getWalletHeight().catch(() => 0);

  for (const request of active) {
    const seen = new Set<string>();
    const candidates = transfers
      .filter(
        (transfer) => transfer.txid === request.txHash || transfer.address === request.address
      )
      .filter((transfer) => {
        if (seen.has(transfer.txid)) return false;
        seen.add(transfer.txid);
        return true;
      });

    if (candidates.length > 0) {
      for (const transfer of candidates) {
        const amountAtomic = xmrToAtomic(transfer.amountXmr);

        await prisma.paymentRequestTransfer.upsert({
          where: {
            paymentRequestId_txid: { paymentRequestId: request.id, txid: transfer.txid },
          },
          update: { blockHeight: transfer.blockHeight, amount: amountAtomic.toString() },
          create: {
            paymentRequestId: request.id,
            txid: transfer.txid,
            amount: amountAtomic.toString(),
            blockHeight: transfer.blockHeight,
          },
        });
      }

      const expected = BigInt(request.amount);
      const received = candidates.reduce((sum, transfer) => {
        return sum + xmrToAtomic(transfer.amountXmr);
      }, 0n);
      const highestBlock = Math.max(0, ...candidates.map((transfer) => transfer.blockHeight));
      const confirmations = highestBlock > 0 && height > 0 ? height - highestBlock + 1 : 0;
      const required = request.requiredConfirmations ?? defaultConfirmations;
      const isLate = request.status === "expired" || request.status === "late";

      let status: string;
      if (isLate) status = "late";
      else if (received < expected) status = "underpaid";
      else if (received > expected && confirmations < required) status = "overpaid";
      else if (confirmations >= required) status = "confirmed";
      else status = confirmations > 0 ? "confirming" : "detected";

      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: {
          txHash: request.txHash ?? candidates[0].txid,
          paidAt: request.paidAt ?? new Date(),
          confirmations,
          status,
          receivedAtomic: received.toString(),
          ...(isLate && !request.lateDetectedAt ? { lateDetectedAt: new Date() } : {}),
        },
      });

      await markSubaddressUsed(request.walletId, request.address);

      if (status !== request.status) {
        inc("pay_payment_status_transitions_total", { status });
        await emit(`payment.${status}`, {
          id: request.id,
          txHash: candidates[0].txid,
          confirmations,
          receivedAtomic: received.toString(),
        });
      }
      continue;
    }

    if (request.status === "pending" && isExpired(request.expiresAt)) {
      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      await emit("payment.expired", { id: request.id });
    }
  }

  return { processed: active.length };
}
