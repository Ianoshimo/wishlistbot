import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Продукт: автоподгрузка фото по ссылке на товар вместо ручной загрузки
// (решение 2026-10-02, без партнёрских интеграций - см.
// Продукт/роадмап-5-итераций.md, итерация 3, где парсинг завязан на
// партнёрки; здесь - только чтение публичных og-тегов).
//
// Живой прогон по 5 источникам (curl с реального сервера) показал: Ozon и
// Wildberries блокируют такие запросы антиботом на уровне сети (307/498
// без тела), Avito блокирует по IP (429, "проблема с IP"). Яндекс.Маркет
// отдаёт og-теги (правда, упакованные в JSON внутри <script>, а не
// обычным <meta property="og:image">). Прямая ссылка на картинку
// (Яндекс.Картинки, любой CDN) работает всегда - определяем по
// Content-Type. Поэтому функция всегда мягко деградирует до `null` -
// далеко не каждая ссылка даст фото, и это ожидаемо, а не ошибка.

const FETCH_TIMEOUT_MS = 4000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export interface LinkPreview {
  title: string | null;
  imageUrl: string | null;
}

const EMPTY: LinkPreview = { title: null, imageUrl: null };

function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "0.0.0.0") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 (ULA)
  if (/^fe80:/i.test(ip)) return true; // link-local
  return false;
}

// SSRF-защита: ссылку даёт пользователь в поле "url" позиции, сервер
// ходит по ней сам - нужно убедиться, что она ведёт наружу, а не на
// localhost/внутреннюю сеть (в т.ч. через редирект).
async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported_protocol");
  }
  const host = url.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("private_address");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("private_address");
  }
  const resolved = await lookup(host);
  if (isPrivateIp(resolved.address)) throw new Error("private_address");
}

const MAX_TITLE_WORDS = 5;

// Продукт 2026-10-02: в вишлисте должны быть названия, а не голые
// ссылки. og:title обычно - полный SEO-заголовок ("... купить в
// интернет-магазине X на Y, 12345") - обрезаем до сути и до 5 слов.
export function shortenTitle(raw: string): string {
  const head = raw.split(/\s[–—|]\s|,\s*(?=купить|цена)/i)[0];
  const words = head
    .replace(/&amp;/g, "&")
    .trim()
    .split(/\s+/)
    .slice(0, MAX_TITLE_WORDS);
  return words.join(" ");
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const MARKETPLACE_NAMES: Record<string, string> = {
  "ozon.ru": "Ozon",
  "wildberries.ru": "Wildberries",
  "market.yandex.ru": "Яндекс.Маркет",
  "avito.ru": "Авито",
};

// Когда страницу товара не удалось прочитать (антибот-блок - см. шапку
// файла) и названия взять неоткуда, вишлист всё равно не должен
// показывать сырую ссылку - придумываем короткое имя из самой ссылки:
// поисковый запрос в query-параметре, иначе последний осмысленный
// сегмент пути, иначе просто название магазина.
export function deriveNameFromUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "Товар по ссылке";
  }

  const host = url.hostname.replace(/^www\./, "");
  const brand = MARKETPLACE_NAMES[host];

  for (const key of ["text", "q", "query", "search"]) {
    const value = url.searchParams.get(key);
    if (value && value.trim()) {
      return capitalize(shortenTitle(decodeURIComponent(value).replace(/[+_]/g, " ")));
    }
  }

  // Служебные сегменты вида detail.aspx/index.html/catalog несут ноль
  // смысла сами по себе - пропускаем их, а не берём как есть.
  const GENERIC_SEGMENTS = new Set([
    "detail",
    "index",
    "product",
    "item",
    "catalog",
    "card",
    "p",
    "goods",
  ]);

  const segments = url.pathname.split("/").filter(Boolean);
  for (const segment of segments.reverse()) {
    const cleaned = segment
      .replace(/\.\w+$/, "") // .aspx/.html
      .replace(/[-_]/g, " ")
      .split(/\s+/)
      .filter((w) => !/^[\d.]+$/.test(w)) // отбрасываем чисто цифровые id/версии
      .slice(0, MAX_TITLE_WORDS)
      .join(" ")
      .trim();
    if (cleaned.length >= 3 && !GENERIC_SEGMENTS.has(cleaned.toLowerCase())) {
      return capitalize(cleaned);
    }
  }

  return brand ? `Товар (${brand})` : "Товар по ссылке";
}

function extractMeta(html: string, property: string): string | null {
  // Обычный вид: <meta property="og:image" content="..."> (порядок
  // атрибутов и кавычки могут отличаться).
  const plain = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const plainReverse = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
    "i",
  );
  // Вариант Яндекс.Маркета: та же пара внутри JSON-слепка состояния React
  // ({"tagName":"meta","attrs":{"property":"og:image","content":"..."}}).
  const json = new RegExp(`"${property}"\\s*,\\s*"content"\\s*:\\s*"([^"]+)"`, "i");

  const match = html.match(plain) ?? html.match(plainReverse) ?? html.match(json);
  return match ? match[1].replace(/\\u0026/g, "&").replace(/&amp;/g, "&") : null;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return EMPTY;
  }

  try {
    await assertPublicHttpUrl(url);
  } catch {
    return EMPTY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,image/*;q=0.8,*/*;q=0.5",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
    });
    if (!res.ok) return EMPTY;

    // Живой прогон 2026-10-02: Яндекс.Маркет после нескольких запросов с
    // одного IP редиректит на /showcaptcha - страница отвечает 200 и даже
    // отдаёт og:image/og:title, но это логотип Яндекса и общее "Яндекс"
    // вместо настоящего товара. Хуже, чем отсутствие фото - выглядит как
    // получилось, а показывает не то.
    if (/\/(showcaptcha|captcha)(\/|$|\?)/i.test(res.url)) return EMPTY;

    const contentType = res.headers.get("content-type") ?? "";

    // Пользователь мог вставить прямую ссылку на картинку (например, из
    // Яндекс.Картинок), а не на страницу товара - тогда сама ссылка и есть
    // фото, парсить нечего.
    if (contentType.startsWith("image/")) {
      return { title: null, imageUrl: url.toString() };
    }
    if (!contentType.includes("text/html")) return EMPTY;

    const html = await res.text();
    const imageUrl = extractMeta(html, "og:image");
    const rawTitle = extractMeta(html, "og:title");
    return { title: rawTitle ? shortenTitle(rawTitle) : null, imageUrl };
  } catch {
    // Таймаут, антибот-блок, обрыв сети - позиция всё равно должна
    // сохраниться, просто без фото. См. шапку файла про Ozon/WB/Avito.
    return EMPTY;
  } finally {
    clearTimeout(timeout);
  }
}
