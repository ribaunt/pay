import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/api-response";
import { getPaymentConfig } from "@/lib/config";
import { inc, observe } from "@/lib/metrics";
import { SINGLE_USER_ID } from "@/lib/auth";
import { optionalLabel } from "@/lib/validation";
import { paymentEventData, paymentLinkView } from "@/lib/api/serialize";
import { xmrToAtomic } from "@/lib/monero/money";
import {
  createPaymentRequestAtomic,
  getTransfersSince,
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
  zeroConf?: unknown;
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
  storeId?: string | null;
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
  const [wallet, store] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: SINGLE_USER_ID } }),
    options.storeId
      ? prisma.store.findUnique({ where: { id: options.storeId } })
      : Promise.resolve(null),
  ]);
  if (!wallet) throw new Error("Wallet is not configured. Complete setup first.");
  if (options.storeId && !store) throw new Error("API key references an unknown store");
  const accountIndex = store?.accountIndex ?? 0;

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

  let zeroConf = false;
  if (input.zeroConf !== undefined && input.zeroConf !== null) {
    if (typeof input.zeroConf !== "boolean") throw new Error("Invalid zeroConf");
    if (input.zeroConf && !getPaymentConfig().allowZeroConf) {
      throw new Error("Zero-confirmation links are disabled on this server");
    }
    zeroConf = input.zeroConf;
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
        storeId: options.storeId ?? null,
        idempotencyKeyHash,
        requestHash: idempotencyKeyHash ? bodyHash : null,
        idempotencyExpiresAt: idempotencyKeyHash ? new Date(Date.now() + 86_400_000) : null,
        requiredConfirmations,
        zeroConf,
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
    const request = await createPaymentRequestAtomic(SINGLE_USER_ID, atomic, label, accountIndex);

    const created = {
      ...reservation,
      address: request.address,
      uri: request.uri,
      amount: request.amountAtomic,
      status: "pending",
    };
    const response = {
      ...paymentLinkView(created),
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
    await emit("payment.created", paymentEventData(created));

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

  return paymentLinkView(record);
}

/** Cancel only a waiting request with no observed transaction. */
export async function cancelPaymentLink(id: string, storeId?: string | null) {
  if (storeId) {
    const own = await prisma.paymentRequest.findFirst({
      where: { id, storeId },
      select: { id: true },
    });
    if (!own) throw new NotFoundError("Payment not found");
  }

  const result = await prisma.paymentRequest.updateMany({
    where: {
      id,
      ...(storeId ? { storeId } : {}),
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

  const record = await prisma.paymentRequest.findUnique({ where: { id } });
  const cancelled = {
    ...(record ?? { id, amount: "0" }),
    status: "cancelled",
    cancelledAt: new Date(),
  };
  await emit("payment.cancelled", paymentEventData(cancelled));
  return paymentLinkView(cancelled);
}

export async function renewPaymentLink(id: string, storeId?: string | null) {
  const previous = await prisma.paymentRequest.findFirst({
    where: { id, ...(storeId ? { storeId } : {}) },
  });
  if (!previous) {
    if (storeId) throw new NotFoundError("Payment not found");
    throw new ConflictError("Payment not found");
  }
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

  const store = previous.storeId
    ? await prisma.store.findUnique({ where: { id: previous.storeId } })
    : null;
  const request = await createPaymentRequestAtomic(
    SINGLE_USER_ID,
    atomic,
    previous.label ?? "payment",
    store?.accountIndex ?? 0
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
      zeroConf: previous.zeroConf,
      renewedFromId: previous.id,
      apiKeyId: previous.apiKeyId,
      storeId: previous.storeId,
    },
  });

  await emit("payment.renewed", paymentEventData(record, { fromId: previous.id }));

  return {
    ...paymentLinkView(record),
    statusUrl: `/api/payment-links/${record.id}/status`,
    statusToken: token,
  };
}

export async function listPaymentLinks(status?: string, storeId?: string | null) {
  const records = await prisma.paymentRequest.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return records.map(paymentLinkView);
}

// A single sweep at a time across replicas. The advisory lock is released if
// the process crashes, and pg_try_advisory_xact_lock avoids queuing cron runs.
const SETTLEMENT_LOCK_ID = 738_192_653;

export async function settlePaymentLinks() {
  const started = process.hrtime.bigint();
  try {
    return await prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(${SETTLEMENT_LOCK_ID}) AS locked
        `;
        if (!locked[0]?.locked) return { processed: 0, skipped: true };
        return settlePaymentLinksInner();
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
  } finally {
    observe(
      "pay_settlement_duration_seconds",
      Number(process.hrtime.bigint() - started) / 1e9
    );
    inc("pay_settlement_runs_total");
  }
}

async function settlePaymentLinksInner() {
  const defaultConfirmations = getPaymentConfig().requiredConfirmations;

  // Serve links that still need a first detection before spending the pass on
  // historical rows that only need confirmation updates.
  const unfinished = await prisma.paymentRequest.findMany({
    where: { status: { in: ["pending", "detected", "confirming"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { transfers: true },
  });
  const historical =
    unfinished.length < 200
      ? await prisma.paymentRequest.findMany({
          where: { status: { in: ["expired", "late", "underpaid", "overpaid"] } },
          orderBy: { createdAt: "asc" },
          take: 200 - unfinished.length,
          include: { transfers: true },
        })
      : [];
  const active = [...unfinished, ...historical];
  if (active.length === 0) return { processed: 0 };

  const wallet = await prisma.wallet.findUnique({
    where: { userId: SINGLE_USER_ID },
    select: { id: true, settlementCursorHeight: true },
  });

  // Never advance past a transfer that an active link still depends on. A link
  // with a txHash but no stored transfer is from an older record — use a full
  // scan so its history cannot be skipped.
  const needsFullScan = active.some(
    (request) => request.txHash && (request.transfers ?? []).length === 0
  );
  const activeBlocks = active.flatMap((request) =>
    (request.transfers ?? [])
      .map((transfer) => transfer.blockHeight)
      .filter((block) => block > 0)
  );
  const oldestActiveBlock = activeBlocks.length > 0 ? Math.min(...activeBlocks) : Number.MAX_SAFE_INTEGER;
  const cursor = needsFullScan
    ? 0
    : Math.min(wallet?.settlementCursorHeight ?? 0, oldestActiveBlock);

  const transfers = await getTransfersSince(SINGLE_USER_ID, cursor);
  // Missing height means no reliable confirmation state; fail the pass instead
  // of writing a zero-confirmation regression.
  const height = await getWalletHeight();

  for (const request of active) {
    const seen = new Set<string>();
    // Prefer the invoice subaddress. A transaction can also return change to
    // the primary address; matching by txHash alone would count that change
    // toward the payment.
    const addressMatches = transfers.filter((transfer) => transfer.address === request.address);
    const matched =
      addressMatches.length > 0
        ? addressMatches
        : transfers.filter((transfer) => transfer.txHash === request.txHash);
    const candidates = matched.filter((transfer) => {
      if (seen.has(transfer.txHash)) return false;
      seen.add(transfer.txHash);
      return true;
    });

    if (candidates.length > 0) {
      for (const transfer of candidates) {
        const amountAtomic = xmrToAtomic(transfer.amountXmr).toString();
        const existing = (request.transfers ?? []).find((row) => row.txid === transfer.txHash);

        // At 30s intervals a no-op upsert on every sweep is pure database churn.
        if (
          existing &&
          existing.amount === amountAtomic &&
          existing.blockHeight === transfer.blockHeight
        ) {
          continue;
        }

        await prisma.paymentRequestTransfer.upsert({
          where: {
            paymentRequestId_txid: { paymentRequestId: request.id, txid: transfer.txHash },
          },
          update: { blockHeight: transfer.blockHeight, amount: amountAtomic },
          create: {
            paymentRequestId: request.id,
            txid: transfer.txHash,
            amount: amountAtomic,
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
      const isLate =
        request.status === "expired" ||
        request.status === "late" ||
        (request.status === "underpaid" && isExpired(request.expiresAt));

      const covered = received >= expected;
      let status: string;
      if (isLate) status = "late";
      else if (request.zeroConf && covered && confirmations === 0) status = "confirmed";
      else if (received < expected) status = "underpaid";
      else if (received > expected && confirmations < required) status = "overpaid";
      else if (confirmations >= required) status = "confirmed";
      else status = confirmations > 0 ? "confirming" : "detected";

      const paidAt = request.paidAt ?? new Date();
      const txHash = request.txHash ?? candidates[0].txHash;
      const lateDetectedAt =
        isLate && !request.lateDetectedAt ? new Date() : request.lateDetectedAt;
      const data = {
        txHash,
        paidAt,
        confirmations,
        status,
        receivedAtomic: received.toString(),
        lateDetectedAt,
      };
      const changed = (Object.keys(data) as Array<keyof typeof data>).some((key) => {
        const current = request[key];
        const next = data[key];
        if (next instanceof Date) {
          return !current || new Date(current as string | Date).getTime() !== next.getTime();
        }
        return current !== next;
      });
      if (changed) {
        // Guard on the observed status so a concurrent writer cannot be
        // overwritten with this pass's stale snapshot.
        const updated = await prisma.paymentRequest.updateMany({
          where: { id: request.id, status: request.status },
          data,
        });
        if (updated.count === 0) continue;
      }

      if (!request.txHash) await markSubaddressUsed(request.walletId, request.address);

      if (status !== request.status) {
        inc("pay_payment_status_transitions_total", { status });
        await emit(
          `payment.${status}`,
          paymentEventData({
            ...request,
            status,
            txHash,
            paidAt,
            confirmations,
            receivedAtomic: received.toString(),
          })
        );
      }
      continue;
    }

    if (
      (request.status === "pending" || request.status === "underpaid") &&
      isExpired(request.expiresAt)
    ) {
      const expired = await prisma.paymentRequest.updateMany({
        where: { id: request.id, status: request.status },
        data: { status: "expired" },
      });
      if (expired.count > 0) {
        await emit("payment.expired", paymentEventData({ ...request, status: "expired" }));
      }
    }
  }

  // Keep the cursor behind the tip to tolerate short reorgs, and never move it
  // backwards when the wallet is still syncing.
  const nextCursor = Math.max(cursor, height > 0 ? height - 10 : 0);
  if (wallet && nextCursor > wallet.settlementCursorHeight) {
    await prisma.wallet
      .updateMany({
        where: { id: wallet.id, settlementCursorHeight: { lt: nextCursor } },
        data: { settlementCursorHeight: nextCursor },
      })
      .catch(() => {});
  }

  return { processed: active.length };
}
