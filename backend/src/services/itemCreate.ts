import { db } from "../db.js";
import { deriveNameFromUrl, detectStore, fetchLinkPreview } from "./linkPreview.js";
import { fetchWildberriesViaApify, isWildberriesUrl } from "./wildberriesApify.js";
import { payoutProp, track, type ItemSource } from "./analytics.js";
import type { PayoutMethod } from "./itemEdit.js";
import { ITEMS_PER_WISHLIST, clampItemTitle, itemAddLimiter } from "./itemLimits.js";
import { PreviewCache } from "./previewCache.js";

// Аудит 2026-10-08, А-33: кэш превью по URL - повторная ссылка (тот же
// товар в другом вишлисте, повторное "обновить фото") не дёргает магазин и
// платный Apify заново. См. services/previewCache.ts.
const previewCache = new PreviewCache();

// Превью товара (фото/название) - свой парсинг, для Wildberries платный
// фоллбэк через Apify. Общая для создания позиции и для "Обновить фото по
// ссылке" при редактировании (ТЗ редактирования всех полей).
export async function fetchPreviewWithFallback(url: string) {
  const cached = previewCache.get(url);
  if (cached) return cached;
  let preview = await fetchLinkPreview(url);
  let paid = false;
  if (!preview.title && !preview.imageUrl) {
    try {
      const parsed = new URL(url);
      if (isWildberriesUrl(parsed)) {
        paid = true;
        preview = await fetchWildberriesViaApify(url);
      }
    } catch {
      // невалидный URL отсеивается до вызова этой функции
    }
  }
  previewCache.set(url, preview, paid);
  return preview;
}

// А-33: можно ли пользователю добавить позицию в этот вишлист прямо сейчас
// (или обновить фото по ссылке - countsItems=false). null - можно, иначе
// код ошибки для ответа: item_limit_reached (409) / too_many_requests (429).
export async function checkItemAddAllowed(
  wishlistId: string,
  userId: string,
  countsItems = true,
): Promise<"item_limit_reached" | "too_many_requests" | null> {
  if (countsItems) {
    const count = await db.item.count({ where: { wishlistId } });
    if (count >= ITEMS_PER_WISHLIST) return "item_limit_reached";
  }
  if (!itemAddLimiter.take(userId)) return "too_many_requests";
  return null;
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
      // А-37: вручную заданное название уже проверено схемой роута,
      // превью/имя из адреса - обрезаем до ITEM_TITLE_MAX.
      title: clampItemTitle(
        opts.title ?? preview.title ?? (isDirectImage ? "Фото по ссылке" : deriveNameFromUrl(url)),
      ),
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
