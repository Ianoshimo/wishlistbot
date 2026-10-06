import { db } from "../db.js";
import { upsertUserByTelegramId } from "./userUpsert.js";

// Беклог Н-2: один владелец - один вишлист, повторный вызов возвращает
// существующий вместо того, чтобы молча плодить новый (см. комментарий в
// routes/wishlists.ts, откуда это вынесено). Теперь переиспользуется и
// ботом - пересылка ссылки в чат должна попадать в тот же вишлист, что
// мини-апп.
export async function getOrCreateWishlist(telegramId: string) {
  const owner = await upsertUserByTelegramId(telegramId);
  const existing = await db.wishlist.findFirst({ where: { ownerId: owner.id } });
  if (existing) return existing;
  return db.wishlist.create({ data: { ownerId: owner.id } });
}
