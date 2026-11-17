-- Payment lifecycle and fiat quote fields
ALTER TABLE "PaymentRequest"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "txHash" TEXT,
  ADD COLUMN "confirmations" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publicTokenHash" TEXT,
  ADD COLUMN "fiatAmount" TEXT,
  ADD COLUMN "fiatCurrency" TEXT,
  ADD COLUMN "rateUsd" TEXT,
  ADD COLUMN "fxRate" TEXT,
  ADD COLUMN "rateSources" TEXT,
  ADD COLUMN "rateFetchedAt" TIMESTAMP(3),
  ADD COLUMN "rateStale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rateDegraded" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "PaymentRequest_publicTokenHash_key" ON "PaymentRequest"("publicTokenHash");
CREATE INDEX "PaymentRequest_status_expiresAt_idx" ON "PaymentRequest"("status", "expiresAt");
