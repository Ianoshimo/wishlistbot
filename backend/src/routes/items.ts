import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { reservationDeadline, resolveExpiredReservation } from "../services/reservation.js";
import { resolveTelegramId } from "../auth/telegramAuth.js";

function requireTelegramId(req: FastifyRequest, bodyTelegramId: string | undefined): string | null {
  const initData = req.headers["x-telegram-init-data"];
  return resolveTelegramId(typeof initData === "string" ? initData : undefined, bodyTelegramId);
}

// Спека итерации 1, п.2-3: бронирование с TTL и доверительная отметка
// "куплено" (без колбэка маркетплейса - вне скоупа итерации 1).

export async function itemRoutes(app: FastifyInstance) {
  app.get("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const item = await resolveExpiredReservation(itemId);

    // Номер телефона получателя отдаём только после брони (см. п.5 в
    // задаче) - до этого момента дарителю ещё нечего переводить, а до
    // решения "беру" номер превращать телефон в выдаваемую-всем-подряд-
    // по-ссылке строку нет смысла.
    let sbpPhone: string | null = null;
    if (item.selfPurchased && item.status !== "available") {
      const wishlist = await db.wishlist.findUnique({
        where: { id: item.wishlistId },
        select: { owner: { select: { sbpPhone: true } } },
      });
      sbpPhone = wishlist?.owner.sbpPhone ?? null;
    }

    return {
      id: item.id,
      url: item.url,
      title: item.title,
      price: item.price,
      imageUrl: item.imageUrl,
      status: item.status,
      selfPurchased: item.selfPurchased,
      sbpPhone,
    };
  });

  app.post("/api/items/:itemId/reserve", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await resolveExpiredReservation(itemId);
    if (item.status !== "available") {
      return reply.code(409).send({ error: "item_not_available" });
    }

    // Беклог Б-1: получатель не может бронировать собственный подарок -
    // сравниваем telegramId с владельцем вишлиста до создания брони.
    const wishlist = await db.wishlist.findUniqueOrThrow({
      where: { id: item.wishlistId },
      include: { owner: true },
    });
    if (wishlist.owner.telegramId === BigInt(telegramId)) {
      return reply.code(403).send({ error: "cannot_reserve_own_item" });
    }

    const user = await db.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {},
      create: { telegramId: BigInt(telegramId), firstName: "" },
    });

    // Беклог Б-5: между чтением статуса выше и этой записью мог успеть
    // проскочить параллельный запрос - поэтому статус проверяется прямо в
    // условии обновления (атомарно на уровне БД), а не полагается на
    // проверку выше. Если строк не затронуто - позицию увели, пока мы
    // готовили пользователя.
    const now = new Date();
    const result = await db.item.updateMany({
      where: { id: itemId, status: "available" },
      data: {
        status: "reserved",
        reservedByUserId: user.id,
        reservedAt: now,
        reservationTtl: reservationDeadline(now),
      },
    });
    if (result.count === 0) {
      return reply.code(409).send({ error: "item_not_available" });
    }

    return { status: "reserved" };
  });

  app.post("/api/items/:itemId/mark-bought", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await resolveExpiredReservation(itemId);
    if (item.status !== "reserved") {
      return reply.code(409).send({ error: "item_not_reserved" });
    }

    const user = await db.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });
    if (!user || item.reservedByUserId !== user.id) {
      return reply.code(403).send({ error: "not_your_reservation" });
    }

    await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
    return { status: "bought" };
  });
}
