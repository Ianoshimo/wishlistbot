import { db } from "../db.js";

// Спека итерации 1, п.2: TTL брони - 5 дней, обоснование там же.
export const RESERVATION_TTL_DAYS = 5;

export function reservationDeadline(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + RESERVATION_TTL_DAYS);
  return d;
}

// Ленивая проверка вместо фоновой джобы для MVP: если бронь просрочена,
// снимаем её при первом же обращении к позиции. Реальный крон-джоб можно
// добавить позже без изменения контракта наружу.
export async function resolveExpiredReservation(itemId: string) {
  const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
  if (item.maxContributors > 1 && item.status !== "bought") {
    await resolveExpiredGiftShares(itemId);
  }
  if (
    item.status === "reserved" &&
    item.reservationTtl &&
    item.reservationTtl < new Date()
  ) {
    return db.item.update({
      where: { id: itemId },
      data: {
        status: "available",
        reservedByUserId: null,
        reservedAt: null,
        reservationTtl: null,
        // А-14: следующая бронь начинает отсчёт напоминаний заново.
        lastReminderAt: null,
      },
    });
  }
  return item;
}

// "Скинуться на подарок" (техдолг, 2026-10-07): раньше у доли TTL не было
// - дольщик, который присоединился и не перевёл, навсегда занимал место, и
// позиция зависала. Продуктовое решение - тот же срок, что у обычной
// брони (RESERVATION_TTL_DAYS от присоединения, GiftShare.createdAt).
// Неоплаченная просроченная доля снимается так же лениво, при чтении;
// место снова свободно. Оплаченные доли не снимаются никогда - деньги
// уже ушли получателю по СБП. Вызывается из resolveExpiredReservation,
// поэтому работает везде, где classic-бронь уже проверялась (resolveItem,
// /reserve, /mark-bought). Позиции в статусе "bought" не трогаем - там
// все доли и так оплачены.
export function giftShareDeadline(joinedAt: Date): Date {
  return reservationDeadline(joinedAt);
}

export async function resolveExpiredGiftShares(itemId: string, now: Date = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RESERVATION_TTL_DAYS);
  return db.giftShare.deleteMany({
    where: { itemId, paid: false, createdAt: { lt: cutoff } },
  });
}
