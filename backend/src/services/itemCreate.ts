import { db } from "../db.js";
import { deriveNameFromUrl, detectStore, fetchLinkPreview } from "./linkPreview.js";
import { fetchWildberriesViaApify, isWildberriesUrl } from "./wildberriesApify.js";
import { payoutProp, track, type ItemSource } from "./analytics.js";
import type { PayoutMethod } from "./itemEdit.js";

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
// HTTP-роут мини-аппа. Правила "как подарить" (А-5) проверяет вызывающий
// (services/itemEdit.ts planItemEdit) - сюда приходит уже готовый план.
export interface CreateItemOptions {
  title?: string;
  price?: number;
  selfPurchased?: boolean;
  maxContributors?: number;
  payoutMethod?: PayoutMethod | null;
  sbpPhone?: string | null;
  sbpBank?: string | null;
  fundraiserUrl?: string | null;
  // Аналитика (2026-10-07): откуда добавлена позиция и кто владелец -
  // событие item_added пишется здесь, в одном месте для мини-аппа и бота.
  source: ItemSource;
  ownerUserId: string;
}

export async function createItemFromUrl(wishlistId: string, url: string, opts: CreateItemOptions) {
  const preview = await fetchPreviewWithFallback(url);
  const isDirectImage = preview.imageUrl === url;

  const item = await db.item.create({
    data: {
      wishlistId,
      url,
      price: opts.price,
      selfPurchased: opts.selfPurchased ?? false,
      maxContributors: opts.maxContributors ?? 1,
      payoutMethod: opts.payoutMethod ?? null,
      sbpPhone: opts.sbpPhone ?? null,
      sbpBank: opts.sbpBank ?? null,
      fundraiserUrl: opts.fundraiserUrl ?? null,
      title:
        opts.title ??
        preview.title ??
        (isDirectImage ? "Фото по ссылке" : deriveNameFromUrl(url)),
      imageUrl: preview.imageUrl ?? undefined,
    },
  });

  track("item_added", {
    userId: opts.ownerUserId,
    wishlistId,
    itemId: item.id,
    props: {
      source: opts.source,
      store: detectStore(url),
      price: item.price ?? null,
      selfPurchased: item.selfPurchased,
      maxContributors: item.maxContributors,
      payoutMethod: payoutProp(item.payoutMethod),
    },
  });

  return item;
}
