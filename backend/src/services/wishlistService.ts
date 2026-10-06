import { db } from "../db.js";
import { upsertUserByTelegramId } from "./userUpsert.js";
import { track } from "./analytics.js";

// Беклог Н-2: один владелец - один вишлист, повторный вызов возвращает
// существующий вместо того, чтобы молча плодить новый (см. комментарий в
// routes/wishlists.ts, откуда это вынесено). Теперь переиспользуется и
// ботом - пересылка ссылки в чат должна попадать в тот же вишлист, что
// мини-апп.
export async function getOrCreateWishlist(telegramId: string) {
  const owner = await upsertUserByTelegramId(telegramId);
  const existing = await db.wishlist.findFirst({ where: { ownerId: owner.id } });
  if (existing) return existing;
  const wishlist = await db.wishlist.create({ data: { ownerId: owner.id } });
  track("wishlist_created", { userId: owner.id, wishlistId: wishlist.id, props: { source: "bot", ordinal: 1 } });
  return wishlist;
}
