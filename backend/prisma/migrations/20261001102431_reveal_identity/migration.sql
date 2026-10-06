-- AlterTable
ALTER TABLE "GiftShare" ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "reservedByVisible" BOOLEAN NOT NULL DEFAULT false;
