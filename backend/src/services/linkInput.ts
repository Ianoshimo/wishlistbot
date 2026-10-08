// Аудит 2026-10-08, А-10/А-6: что пользователь вставляет в поле ссылки.
//
// Кнопка "Поделиться" маркетплейса копирует не голую ссылку, а текст
// вида "Смотри, что нашёл на Ozon https://ozon.ru/t/AbCdEf" - раньше и
// фронт, и API (`z.string().url()`) такой текст отвергали. Теперь из
// текста вырезается первая http(s)-ссылка; ссылка без схемы
// ("ozon.ru/t/AbC") дополняется https://. Хвостовая пунктуация из
// предложения (точка, запятая, закрывающая скобка/кавычка) отрезается.
//
// Та же логика продублирована во фронте (frontend/src/linkInput.ts) -
// общего пакета у фронта и бэка нет. Меняя здесь - поменяйте и там.

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»]+/i;
// Ссылка без схемы: домен с точкой и путём ("ozon.ru/t/AbC") или весь
// текст - один голый домен ("ozon.ru").
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

// Похоже на номер телефона, а не на ссылку: только цифры и типичные
// разделители, 10-12 цифр ("89000000000", "+7 900 123-45-67").
export function looksLikePhone(text: string): boolean {
  const t = text.trim();
  if (!/^[\d\s()+\-.]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 12;
}

// Для zod.preprocess: строка с текстом вокруг ссылки -> сама ссылка;
// если ссылки не нашлось - значение как есть (его отвергнет схема).
export function preprocessUrlInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return extractUrl(value) ?? value;
}
