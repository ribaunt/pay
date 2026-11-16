-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';

-- Drop legacy singleton wallet rows (pre-user data is disposable)
DELETE FROM "PaymentRequest";
DELETE FROM "Subaddress";
DELETE FROM "Wallet";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "userId" TEXT;

-- Backfill is not possible for legacy rows; remove any that remain
DELETE FROM "Wallet" WHERE "userId" IS NULL;

ALTER TABLE "Wallet" ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
