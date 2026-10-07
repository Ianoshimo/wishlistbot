import { getInitData, getTelegramId } from "./telegram";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

// Локальная разработка нарочно держит VITE_API_BASE пустым (см.
// README) - fetch() бьёт по относительному /api/..., который Vite сам
// проксирует на бэкенд (vite.config.ts). Это работает только для
// запросов ИЗНУТРИ страницы. Ссылка на .ics-файл (CLAUDE.md,
// 2026-10-02) - "Добавить в календарь"/подписка на личный календарь -
// нужна абсолютной: её копируют в адресную строку или вставляют в
// другое приложение (Calendar), где относительный путь ни на что не
// укажет. В проде VITE_API_BASE всегда абсолютный (DEPLOY.md), это
// запасной путь только для дева.
export function absoluteApiUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  return `${base}${path}`;
}

// Беклог Б-4: раньше ошибка API долетала до компонента как голый текст
// ответа и никак не обрабатывалась - пользователь не видел вообще ничего.
// Код ошибки (`error` в теле ответа бэкенда) достаём отдельно, чтобы
// показать понятную фразу, а не сырой JSON.
const ERROR_MESSAGES: Record<string, string> = {
  item_not_available: "Позицию уже забронировали - обновите список",
  item_not_reserved: "Бронь уже снята",
  not_your_reservation: "Это не ваша бронь",
  cannot_reserve_own_item: "Нельзя бронировать собственный подарок",
  not_your_wishlist: "Это не ваш вишлист",
  wishlist_not_found: "Вишлист не найден",
  not_found: "Не найдено",
  validation_error: "Проверьте введённые данные",
  unauthorized: "Не удалось подтвердить вход через Telegram - перезапустите бота",
  sbp_phone_required: "Укажите номер телефона для перевода по СБП",
  wishlist_limit_reached: "Можно завести не больше 3 вишлистов",
  contributors_below_joined: "Уже присоединилось больше участников - меньше мест поставить нельзя",
  split_needs_payment_target: "Чтобы скинуться, нужен номер для перевода по СБП или ссылка на сбор в банке",
  split_item_already_reserved: "Подарок уже забронирован одним человеком - складчину включить нельзя",
  item_already_bought: "Подарок уже куплен - менять можно только ссылку, название, цену и фото",
  item_has_givers: "Подарок уже забронирован - способ подарить менять нельзя, чтобы не подвести дарителя",
};

// Повод хранится как UTC-полночь календарного дня (QA-14) - показываем его
// в UTC, иначе западнее Гринвича бейдж показал бы предыдущий день.
export function formatOccasionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

// QA-7: "29 990 ₽" с неразрывными пробелами - цена не переносится
// посередине и читается с разделителем тысяч.
export function formatRub(kopecks: number): string {
  return `${Math.round(kopecks / 100).toLocaleString("ru-RU")}\u00a0₽`;
}

export function describeError(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return ERROR_MESSAGES[code] ?? "Что-то пошло не так, попробуйте ещё раз";
}

// Ошибка для показа в ErrorBanner: текст для человека + машинный код для
// аналитики (QA блока 4, QB4-5 - раньше в ui_error_shown.code уходил сам
// русский текст, ошибки не группировались и ломались при правке текста).
// code - `error` из ответа API (`item_not_available`), `http_<статус>`,
// `network` или стабильный ключ клиентской валидации.
export interface UiError {
  code: string;
  message: string;
}

export function apiError(err: unknown): UiError {
  const raw = err instanceof Error ? err.message : "";
  let code = "unknown";
  if (/^\d{3}$/.test(raw)) code = `http_${raw}`;
  else if (/^[a-z0-9_]{1,50}$/.test(raw)) code = raw;
  else if (err instanceof TypeError) code = "network"; // fetch не дошёл до сервера
  return { code, message: describeError(err) };
}

export function uiError(code: string, message: string): UiError {
  return { code, message };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Привязка логина через Telegram (2026-10-02) - бэкенд проверяет
      // подпись, а не верит telegramId в теле (см. auth/telegramAuth.ts).
      "X-Telegram-Init-Data": getInitData(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? String(res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type ItemStatus = "available" | "reserved" | "bought";

export interface Item {
  id: string;
  url: string;
  title: string | null;
  price: number | null;
  imageUrl: string | null;
  status: ItemStatus;
  selfPurchased: boolean;
  // Приходит только после брони (status !== "available") - см.
  // backend/src/routes/items.ts.
  sbpPhone: string | null;
  // Беклог В-6: true только если бронь принадлежит текущему telegramId -
  // identity дарителя при этом наружу не раскрывается.
  reservedByMe: boolean;
  // "Хочу больше всего" - тоггл получателя (CLAUDE.md, 2026-10-01).
  priority: boolean;
  // Бейдж магазина на карточке - хост уже известен бэкенду из url, см.
  // backend/src/services/linkPreview.ts (detectStore). null - хост не
  // из числа известных маркетплейсов, бейджа просто нет.
  store: string | null;
  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - получатель задаёт
  // при добавлении, сколько дарителей могут разделить этот
  // selfPurchased-перевод. 1 (по умолчанию) = обычное поведение, как
  // раньше - один даритель на позицию.
  maxContributors: number;
  // Сколько уже присоединилось (при maxContributors === 1 - 0 или 1,
  // как и раньше).
  contributorsCount: number;
  // Отметил ли СВОЮ долю именно текущий зритель - отдельно от общего
  // status (который "bought" только когда оплатили все).
  paidByMe: boolean;
  // Когда снимется бронь (или неоплаченная доля в "скинуться") текущего
  // зрителя, если он не отметит покупку/перевод. Приходит только самому
  // держателю, иначе null. ISO-строка.
  reservationExpiresAt: string | null;
  // "Дарить неанонимно" (CLAUDE.md, 2026-10-02) - имена дарителей,
  // которые сами решили раскрыться (см. revealIdentity в reserveItem).
  // Непустой массив приходит только владельцу вишлиста - остальным
  // зрителям бэкенд всегда отдаёт [], даже если кто-то раскрылся (п.2
  // спеки - раскрытие работает только в сторону получателя).
  // Только в GET /api/items/:id (QB4-1) - куда ведёт "Назад" с экрана подарка.
  wishlistSlug?: string;
  giverNames: string[];
  // QA-10: зритель - владелец вишлиста (бронировать своё нельзя).
  viewerIsOwner: boolean;
  // Сбор по ссылке банка (ТЗ блок 4): сам факт виден всем, ссылка -
  // только участникам складчины и владельцу.
  hasFundraiser: boolean;
  fundraiserUrl: string | null;
}

export interface WishlistResponse {
  slug: string;
  // Беклог В-10: получатель, открывший свою же ссылку "Поделиться", не
  // должен видеть экран приглашения "чужого" человека.
  isOwner: boolean;
  // Имя самого списка (CLAUDE.md, 2026-10-02, "сделай 3 и названия для
  // них") - для переключателя в MyWishlist.tsx. Не то же самое, что
  // occasionTitle ниже - это повод с датой, не имя списка.
  title: string;
  // Повод (CLAUDE.md, 2026-10-02) - необязательный, задаёт владелец.
  // Оба поля вместе: либо оба заданы, либо оба null, см.
  // backend/src/routes/wishlists.ts (PATCH).
  occasionTitle: string | null;
  occasionDate: string | null;
  items: Item[];
}

export interface MyWishlistSummary {
  slug: string;
  title: string;
  itemCount: number;
}

export interface PoolResponse {
  id: string;
  title: string;
  targetAmount: number | null;
  collected: number;
  deadline: string;
  status: "open" | "collected" | "expired";
  viewerIsOrganizer: boolean;
  contributions: { amount: number; createdAt: string }[];
}

export const api = {
  // До 3 вишлистов на человека (CLAUDE.md, 2026-10-02) - каждый вызов
  // создаёт НОВЫЙ список (title - необязательное имя, иначе бэкенд сам
  // подставит "Вишлист N"). В отличие от старого поведения, этот вызов
  // больше не идемпотентен - см. getMyWishlists ниже для восстановления
  // уже существующих списков.
  createWishlist: (title?: string, onlyIfNone?: boolean) =>
    request<{ id: string; slug: string; title: string }>("/api/wishlists", {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId(), title, onlyIfNone }),
    }),

  // Все вишлисты текущего пользователя - переключатель в MyWishlist.tsx
  // и восстановление при утере localStorage (тот же сценарий, что
  // раньше решал беклог Н-2, просто теперь на фронте, а не неявно на
  // бэкенде - см. комментарий у POST /api/wishlists).
  getMyWishlists: () => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<{ wishlists: MyWishlistSummary[] }>(`/api/wishlists/mine${qs}`);
  },

  renameWishlist: (slug: string, title: string) =>
    request<{ title: string }>(`/api/wishlists/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ title, telegramId: getTelegramId() }),
    }),

  getWishlist: (slug: string) => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<WishlistResponse>(`/api/wishlists/${slug}${qs}`);
  },

  getItem: (itemId: string) => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<Item>(`/api/items/${itemId}${qs}`);
  },

  addItem: (
    slug: string,
    data: {
      url: string;
      title?: string;
      price?: number;
      selfPurchased?: boolean;
      sbpPhone?: string;
      maxContributors?: number;
      fundraiserUrl?: string;
    },
  ) =>
    request<Item>(`/api/wishlists/${slug}/items`, {
      method: "POST",
      body: JSON.stringify({ ...data, telegramId: getTelegramId() }),
    }),

  // Телефон для СБП - реквизит получателя, переиспользуется для всех его
  // самостоятельных покупок (см. backend/src/routes/wishlists.ts) - нужен,
  // чтобы не просить вводить его заново при каждой новой позиции.
  // calendarToken - секрет в URL личной подписки на календарь поводов
  // (CLAUDE.md, 2026-10-02) - см. CalendarSheet.
  getMe: () => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<{ sbpPhone: string | null; calendarToken: string | null }>(`/api/me${qs}`);
  },

  // Повод вишлиста (CLAUDE.md, 2026-10-02) - оба поля вместе, null+null
  // снимает повод целиком.
  setOccasion: (slug: string, occasionTitle: string | null, occasionDate: string | null) =>
    request<{ occasionTitle: string | null; occasionDate: string | null }>(`/api/wishlists/${slug}`, {
      method: "PATCH",
      body: JSON.stringify({ occasionTitle, occasionDate, telegramId: getTelegramId() }),
    }),

  reserveItem: (itemId: string, revealIdentity?: boolean) =>
    request(`/api/items/${itemId}/reserve`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId(), revealIdentity }),
    }),

  markBought: (itemId: string) =>
    request(`/api/items/${itemId}/mark-bought`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  // Беклог Н-4: бэкенд (DELETE /api/items/:itemId) был реализован и
  // авторизован ещё при фиксе Б-2, но во фронтенде не было вызова вообще.
  deleteItem: (itemId: string) =>
    request(`/api/items/${itemId}`, {
      method: "DELETE",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  toggleItemPriority: (itemId: string) =>
    request<{ priority: boolean }>(`/api/items/${itemId}/priority`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  updateItem: (
    itemId: string,
    data: {
      title?: string;
      price?: number | null;
      url?: string;
      maxContributors?: number;
      fundraiserUrl?: string | null;
      selfPurchased?: boolean;
      sbpPhone?: string;
      priority?: boolean;
      refreshPreview?: boolean;
    },
  ) =>
    request<Item>(`/api/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...data, telegramId: getTelegramId() }),
    }),

  createPool: (data: {
    title: string;
    occasionDate?: string;
    targetAmount?: number;
    durationDays: 7 | 14 | 30;
  }) =>
    request<{ id: string }>("/api/pools", {
      method: "POST",
      body: JSON.stringify({ ...data, telegramId: getTelegramId() }),
    }),

  getPool: (id: string) => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<PoolResponse>(`/api/pools/${id}${qs}`);
  },

  extendPool: (id: string) =>
    request<{ deadline: string }>(`/api/pools/${id}/extend`, {
      method: "POST",
      body: JSON.stringify({ days: 7 }),
    }),

  contribute: (id: string, amount: number) =>
    request(`/api/pools/${id}/contribute`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId(), amount }),
    }),
};

// ТЗ блок 4 (логи): клиентские события копятся в очередь и уходят пачкой
// раз в 3 секунды или при сворачивании мини-аппа. Ошибки отправки молча
// игнорируются - аналитика не должна мешать интерфейсу.
type ClientProps = Record<string, string | number | boolean>;
const eventQueue: { name: string; props?: ClientProps }[] = [];
let flushTimer: number | undefined;

function flushEvents() {
  flushTimer = undefined;
  if (eventQueue.length === 0) return;
  const events = eventQueue.splice(0, 20);
  try {
    void fetch(`${API_BASE}/api/events`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": getInitData() },
      body: JSON.stringify({ telegramId: getTelegramId(), events }),
    }).catch(() => {});
  } catch {
    // ignore
  }
  if (eventQueue.length > 0) flushTimer = window.setTimeout(flushEvents, 3000);
}

export function trackEvent(name: string, props?: ClientProps) {
  if (eventQueue.length >= 200) return;
  eventQueue.push({ name, props });
  if (flushTimer === undefined) flushTimer = window.setTimeout(flushEvents, 3000);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushEvents();
  });
}
