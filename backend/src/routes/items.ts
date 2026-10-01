import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { reservationDeadline, resolveExpiredReservation } from "../services/reservation.js";
import { resolveTelegramId, telegramIdSchema } from "../auth/telegramAuth.js";

function requireTelegramId(req: FastifyRequest, bodyTelegramId: string | undefined): string | null {
  const initData = req.headers["x-telegram-init-data"];
  return resolveTelegramId(typeof initData === "string" ? initData : undefined, bodyTelegramId);
}

// Спека итерации 1, п.2-3: бронирование с TTL и доверительная отметка
// "куплено" (без колбэка маркетплейса - вне скоупа итерации 1).

export async function itemRoutes(app: FastifyInstance) {
  app.get("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const { telegramId: queryTelegramId } = z
      .object({ telegramId: z.string().regex(telegramIdSchema).optional() })
      .parse(req.query);
    const item = await resolveExpiredReservation(itemId);

    // Беклог В-6: раньше фронт считал бронь "своей" безусловно при
    // status === "reserved" - получатель на своей же позиции тоже видел
    // "Забронировано вами". reservedByUserId наружу по-прежнему не
    // отдаём (анонимность дарителя) - только булево сравнение.
    let reservedByMe = false;
    if (item.reservedByUserId) {
      const telegramId = requireTelegramId(req, queryTelegramId);
      if (telegramId) {
        const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
        reservedByMe = user?.id === item.reservedByUserId;
      }
    }

    // Находка Н-1 полного QA-прогона (2026-10-01): номер телефона
    // получателя раньше отдавался любому, кто открыл ссылку, как только
    // status !== "available" - не только дарителю, который реально
    // забронировал. Это настоящий номер телефона человека, привязанный к
    // реальному переводу денег - отдаём его строго держателю брони,
    // ровно та же граница, что уже защищает "Отметить купленным".
    let sbpPhone: string | null = null;
    if (item.selfPurchased && reservedByMe) {
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
      reservedByMe,
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
