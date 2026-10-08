import { InlineKeyboard } from "grammy";
import { db } from "../db.js";
import { env } from "../env.js";
import { giftShareDeadline, RESERVATION_TTL_DAYS } from "./reservation.js";
import { daysLeft, reminderText } from "./giverMessages.js";
import { payoutProp, track } from "./analytics.js";
import { miniAppUrl, sendToUser } from "../bot/notify.js";

// Аудит 2026-10-08, А-14 (решение владельца): дарителю, который
// забронировал подарок или взял долю складчины и ещё не отметил
// покупку/перевод, бот раз в сутки напоминает - что за подарок, чей
// список, сколько осталось до снятия брони, кнопка открыть подарок.
//
// - Не чаще раза в сутки на бронь/долю, первое - через сутки после брони.
//   Время последнего - в БД (Item.lastReminderAt / GiftShare.lastReminderAt),
//   переживает рестарт.
// - Перестаём: подарок куплен, доля оплачена, бронь снята или истекла,
//   подарок удалён - всё это просто выпадает из выборки.
// - Окно отправки 10:00-21:00 по Москве - ночью не пишем.
// - Планировщик - setInterval в процессе (на Railway один инстанс).
//   Защита от двойной отправки: тики не перекрываются (флаг running), и
//   каждое напоминание сначала "захватывается" условным UPDATE по старому
//   значению lastReminderAt - отправляет только тот, кто обновил строку
//   (так безопасно и при случайном втором инстансе).

export const REMINDER_PERIOD_MS = 24 * 60 * 60 * 1000;
// Москва - UTC+3 круглый год (перехода на летнее время нет с 2014).
const MSK_OFFSET_HOURS = 3;
export const SEND_WINDOW = { fromHour: 10, toHour: 21 };

export function isSendWindow(now: Date): boolean {
  const hour = (now.getUTCHours() + MSK_OFFSET_HOURS) % 24;
  return hour >= SEND_WINDOW.fromHour && hour < SEND_WINDOW.toHour;
}

// Пора ли напоминать: бронь ещё живая и с момента брони (или прошлого
// напоминания) прошли сутки.
export function reminderDue(anchor: Date, lastReminderAt: Date | null, expiresAt: Date, now: Date): boolean {
  if (expiresAt.getTime() <= now.getTime()) return false;
  const base = lastReminderAt ?? anchor;
  return now.getTime() - base.getTime() >= REMINDER_PERIOD_MS;
}

function keyboardFor(itemId: string) {
  return new InlineKeyboard().webApp("Открыть подарок", miniAppUrl(`/item/${itemId}`));
}

const BATCH = 200;

export async function runReminderTick(now: Date = new Date()): Promise<{ sent: number; skipped?: "quiet_hours" }> {
  if (!isSendWindow(now)) return { sent: 0, skipped: "quiet_hours" };
  const dayAgo = new Date(now.getTime() - REMINDER_PERIOD_MS);
  let sent = 0;

  // Обычная бронь (один даритель).
  const items = await db.item.findMany({
    where: {
      status: "reserved",
      maxContributors: { lte: 1 },
      reservedByUserId: { not: null },
      reservationTtl: { gt: now },
      OR: [{ lastReminderAt: null, reservedAt: { lte: dayAgo } }, { lastReminderAt: { lte: dayAgo } }],
    },
    include: { reservedBy: true, wishlist: { include: { owner: true } } },
    take: BATCH,
  });
  for (const item of items) {
    if (!item.reservedBy || !item.reservedAt || !item.reservationTtl) continue;
    if (!reminderDue(item.reservedAt, item.lastReminderAt, item.reservationTtl, now)) continue;
    const claimed = await db.item.updateMany({
      where: {
        id: item.id,
        status: "reserved",
        reservedByUserId: item.reservedByUserId,
        lastReminderAt: item.lastReminderAt,
      },
      data: { lastReminderAt: now },
    });
    if (claimed.count !== 1) continue;
    const days = daysLeft(item.reservationTtl, now);
    const delivered = await sendToUser(
      item.reservedBy.telegramId,
      reminderText({
        itemTitle: item.title,
        wishlistTitle: item.wishlist.title,
        ownerName: item.wishlist.owner.firstName,
        payoutMethod: item.payoutMethod,
        split: false,
        days,
      }),
      keyboardFor(item.id),
      `reminder item=${item.id}`,
    );
    track("reminder_sent", {
      userId: item.reservedBy.id,
      wishlistId: item.wishlistId,
      itemId: item.id,
      props: { mode: "classic", payoutMethod: payoutProp(item.payoutMethod), daysLeft: days, delivered },
    });
    sent++;
  }

  // Доли складчины: неоплаченные, подарок не собран, доля не истекла.
  // Тот же срок, что в resolveExpiredGiftShares: доли старше TTL уже не живые.
  const ttlCutoff = new Date(now);
  ttlCutoff.setDate(ttlCutoff.getDate() - RESERVATION_TTL_DAYS);
  const shares = await db.giftShare.findMany({
    where: {
      paid: false,
      createdAt: { gt: ttlCutoff },
      item: { status: { not: "bought" } },
      OR: [{ lastReminderAt: null, createdAt: { lte: dayAgo } }, { lastReminderAt: { lte: dayAgo } }],
    },
    include: { user: true, item: { include: { wishlist: { include: { owner: true } } } } },
    take: BATCH,
  });
  for (const share of shares) {
    const expiresAt = giftShareDeadline(share.createdAt);
    if (!reminderDue(share.createdAt, share.lastReminderAt, expiresAt, now)) continue;
    const claimed = await db.giftShare.updateMany({
      where: { id: share.id, paid: false, lastReminderAt: share.lastReminderAt },
      data: { lastReminderAt: now },
    });
    if (claimed.count !== 1) continue;
    const days = daysLeft(expiresAt, now);
    const delivered = await sendToUser(
      share.user.telegramId,
      reminderText({
        itemTitle: share.item.title,
        wishlistTitle: share.item.wishlist.title,
        ownerName: share.item.wishlist.owner.firstName,
        payoutMethod: share.item.payoutMethod,
        split: true,
        days,
      }),
      keyboardFor(share.itemId),
      `reminder share item=${share.itemId}`,
    );
    track("reminder_sent", {
      userId: share.userId,
      wishlistId: share.item.wishlistId,
      itemId: share.itemId,
      props: { mode: "split", payoutMethod: payoutProp(share.item.payoutMethod), daysLeft: days, delivered },
    });
    sent++;
  }

  return { sent };
}

let running = false;

// Один тик за раз: если прошлый ещё идёт (медленный Telegram), новый
// пропускается. Ошибка тика логируется и не роняет процесс.
export async function reminderTickSafe(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await runReminderTick(new Date());
    if (r.sent > 0) console.info(`[reminders] отправлено напоминаний: ${r.sent}`);
  } catch (err) {
    console.error("[reminders] Ошибка тика напоминаний", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startReminderScheduler(): void {
  const tick = env.REMINDER_TICK_MS;
  if (!tick) return; // 0 - выключено (например, локально без бота)
  setInterval(() => void reminderTickSafe(), tick).unref();
  // Первый проход вскоре после старта - не ждём целый интервал после деплоя.
  setTimeout(() => void reminderTickSafe(), Math.min(tick, 15_000)).unref();
}
