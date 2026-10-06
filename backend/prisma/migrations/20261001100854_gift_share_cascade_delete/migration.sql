-- DropForeignKey
ALTER TABLE "GiftShare" DROP CONSTRAINT "GiftShare_itemId_fkey";

-- AddForeignKey
ALTER TABLE "GiftShare" ADD CONSTRAINT "GiftShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
