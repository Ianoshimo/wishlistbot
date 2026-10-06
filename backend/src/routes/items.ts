import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { InlineKeyboard } from "grammy";
import { db } from "../db.js";
import { reservationDeadline, resolveExpiredReservation } from "../services/reservation.js";
import { resolveItem, serializeItemView } from "../services/itemView.js";
import { resolveTelegramId, telegramIdSchema } from "../auth/telegramAuth.js";
import { upsertUserByTelegramId } from "../services/userUpsert.js";
import { bot } from "../bot/bot.js";

function requireTelegramId(req: FastifyRequest, bodyTelegramId: string | undefined): string | null {
  const initData = req.headers["x-telegram-init-data"];
  return resolveTelegramId(typeof initData === "string" ? initData : undefined, bodyTelegramId);
}

// Уведомление получателю о покупке (CLAUDE.md, 2026-10-01) - до сих пор
// получатель не получал вообще никакой обратной связи, когда даритель
// отмечал подарок купленным. Личность дарителя по-прежнему не
// раскрывается (п.2 спеки) - сообщение нарочно безличное. Срыв отправки
// (пользователь заблокировал бота, не запускал его ни разу) не должен
// ронять сам запрос.
//
// "Поблагодарить дарителя" (CLAUDE.md, 2026-10-02) - кнопка под
// уведомлением только для selfPurchased: получатель жмёт её, бот сам
// резолвит дарителя(ей) этой позиции (см. bot/bot.ts, bot.callbackQuery
// "thank:") и пересылает фото/видео напрямую, получатель не видит кому.
async function notifyOwnerPurchased(app: FastifyInstance, wishlistId: string, itemId: string, selfPurchased: boolean) {
  try {
    const wishlist = await db.wishlist.findUnique({
      where: { id: wishlistId },
      select: { owner: { select: { telegramId: true } } },
    });
    if (!wishlist) return;
    await bot.api.sendMessage(
      wishlist.owner.telegramId.toString(),
      "🎁 Один из подарков в вашем вишлисте отмечен как купленный",
      selfPurchased
        ? { reply_markup: new InlineKeyboard().text("🎁 Поблагодарить дарителя", `thank:${itemId}`) }
        : undefined,
    );
  } catch (err) {
    app.log.warn({ err }, "Не удалось отправить уведомление о покупке");
  }
}

// Спека итерации 1, п.2-3: бронирование с TTL и доверительная отметка
// "куплено" (без колбэка маркетплейса - вне скоупа итерации 1).

export async function itemRoutes(app: FastifyInstance) {
  app.get("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const { telegramId: queryTelegramId } = z
      .object({ telegramId: z.string().regex(telegramIdSchema).optional() })
      .parse(req.query);

    const item = await resolveItem(itemId);
    const wishlist = await db.wishlist.findUniqueOrThrow({
      where: { id: item.wishlistId },
      include: { owner: true },
    });

    const telegramId = requireTelegramId(req, queryTelegramId);
    // Беклог В-10/В-6: владелец, открывший свою же позицию, видит имена
    // раскрывшихся дарителей (см. serializeItemView) - остальные зрители
    // только сравнение "забронировано мной", без identity.
    const isOwnerViewer = Boolean(telegramId && wishlist.owner.telegramId === BigInt(telegramId));
    const viewer = telegramId ? await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } }) : null;

    return serializeItemView(item, item.giftShares, wishlist.owner.sbpPhone, viewer?.id ?? null, isOwnerViewer);
  });

  app.post("/api/items/:itemId/reserve", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z
      .object({ telegramId: z.string().optional(), revealIdentity: z.boolean().optional() })
      .parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await resolveExpiredReservation(itemId);

    // Беклог Б-1: получатель не может бронировать собственный подарок -
    // сравниваем telegramId с владельцем вишлиста до создания брони.
    const wishlist = await db.wishlist.findUniqueOrThrow({
      where: { id: item.wishlistId },
      include: { owner: true },
    });
    if (wishlist.owner.telegramId === BigInt(telegramId)) {
      return reply.code(403).send({ error: "cannot_reserve_own_item" });
    }

    const user = await upsertUserByTelegramId(telegramId);

    // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - несколько
    // дарителей делят одну позицию, каждый бронирует свою долю отдельной
    // записью GiftShare, вместо единственного reservedByUserId ниже.
    if (item.maxContributors > 1) {
      if (item.status === "bought") {
        return reply.code(409).send({ error: "item_not_available" });
      }
      const existingCount = await db.giftShare.count({ where: { itemId } });
      if (existingCount >= item.maxContributors) {
        return reply.code(409).send({ error: "item_not_available" });
      }
      try {
        await db.giftShare.create({
          data: { itemId, userId: user.id, visible: Boolean(body.revealIdentity) },
        });
      } catch {
        // @@unique([itemId, userId]) - тот же человек уже присоединился
        // (гонка двух кликов), фронт и так прячет кнопку при reservedByMe.
        return reply.code(409).send({ error: "item_not_available" });
      }
      return { status: "reserved" };
    }

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
        // "Дарить неанонимно" (CLAUDE.md, 2026-10-02) - решение
        // фиксируется один раз, в момент брони, не меняется позже.
        reservedByVisible: Boolean(body.revealIdentity),
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
    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    if (!user) return reply.code(403).send({ error: "not_your_reservation" });

    // "Скинуться на подарок" - каждый дольщик отмечает СВОЮ часть
    // независимо, не дожидаясь остальных (доверительная самоотметка, как
    // и classic-путь ниже). Позиция становится "bought", только когда
    // оплатили все, кто успел присоединиться к полному набору долей.
    if (item.maxContributors > 1) {
      const share = await db.giftShare.findUnique({
        where: { itemId_userId: { itemId, userId: user.id } },
      });
      if (!share) return reply.code(403).send({ error: "not_your_reservation" });

      if (!share.paid) {
        await db.giftShare.update({ where: { id: share.id }, data: { paid: true, paidAt: new Date() } });
      }

      const shares = await db.giftShare.findMany({ where: { itemId } });
      const allPaid = shares.length === item.maxContributors && shares.every((s) => s.paid);
      if (allPaid && item.status !== "bought") {
        await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
        await notifyOwnerPurchased(app, item.wishlistId, item.id, item.selfPurchased);
      }
      return { status: allPaid ? "bought" : "reserved" };
    }

    if (item.status !== "reserved") {
      return reply.code(409).send({ error: "item_not_reserved" });
    }
    if (item.reservedByUserId !== user.id) {
      return reply.code(403).send({ error: "not_your_reservation" });
    }

    await db.item.update({ where: { id: itemId }, data: { status: "bought" } });

    // Продукт 2026-10-01: получатель не может отметить свою же позицию
    // купленной (бронь всегда чужая, см. cannot_reserve_own_item выше) -
    // значит уведомляемый владелец и дёргающий этот роут всегда разные
    // люди, отдельная проверка не нужна.
    await notifyOwnerPurchased(app, item.wishlistId, item.id, item.selfPurchased);

    return { status: "bought" };
  });

  // "Хочу больше всего" (CLAUDE.md, 2026-10-01) - тоггл получателя на
  // своей же позиции, чтобы даритель видел приоритет, когда позиций много.
  // Переключает получатель - как и добавление/удаление позиций, только
  // владелец вишлиста (та же граница, что в Б-14/Б-2).
  app.post("/api/items/:itemId/priority", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { wishlist: { include: { owner: true } } },
    });
    if (item.wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    const updated = await db.item.update({
      where: { id: itemId },
      data: { priority: !item.priority },
    });
    return { priority: updated.priority };
  });

  // Редактирование позиции (CLAUDE.md, 2026-10-01) - раньше опечатку в
  // цене/ссылке можно было только удалить и добавить заново. Только
  // владелец, только явно присланные поля - без повторной подгрузки
  // превью, правка нужна для быстрого исправления, а не пересоздания.
  app.patch("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z
      .object({
        telegramId: z.string().optional(),
        title: z.string().min(1).optional(),
        price: z.number().int().positive().nullable().optional(),
        url: z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme").optional(),
      })
      .parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { wishlist: { include: { owner: true } } },
    });
    if (item.wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    await db.item.update({
      where: { id: itemId },
      data: {
        title: body.title,
        price: body.price,
        url: body.url,
      },
    });

    const updated = await resolveItem(itemId);
    // Правит только владелец, и об изменении полей брони/доли речи не
    // идёт - viewerUserId не важен (владелец не бронирует сам у себя,
    // см. cannot_reserve_own_item), а isOwnerViewer=true просто
    // позволяет сразу увидеть раскрывшихся дарителей, как и на GET.
    return serializeItemView(updated, updated.giftShares, item.wishlist.owner.sbpPhone, null, true);
  });

  // Беклог Н-4: удаление позиции - свайпом в MyWishlist.tsx. Только
  // владелец (та же граница, что у остальных владельческих действий).
  // GiftShare.item - onDelete: Cascade (см. schema.prisma), так что доли
  // "скинуться" удаляются вместе с позицией без отдельного запроса.
  app.delete("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const item = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { wishlist: { include: { owner: true } } },
    });
    if (item.wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    await db.item.delete({ where: { id: itemId } });
    return reply.code(204).send();
  });
}
