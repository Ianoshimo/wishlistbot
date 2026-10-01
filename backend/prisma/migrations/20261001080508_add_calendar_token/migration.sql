-- AlterTable: добавляем как nullable, чтобы не упасть на существующих строках
ALTER TABLE "User" ADD COLUMN "calendarToken" TEXT;

-- Бэкофилл уникальным значением для уже существующих пользователей
UPDATE "User" SET "calendarToken" = md5(random()::text || clock_timestamp()::text || "id") WHERE "calendarToken" IS NULL;

-- Теперь можно сделать обязательным
ALTER TABLE "User" ALTER COLUMN "calendarToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User"("calendarToken");
