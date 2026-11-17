-- API keys
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '*',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- Webhooks
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '*',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookDelivery_status_nextRetryAt_idx" ON "WebhookDelivery"("status", "nextRetryAt");

-- Payment request extensions
ALTER TABLE "PaymentRequest"
  ADD COLUMN "apiKeyId" TEXT,
  ADD COLUMN "idempotencyKeyHash" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "responseSnapshot" TEXT,
  ADD COLUMN "idempotencyExpiresAt" TIMESTAMP(3),
  ADD COLUMN "requiredConfirmations" INTEGER,
  ADD COLUMN "receivedAtomic" TEXT,
  ADD COLUMN "renewedFromId" TEXT;

CREATE UNIQUE INDEX "PaymentRequest_apiKeyId_idempotencyKeyHash_key" ON "PaymentRequest"("apiKeyId", "idempotencyKeyHash");

CREATE TABLE "PaymentRequestTransfer" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "blockHeight" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRequestTransfer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentRequestTransfer_paymentRequestId_txid_key" ON "PaymentRequestTransfer"("paymentRequestId", "txid");

-- Foreign keys
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRequestTransfer" ADD CONSTRAINT "PaymentRequestTransfer_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
