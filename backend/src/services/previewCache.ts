import type { LinkPreview } from "./linkPreview.js";

// Аудит 2026-10-08, А-33: кэш превью товара по URL в памяти процесса.
// - Найденное фото/название живёт сутки (товар не меняется так быстро).
// - Пустой результат платного запроса (Apify для Wildberries) - час: иначе
//   каждая повторная отправка той же ссылки снова платная.
// - Пустой результат бесплатного парсинга не кэшируется - сбой мог быть
//   разовым (таймаут магазина).
// Рестарт процесса кэш обнуляет - это ожидаемо.

const FOUND_TTL = 24 * 3_600_000;
const PAID_EMPTY_TTL = 3_600_000;
const MAX_ENTRIES = 2_000;

export class PreviewCache {
  private entries = new Map<string, { preview: LinkPreview; expires: number }>();

  get(url: string, now = Date.now()): LinkPreview | null {
    const e = this.entries.get(url);
    if (!e) return null;
    if (e.expires <= now) {
      this.entries.delete(url);
      return null;
    }
    return e.preview;
  }

  set(url: string, preview: LinkPreview, paid: boolean, now = Date.now()): void {
    const found = Boolean(preview.title || preview.imageUrl);
    const ttl = found ? FOUND_TTL : paid ? PAID_EMPTY_TTL : 0;
    if (ttl === 0) return;
    this.entries.delete(url);
    this.entries.set(url, { preview, expires: now + ttl });
    // Map хранит порядок вставки - самая старая запись первая.
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
