import { Prisma } from "@prisma/client";
import { db } from "../db.js";

// Беклог Н-3 (полный QA-прогон 2026-10-01): параллельные запросы с одним
// и тем же, ранее не встречавшимся telegramId могут одновременно пройти
// upsert() мимо друг друга и упереться в уникальное ограничение - Prisma
// кидает P2002, глобальный обработчик ошибок (index.ts) ловит только
// P2025, остальное падает в 500. На самом деле конфликт означает "кто-то
// нас опередил на долю секунды" - пользователь уже есть, просто читаем
// его, а не считаем это ошибкой.
// profile - firstName/username из проверенной подписи initData (см.
// auth/telegramAuth.ts resolveTelegramUser), когда он есть. Раньше
// update: {} означало, что firstName так и оставался "" навсегда для
// любого, кто пришёл в мини-апп по прямой ссылке, минуя бот-команду
// /start - не было видно, пока это не стало нужно по-настоящему
// ("Дарить неанонимно", CLAUDE.md, 2026-10-02) - только тогда и
// обнаружилось. Обновляем при каждом вызове - имя может смениться в
// Telegram, подставляем актуальное, а не то, что было при первом визите.
export async function upsertUserByTelegramId(
  telegramId: string,
  profile?: { firstName?: string; username?: string },
) {
  const data = profile?.firstName
    ? { firstName: profile.firstName, username: profile.username }
    : undefined;
  try {
    return await db.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: data ?? {},
      create: { telegramId: BigInt(telegramId), firstName: profile?.firstName ?? "", username: profile?.username },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return db.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
    }
    throw err;
  }
}
