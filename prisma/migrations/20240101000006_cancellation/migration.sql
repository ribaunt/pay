ALTER TABLE "PaymentRequest"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "lateDetectedAt" TIMESTAMP(3);
