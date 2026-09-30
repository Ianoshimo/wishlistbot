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
      },
    });
  }
  return item;
}
