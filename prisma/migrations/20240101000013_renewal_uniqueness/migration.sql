-- One expired link can produce at most one renewal, even if two requests race.
CREATE UNIQUE INDEX "PaymentRequest_renewedFromId_key" ON "PaymentRequest"("renewedFromId");
