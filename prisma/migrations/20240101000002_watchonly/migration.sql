-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "walletFile" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Wallet" ADD COLUMN "viewKey" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "restoreHeight" INTEGER;
ALTER TABLE "Wallet" ADD COLUMN "isWatchOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Wallet" ADD COLUMN "description" TEXT;

-- CreateTable
CREATE TABLE "Subaddress" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressIndex" INTEGER NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subaddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subaddress_walletId_addressIndex_key" ON "Subaddress"("walletId", "addressIndex");

-- CreateIndex
CREATE INDEX "Subaddress_walletId_idx" ON "Subaddress"("walletId");

-- AddForeignKey
ALTER TABLE "Subaddress" ADD CONSTRAINT "Subaddress_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
