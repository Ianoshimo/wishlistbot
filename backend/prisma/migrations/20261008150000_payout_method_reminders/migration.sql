-- Аудит 2026-10-08, А-5: способ получить деньги на каждый подарок
-- отдельно (не через "уже купил сам"), реквизиты по умолчанию в профиле.
-- А-14: время последнего напоминания дарителю.
CREATE TYPE "PayoutMethod" AS ENUM ('sbp', 'fundraiser');

ALTER TABLE "User" ADD COLUMN "sbpBank" TEXT,
ADD COLUMN "fundraiserUrl" TEXT;

ALTER TABLE "Item" ADD COLUMN "payoutMethod" "PayoutMethod",
ADD COLUMN "sbpPhone" TEXT,
ADD COLUMN "sbpBank" TEXT,
ADD COLUMN "lastReminderAt" TIMESTAMP(3);

ALTER TABLE "GiftShare" ADD COLUMN "lastReminderAt" TIMESTAMP(3);

-- Миграция данных: "уже купил сам" -> способ СБП с номером владельца
-- (раньше номер был один на все подарки и жил на User).
UPDATE "Item" i SET "payoutMethod" = 'sbp', "sbpPhone" = u."sbpPhone"
FROM "Wishlist" w JOIN "User" u ON u."id" = w."ownerId"
WHERE i."wishlistId" = w."id" AND i."selfPurchased" = true;

-- Ссылка на сбор -> способ "Сбор" (у "уже купил сам" её не бывает, см.
-- QB4-3, но на всякий случай способ СБП не перетираем).
UPDATE "Item" SET "payoutMethod" = 'fundraiser'
WHERE "fundraiserUrl" IS NOT NULL AND "payoutMethod" IS NULL;

-- Ссылка на сбор по умолчанию в профиле - последняя из подарков владельца.
UPDATE "User" u SET "fundraiserUrl" = sub."fundraiserUrl"
FROM (
  SELECT DISTINCT ON (w."ownerId") w."ownerId", i."fundraiserUrl"
  FROM "Item" i JOIN "Wishlist" w ON w."id" = i."wishlistId"
  WHERE i."fundraiserUrl" IS NOT NULL
  ORDER BY w."ownerId", i."createdAt" DESC
) sub
WHERE u."id" = sub."ownerId";
