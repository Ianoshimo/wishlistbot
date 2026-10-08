import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from "undici";

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

export function isPrivateIp(rawIp: string): boolean {
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) - тот же IPv4 под другой записью.
  const ip = rawIp.replace(/^::ffff:/i, "");
  if (ip === "::1" || ip === "::") return true;
  if (/^127\./.test(ip)) return true; // весь loopback 127.0.0.0/8
  if (/^0\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT 100.64.0.0/10
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
//
// Здесь - только то, что видно по самой ссылке (схема, IP-литерал,
// localhost). Имя хоста проверяется в момент подключения - см.
// createSafeLookup ниже.
function assertPublicHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported_protocol");
  }
  // [::1] в URL.hostname приходит в квадратных скобках.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("private_address");
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("private_address");
  }
}

type Resolver = (
  hostname: string,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolver: Resolver = (hostname, callback) =>
  dnsLookup(hostname, { all: true }, callback);

// QA блока 4, QB4-7 (DNS rebinding): раньше адрес проверялся отдельным
// dns.lookup, а fetch резолвил хост заново - домен с коротким TTL мог
// первым ответом отдать публичный адрес, вторым - внутренний. Теперь
// проверка встроена в сам резолв, которым пользуется сокет: подключаемся
// ровно к тому адресу, который только что проверили. Имя хоста в URL не
// меняется, поэтому SNI и заголовок Host для https остаются правильными.
// Все адреса, а не только первый: у хоста может быть и публичная, и
// внутренняя A-запись (а happy eyeballs перебирает их все).
export function createSafeLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const blocked = addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address));
      if (blocked) {
        const denied = Object.assign(new Error("private_address"), { code: "EPRIVATEADDR" });
        return callback(denied, "", 0);
      }
      const family = options.family === 4 || options.family === 6 ? options.family : 0;
      const matching = family ? addresses.filter((a) => a.family === family) : addresses;
      if (matching.length === 0) {
        return callback(Object.assign(new Error("no_address"), { code: "ENOTFOUND" }), "", 0);
      }
      if (options.all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, matching);
      } else {
        callback(null, matching[0].address, matching[0].family);
      }
    });
  };
}

// Отдельный агент только для превью - со своим lookup на каждом
// подключении (в т.ч. к адресу из редиректа).
const previewAgent = new Agent({ connect: { lookup: createSafeLookup() } });

const MAX_REDIRECTS = 5;

// Редиректы - вручную, с той же проверкой адреса на каждом шаге: с
// redirect: "follow" публичный сайт мог перенаправить сервер на
// внутренний адрес (например, сервисы Railway), и проверка исходной
// ссылки ничего бы не дала.
async function fetchPublic(start: URL, init: RequestInit): Promise<Response> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicHttpUrl(current);
    const res = await undiciFetch(current, { ...init, redirect: "manual", dispatcher: previewAgent });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    current = new URL(location, current);
  }
  throw new Error("too_many_redirects");
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

export const MARKETPLACE_NAMES: Record<string, string> = {
  "ozon.ru": "Ozon",
  "wildberries.ru": "Wildberries",
  "market.yandex.ru": "Яндекс.Маркет",
  "avito.ru": "Авито",
  "aliexpress.ru": "AliExpress",
  "aliexpress.com": "AliExpress",
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
      .replace(/^product--/i, "") // Яндекс.Маркет: /product--<slug>/<id>
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

// Бейдж магазина на карточке позиции (CLAUDE.md, 2026-10-01) - хост уже
// известен бэкенду из url позиции, просто визуальный штрих для дарителя.
// Не каждый хост узнаём - тогда бейджа просто нет, это ожидаемо.
export function detectStore(rawUrl: string): string | null {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "");
    return MARKETPLACE_NAMES[host] ?? null;
  } catch {
    return null;
  }
}

// Аудит 2026-10-08, А-46: раньше раскодировались только &amp; - &quot;,
// &#39;, &nbsp;, &laquo; и числовые сущности попадали в название как есть
// ("Кружка &quot;Кот&quot;"). Полный набор нужных на практике именованных
// сущностей + любые числовые (&#NNN; / &#xHH;). Неизвестная сущность
// остаётся как была.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  minus: "−",
  times: "×",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // Управляющие символы и недопустимые коды - не вставляем.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
      return String.fromCodePoint(code === 160 ? 32 : code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// А-46: og:image бывает относительным ("/img/1.jpg") или без схемы
// ("//cdn.shop.ru/1.jpg") - раньше сохранялся как есть, и картинка в
// мини-аппе была битой (адрес считался от домена мини-аппа). Разрешаем
// относительно адреса страницы, после редиректов; не http(s) - не берём.
export function resolveImageUrl(raw: string | null, pageUrl: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), pageUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
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
  return match ? decodeHtmlEntities(match[1].replace(/\\u0026/g, "&")).trim() || null : null;
}

// Н-6 (техдолг с QA 2026-10-01, разобран 2026-10-07). Яндекс.Маркет
// находит товар ТОЛЬКО по числовому id в ссылке, slug перед ним
// игнорирует - и не редиректит. Ссылка
// /product--naushniki-sony-wh-1000xm5/1779000001 с ошибочным id честно
// отвечает 200 страницей совсем другого товара (id 1779000001 реально
// существует - чехол MyPads), а несуществующий id - тоже 200, но
// страницей "Нет такой страницы" с логотипом в og:image. Поэтому
// сверяем, какой товар страница реально показала, с id и slug из
// исходной ссылки:
// - /product--<slug>/<id>: og:url - голое /product/ без id, зато в
//   JSON-состоянии страницы есть "productId":"<id>","productSlug":"<slug>";
// - /card/<slug>/<sku>: в og:url - настоящий slug и sku показанной
//   карточки (при чужом slug в ссылке там всё равно настоящий).
// Обрезанные слепки реальных ответов - __fixtures__/, проверка -
// linkPreview.test.ts. Остальные магазины эта проверка не затрагивает.
interface YandexMarketRef {
  kind: "product" | "card";
  id: string; // id модели для /product, sku для /card
  slug: string | null;
}

export function parseYandexMarketUrl(rawUrl: string): YandexMarketRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host !== "market.yandex.ru") return null;

  const product = url.pathname.match(/^\/product(?:--([^/]+))?\/(\d+)(?:\/|$)/);
  if (product) return { kind: "product", id: product[2], slug: product[1] ?? null };
  const card = url.pathname.match(/^\/card\/([^/]+)\/(\d+)(?:\/|$)/);
  if (card) return { kind: "card", id: card[2], slug: card[1] };
  return null;
}

function slugTokens(slug: string): Set<string> {
  return new Set(
    slug
      .toLowerCase()
      .split(/[-_]+/)
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t)),
  );
}

// slug в ссылке пользователя может немного разойтись с текущим slug
// товара (Маркет иногда переименовывает карточку), поэтому достаточно
// хотя бы одного общего осмысленного слова. Полностью чужой slug ("x",
// "naushniki-..." против "chekhol-...") - уже не тот товар.
function slugsMatch(requested: string, served: string): boolean {
  if (requested.toLowerCase() === served.toLowerCase()) return true;
  const servedTokens = slugTokens(served);
  for (const t of slugTokens(requested)) {
    if (servedTokens.has(t)) return true;
  }
  return false;
}

export function isPreviewForRequestedProduct(
  requestedUrl: string,
  finalUrl: string,
  html: string,
): boolean {
  const requested = parseYandexMarketUrl(requestedUrl);
  if (!requested) return true; // не товар Маркета - сверять не с чем

  // Редирект на другой товар.
  const final = parseYandexMarketUrl(finalUrl);
  if (final && final.kind === requested.kind && final.id !== requested.id) return false;

  const served: YandexMarketRef[] = [];
  const ogUrl = extractMeta(html, "og:url");
  const fromOg = ogUrl ? parseYandexMarketUrl(ogUrl) : null;
  if (fromOg) served.push(fromOg);
  for (const m of html.matchAll(/"productId":"(\d+)","productSlug":"([^"]+)"/g)) {
    served.push({ kind: "product", id: m[1], slug: m[2] });
  }

  const match = served.find((s) => s.kind === requested.kind && s.id === requested.id);
  // Нет записи о запрошенном товаре - это страница "Нет такой страницы",
  // чужая карточка или Маркет поменял вёрстку. Во всех случаях
  // безопаснее название из ссылки, чем чужие/служебные og-теги.
  if (!match) return false;
  if (requested.slug && match.slug && !slugsMatch(requested.slug, match.slug)) return false;
  return true;
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return EMPTY;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchPublic(url, {
      signal: controller.signal,
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
    if (!isPreviewForRequestedProduct(url.toString(), res.url, html)) return EMPTY;
    const imageUrl = resolveImageUrl(extractMeta(html, "og:image"), res.url || url.toString());
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
