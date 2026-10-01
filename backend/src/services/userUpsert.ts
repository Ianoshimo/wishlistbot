import { Prisma } from "@prisma/client";
import { db } from "../db.js";

// Беклог Н-3 (полный QA-прогон 2026-10-01): параллельные запросы с одним
// и тем же, ранее не встречавшимся telegramId могут одновременно пройти
// upsert() мимо друг друга и упереться в уникальное ограничение - Prisma
// кидает P2002, глобальный обработчик ошибок (index.ts) ловит только
// P2025, остальное падает в 500. На самом деле конфликт означает "кто-то
// нас опередил на долю секунды" - пользователь уже есть, просто читаем
// его, а не считаем это ошибкой.
export async function upsertUserByTelegramId(telegramId: string) {
  try {
    return await db.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {},
      create: { telegramId: BigInt(telegramId), firstName: "" },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return db.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
    }
    throw err;
  }
}
