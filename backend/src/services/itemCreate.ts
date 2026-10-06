import { db } from "../db.js";
import { deriveNameFromUrl, fetchLinkPreview } from "./linkPreview.js";
import { fetchWildberriesViaApify, isWildberriesUrl } from "./wildberriesApify.js";

// Создание позиции по ссылке (подгрузка фото/названия) - вынесено из
// routes/wishlists.ts, чтобы той же логикой мог воспользоваться бот
// (пересылка товарной ссылки прямо в чат, см. bot/bot.ts), а не только
// HTTP-роут мини-аппа.
export async function createItemFromUrl(
  wishlistId: string,
  url: string,
  titleOverride?: string,
  price?: number,
  selfPurchased?: boolean,
  maxContributors?: number,
) {
  let preview = await fetchLinkPreview(url);

  if (!preview.title && !preview.imageUrl) {
    try {
      const parsed = new URL(url);
      if (isWildberriesUrl(parsed)) {
        preview = await fetchWildberriesViaApify(url);
      }
    } catch {
      // невалидный URL отсеивается до вызова этой функции
    }
  }

  const isDirectImage = preview.imageUrl === url;

  return db.item.create({
    data: {
      wishlistId,
      url,
      price,
      selfPurchased: selfPurchased ?? false,
      maxContributors: maxContributors ?? 1,
      title:
        titleOverride ??
        preview.title ??
        (isDirectImage ? "Фото по ссылке" : deriveNameFromUrl(url)),
      imageUrl: preview.imageUrl ?? undefined,
    },
  });
}
