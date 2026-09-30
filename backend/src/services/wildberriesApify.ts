import { env } from "../env.js";
import { shortenTitle, type LinkPreview } from "./linkPreview.js";

// Платный фоллбэк конкретно для wildberries.ru (решение 2026-10-02, см.
// Продукт/беклог-баги-итерация-1.md - "найти бесплатное решение"): свой
// og-парсинг WB блокирует антиботом даже через headless-браузер с
// маскировкой navigator.webdriver (поведенческий трекер, не просто
// фингерпринт) - см. комментарий в linkPreview.ts. Актор на Apify решает
// это за нас за ~$0.005 с позиции (без отзывов и истории цен - они нам не
// нужны и только замедлили бы и удорожили запрос).
const ACTOR = "zen-studio~wildberries-detail-scraper";
const TIMEOUT_MS = 30000; // сам актор в проверке отрабатывал ~20с

interface ApifyWbItem {
  name?: string;
  images?: string[];
}

export function isWildberriesUrl(url: URL): boolean {
  return url.hostname.replace(/^www\./, "") === "wildberries.ru";
}

export async function fetchWildberriesViaApify(url: string): Promise<LinkPreview> {
  if (!env.APIFY_TOKEN) return { title: null, imageUrl: null };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrls: [url],
          includeReviews: false,
          includeSellerProfile: false,
          includeQuestions: false,
          includePriceHistory: false,
          includeVideos: false,
        }),
      },
    );
    if (!res.ok) return { title: null, imageUrl: null };

    const items = (await res.json()) as ApifyWbItem[];
    const item = items[0];
    if (!item) return { title: null, imageUrl: null };

    return {
      title: item.name ? shortenTitle(item.name) : null,
      imageUrl: item.images?.[0] ?? null,
    };
  } catch {
    // Таймаут, сбой актора, исчерпан баланс - позиция всё равно должна
    // сохраниться, просто без фото (как и для остальных источников).
    return { title: null, imageUrl: null };
  } finally {
    clearTimeout(timeout);
  }
}
