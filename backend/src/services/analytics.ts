import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../env.js";
import type { OccasionCategory } from "./occasionCategory.js";

// Продуктовая аналитика (2026-10-07) - события пишутся в собственную
// таблицу Event (см. schema.prisma), не в сторонний сервис. Отчёт -
// только CLI (scripts/analyticsReport.ts, `npm run analytics:report`),
// HTTP-эндпоинта нарочно нет - не добавляем поверхность атаки.
//
// Приватность: в props НИКОГДА не кладём sbpPhone, telegramId, имена,
// initData, тексты сообщений, file_id медиа. Пользователь - только
// внутренний User.id (или null для анонимного зрителя). Типы props ниже
// специально узкие, чтобы случайно не протащить лишнее.

export type ItemSource = "app" | "bot";
export type ReserveMode = "classic" | "split";
// Аудит 2026-10-08, А-5: способ получить деньги - только вид, без
// реквизитов (номер, банк, ссылка в аналитику не попадают).
export type PayoutProp = "sbp" | "fundraiser" | "none";
export function payoutProp(method: string | null | undefined): PayoutProp {
  return method === "sbp" || method === "fundraiser" ? method : "none";
}

export interface EventProps {
  // Пользователь отправил боту /start (флоу "Первый запуск").
  bot_started: { isNewUser: boolean };
  wishlist_created: { source: ItemSource; ordinal: number };
  item_added: {
    source: ItemSource;
    store: string | null;
    price: number | null; // копейки
    selfPurchased: boolean;
    maxContributors: number;
    payoutMethod: PayoutProp;
  };
  // Бронь позиции (classic) или присоединение к доле ("скинуться").
  item_reserved: { mode: ReserveMode; revealIdentity: boolean; selfPurchased: boolean; payoutMethod: PayoutProp; store: string | null };
  // Даритель отметил "куплено" (classic) или "оплатил свою долю" (split).
  purchase_marked: { mode: ReserveMode; selfPurchased: boolean; payoutMethod: PayoutProp };
  // Позиция окончательно перешла в bought (для split - когда оплатили все).
  item_bought: {
    mode: ReserveMode;
    selfPurchased: boolean;
    payoutMethod: PayoutProp;
    store: string | null;
    price: number | null;
    contributors: number;
    occasionMonthDay: string | null;
  };
  // monthDay - "MM-DD", без года: повод обычно годовой. Аудит 2026-10-08,
  // А-15: вместо свободного текста повода (там имена людей) - только
  // категория из закрытого списка (services/occasionCategory.ts).
  occasion_set: { category: OccasionCategory; monthDay: string };
  occasion_cleared: Record<string, never>;
  // Чужой вишлист открыт не владельцем - максимум одно событие на
  // зрителя+вишлист в сутки (dedupeKey).
  // anonymous - зритель без Telegram-идентичности; registered - у зрителя
  // уже есть запись User (иначе userId = null, а различать зрителей в
  // сутках помогает только dedupeKey, см. viewerKey()).
  wishlist_viewed: { anonymous: boolean; registered: boolean; itemCount: number };
  occasion_ics_downloaded: Record<string, never>;
  // Личная webcal-подписка опрошена календарём - одно событие на
  // пользователя в сутки (календари дёргают фид периодически).
  calendar_feed_fetched: { occasionCount: number };
  // Аудит 2026-10-08, А-22: открыта страница оформления подписки на
  // календарь (из мини-аппа внутри Telegram).
  calendar_subscribe_page_opened: Record<string, never>;
  // Получатель отправил благодарность (фото/видео) дарителю(ям) через бота.
  thanks_sent: { mediaType: "photo" | "video" | "video_note"; recipients: number; delivered: number };
  // ТЗ блок 4 (2026-10-07): логи "всего и вся".
  // Владелец отредактировал позицию - только имена изменённых полей
  // (sbpPhone - только имя, без значения) и состояние после правки.
  item_edited: {
    fields: string[];
    status: string;
    mode: ReserveMode;
    selfPurchased: boolean;
    payoutMethod: PayoutProp;
    contributors: number;
    previewRefreshed: boolean;
  };
  // Правка режима подарка отклонена правилами (ТЗ редактирования всех
  // полей): reason - код ошибки API.
  item_edit_blocked: { reason: string; status: string; mode: ReserveMode; contributors: number };
  // notified - скольким дарителям бот сообщил об удалении (А-13).
  item_deleted: { status: string; mode: ReserveMode; contributors: number; notified: number };
  item_priority_toggled: { priority: boolean };
  wishlist_renamed: Record<string, never>;
  // Изменено число участников складчины / ссылка на сбор.
  split_settings_changed: { from: number; to: number; fundraiser: boolean };
  // Ошибка API 5xx - маршрут-шаблон, не конкретный URL с id.
  api_error: { method: string; route: string; status: number };
  // Аудит 2026-10-08, А-14: напоминание держателю брони/доли (daysLeft -
  // сколько целых дней до снятия), delivered - Telegram принял сообщение.
  reminder_sent: { mode: ReserveMode; payoutMethod: PayoutProp; daysLeft: number; delivered: boolean };
  // Сообщение дарителю от бота: спасибо за отметку (А-14), подарок собран
  // (А-14), подарок удалён (А-13).
  giver_notified: { reason: "purchase_marked" | "gift_completed" | "item_deleted"; delivered: boolean };
}

export type EventType = keyof EventProps;
export const EVENT_TYPES = [
  "bot_started",
  "wishlist_created",
  "item_added",
  "item_reserved",
  "purchase_marked",
  "item_bought",
  "occasion_set",
  "occasion_cleared",
  "wishlist_viewed",
  "occasion_ics_downloaded",
  "calendar_feed_fetched",
  "calendar_subscribe_page_opened",
  "thanks_sent",
  "item_edited",
  "item_edit_blocked",
  "item_deleted",
  "item_priority_toggled",
  "wishlist_renamed",
  "split_settings_changed",
  "api_error",
  "reminder_sent",
  "giver_notified",
] as const satisfies readonly EventType[];

// Клиентские события (POST /api/events) - строгий белый список: имя
// события -> разрешённые поля props. В БД пишутся с префиксом "ui_".
// Всё, что не в списке, молча отбрасывается.
export const CLIENT_EVENTS: Record<string, readonly string[]> = {
  app_opened: ["platform", "tgVersion", "startKind", "colorScheme", "fullscreen", "insideTelegram"],
  screen_viewed: ["screen"],
  share_link_copied: [],
  // beforeReserve - ссылка открыта до брони (аудит 2026-10-08, А-11).
  store_link_clicked: ["store", "beforeReserve"],
  // А-16: "Отправить в Telegram" на экране "Поделиться".
  share_sent: [],
  fundraiser_link_clicked: [],
  sbp_details_copied: ["field"],
  calendar_add_clicked: [],
  calendar_subscribe_clicked: [],
  form_opened: ["form"],
  error_shown: ["code", "screen"],
  wishlist_switched: [],
  onboarding_create_clicked: [],
  // Аудит 2026-10-08, А-3: даритель с чужого списка пошёл заводить свой
  // (кнопка "Хочу такой же вишлист") - вирусная петля.
  own_wishlist_cta_clicked: ["from"],
};

const CLIENT_LIMIT_PER_MIN = 120;
const clientBuckets = new Map<string, { windowStart: number; count: number }>();

// Лимит на пользователя в минуту (в памяти процесса - на один инстанс
// бэкенда этого достаточно; сверх лимита события молча отбрасываются).
export function allowClientEvent(key: string, now = Date.now()): boolean {
  const b = clientBuckets.get(key);
  if (!b || now - b.windowStart >= 60_000) {
    clientBuckets.set(key, { windowStart: now, count: 1 });
    if (clientBuckets.size > 10_000) clientBuckets.clear();
    return true;
  }
  b.count += 1;
  return b.count <= CLIENT_LIMIT_PER_MIN;
}

// Оставляет только разрешённые для события поля примитивных типов,
// строки обрезаются до 100 символов. null - событие не из белого списка.
export function sanitizeClientEvent(name: unknown, rawProps: unknown): { type: string; props: Record<string, string | number | boolean> } | null {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(CLIENT_EVENTS, name)) return null;
  const allowed = CLIENT_EVENTS[name];
  const props: Record<string, string | number | boolean> = {};
  if (rawProps && typeof rawProps === "object") {
    for (const key of allowed) {
      const v = (rawProps as Record<string, unknown>)[key];
      if (typeof v === "string") props[key] = v.slice(0, 100);
      else if (typeof v === "number" && Number.isFinite(v)) props[key] = v;
      else if (typeof v === "boolean") props[key] = v;
    }
  }
  return { type: "ui_" + name, props };
}

// Запись клиентского события (тип уже проверен sanitizeClientEvent).
export function trackClient(type: string, userId: string | null, props: Record<string, string | number | boolean>): void {
  try {
    db.event
      .create({ data: { type, userId, props: props as Prisma.InputJsonValue } })
      .catch((err: unknown) => {
        console.warn("[analytics] не удалось записать событие", type, err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.warn("[analytics] не удалось записать событие", type, err instanceof Error ? err.message : err);
  }
}

export interface TrackContext<T extends EventType> {
  userId?: string | null;
  wishlistId?: string | null;
  itemId?: string | null;
  props?: EventProps[T];
  // Ключ дедупликации - повторное событие с тем же ключом молча
  // отбрасывается (unique-индекс в БД), см. dailyKey().
  dedupeKey?: string;
}

// "MM-DD" из даты повода (хранится как полночь UTC календарного дня, см.
// services/ics.ts toCalendarDay).
export function monthDay(date: Date): string {
  return date.toISOString().slice(5, 10);
}

// Ключ "одно событие на (части) в сутки по UTC".
export function dailyKey(type: EventType, ...parts: string[]): string {
  return [type, ...parts, new Date().toISOString().slice(0, 10)].join(":");
}

// Псевдоним зрителя для dedupeKey, когда записи User ещё нет (даритель
// впервые открыл ссылку, ни разу не бронировал и не запускал /start).
// telegramId в открытом виде в события не пишется - только HMAC с
// серверным секретом (BOT_TOKEN), необратимый без него.
export function viewerKey(userId: string | null | undefined, telegramId: string | null | undefined): string {
  if (userId) return userId;
  if (telegramId) return "tg-" + createHmac("sha256", env.BOT_TOKEN).update(telegramId).digest("hex").slice(0, 20);
  return "anon";
}

// Fire-and-forget: НЕ возвращает промис и никогда не бросает - сбой
// записи события (таблицы нет, БД недоступна, дубль dedupeKey) не должен
// ни ронять, ни замедлять основной запрос.
export function track<T extends EventType>(type: T, ctx: TrackContext<T> = {}): void {
  try {
    db.event
      .create({
        data: {
          type,
          userId: ctx.userId ?? null,
          wishlistId: ctx.wishlistId ?? null,
          itemId: ctx.itemId ?? null,
          props: (ctx.props ?? {}) as Prisma.InputJsonValue,
          dedupeKey: ctx.dedupeKey ?? null,
        },
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return; // дедуп
        console.warn("[analytics] не удалось записать событие", type, err instanceof Error ? err.message : err);
      });
  } catch (err) {
    console.warn("[analytics] не удалось записать событие", type, err instanceof Error ? err.message : err);
  }
}
