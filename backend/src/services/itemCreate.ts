import { db } from "../db.js";
import { deriveNameFromUrl, detectStore, fetchLinkPreview } from "./linkPreview.js";
import { fetchWildberriesViaApify, isWildberriesUrl } from "./wildberriesApify.js";
import { track, type ItemSource } from "./analytics.js";

// Превью товара (фото/название) - свой парсинг, для Wildberries платный
// фоллбэк через Apify. Общая для создания позиции и для "Обновить фото по
// ссылке" при редактировании (ТЗ редактирования всех полей).
export async function fetchPreviewWithFallback(url: string) {
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
  return preview;
}

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
  // Аналитика (2026-10-07): откуда добавлена позиция и кто владелец -
  // событие item_added пишется здесь, в одном месте для мини-аппа и бота.
  meta?: { source: ItemSource; ownerUserId: string; fundraiserUrl?: string },
) {
  const preview = await fetchPreviewWithFallback(url);
  const isDirectImage = preview.imageUrl === url;

  const item = await db.item.create({
    data: {
      wishlistId,
      url,
      price,
      selfPurchased: selfPurchased ?? false,
      maxContributors: maxContributors ?? 1,
      fundraiserUrl: meta?.fundraiserUrl,
      title:
        titleOverride ??
        preview.title ??
        (isDirectImage ? "Фото по ссылке" : deriveNameFromUrl(url)),
      imageUrl: preview.imageUrl ?? undefined,
    },
  });

  track("item_added", {
    userId: meta?.ownerUserId ?? null,
    wishlistId,
    itemId: item.id,
    props: {
      source: meta?.source ?? "app",
      store: detectStore(url),
      price: item.price ?? null,
      selfPurchased: item.selfPurchased,
      maxContributors: item.maxContributors,
      fundraiser: Boolean(item.fundraiserUrl),
    },
  });

  return item;
}
