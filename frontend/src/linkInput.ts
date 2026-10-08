import { uiError, type UiError } from "./api";

// Аудит 2026-10-08, А-10/А-6: разбор того, что вставили в поле ссылки.
// Копия backend/src/services/linkInput.ts (общего пакета у фронта и бэка
// нет, там же юнит-тесты) - меняя здесь, поменяйте и там.
// - Текст из "Поделиться" маркетплейса ("Смотри на Ozon https://...") ->
//   первая http(s)-ссылка; ссылка без схемы дополняется https://.
// - Номер телефона вместо ссылки распознаётся отдельно - понятная
//   подсказка вместо технического "должна начинаться с http://".

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»]+/i;
const BARE_LINK = /(?:^|[\s(«"'])((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'«»]*)/i;
const BARE_DOMAIN_ONLY = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
const TRAILING_PUNCT = /[.,;:!?)\]}»"'…]+$/;

export function extractUrl(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let candidate = t.match(URL_IN_TEXT)?.[0];
  if (!candidate) {
    const bare = t.match(BARE_LINK)?.[1] ?? (BARE_DOMAIN_ONLY.test(t) ? t : undefined);
    if (bare) candidate = `https://${bare}`;
  }
  if (!candidate) return null;
  candidate = candidate.replace(TRAILING_PUNCT, "");
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
  } catch {
    return null;
  }
  return candidate;
}

export function looksLikePhone(text: string): boolean {
  const t = text.trim();
  if (!/^[\d\s()+\-.]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

export type LinkParse = { url: string; error: null } | { url: null; error: UiError };

// Ссылка на товар.
export function parseProductLink(raw: string): LinkParse {
  const url = extractUrl(raw);
  if (url) return { url, error: null };
  if (looksLikePhone(raw)) {
    return { url: null, error: uiError("invalid_url_phone", "Это номер телефона, а нужна ссылка на товар из магазина") };
  }
  return {
    url: null,
    error: uiError(
      "invalid_url",
      "Не нашли здесь ссылку. Откройте товар в приложении магазина, нажмите «Поделиться» → «Копировать» и вставьте сюда",
    ),
  };
}

// Ссылка на сбор в банке. Пустая строка - отдельный случай (обязательность
// проверяет вызывающий код), здесь только "что-то вписано, но не ссылка".
export function parseFundraiserLink(raw: string): LinkParse {
  const url = extractUrl(raw);
  if (url) return { url, error: null };
  if (looksLikePhone(raw)) {
    return {
      url: null,
      error: uiError(
        "invalid_fundraiser_url_phone",
        "Это номер телефона, а нужна ссылка на сбор из приложения банка. Создайте сбор в банке, нажмите «Поделиться» и вставьте ссылку сюда",
      ),
    };
  }
  return {
    url: null,
    error: uiError(
      "invalid_fundraiser_url",
      "Не нашли здесь ссылку. Откройте сбор в приложении банка, нажмите «Поделиться» → «Копировать» и вставьте сюда",
    ),
  };
}
