-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "maxContributors" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "GiftShare" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "GiftShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftShare_itemId_userId_key" ON "GiftShare"("itemId", "userId");

-- AddForeignKey
ALTER TABLE "GiftShare" ADD CONSTRAINT "GiftShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftShare" ADD CONSTRAINT "GiftShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
