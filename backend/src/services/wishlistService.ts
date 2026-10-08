import { db } from "../db.js";
import { upsertUserByTelegramId } from "./userUpsert.js";
import { track } from "./analytics.js";

// Беклог Н-2: один владелец - один вишлист, повторный вызов возвращает
// существующий вместо того, чтобы молча плодить новый (см. комментарий в
// routes/wishlists.ts, откуда это вынесено). Переиспользуется ботом -
// пересылка ссылки в чат должна попадать в тот же вишлист, что мини-апп.
//
// Аудит 2026-10-08, А-48: раньше findFirst без orderBy - при нескольких
// списках Postgres мог вернуть любой, а не первый. Теперь - самый старый
// (createdAt asc), детерминированно. Создание - под тем же advisory-lock
// на владельца, что POST /api/wishlists (QA-1): /start в боте и первый
// запуск мини-аппа одновременно больше не дают два списка.
export async function getOrCreateWishlist(telegramId: string) {
  const owner = await upsertUserByTelegramId(telegramId);
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.id}))`;
    const existing = await tx.wishlist.findFirst({ where: { ownerId: owner.id }, orderBy: { createdAt: "asc" } });
    if (existing) return { wishlist: existing, created: false };
    const wishlist = await tx.wishlist.create({ data: { ownerId: owner.id, title: "Мой вишлист" } });
    return { wishlist, created: true };
  });
  if (result.created) {
    track("wishlist_created", { userId: owner.id, wishlistId: result.wishlist.id, props: { source: "bot", ordinal: 1 } });
  }
  return result.wishlist;
}

// А-48: списки владельца по порядку создания - бот спрашивает, в какой
// добавить пересланную ссылку, если их несколько. Пользователя без записи
// не создаём (только чтение).
export async function listOwnerWishlists(telegramId: string) {
  const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
  if (!user) return [];
  return db.wishlist.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, ownerId: true },
  });
}
