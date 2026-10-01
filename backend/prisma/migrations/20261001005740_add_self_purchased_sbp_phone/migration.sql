-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "selfPurchased" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sbpPhone" TEXT;
