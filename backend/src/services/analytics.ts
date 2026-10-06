import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { env } from "../env.js";

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
  };
  // Бронь позиции (classic) или присоединение к доле ("скинуться").
  item_reserved: { mode: ReserveMode; revealIdentity: boolean; selfPurchased: boolean; store: string | null };
  // Даритель отметил "куплено" (classic) или "оплатил свою долю" (split).
  purchase_marked: { mode: ReserveMode; selfPurchased: boolean };
  // Позиция окончательно перешла в bought (для split - когда оплатили все).
  item_bought: {
    mode: ReserveMode;
    selfPurchased: boolean;
    store: string | null;
    price: number | null;
    contributors: number;
    occasionMonthDay: string | null;
  };
  // monthDay - "MM-DD", без года: повод обычно годовой.
  occasion_set: { title: string; monthDay: string };
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
  // Получатель отправил благодарность (фото/видео) дарителю(ям) через бота.
  thanks_sent: { mediaType: "photo" | "video" | "video_note"; recipients: number; delivered: number };
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
  "thanks_sent",
] as const satisfies readonly EventType[];

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
