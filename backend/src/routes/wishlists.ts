import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { resolveExpiredReservation } from "../services/reservation.js";

// Спека итерации 1, п.1, п.6, п.9: получатель ведёт вишлист, доступ по
// ссылке без отдельной регистрации, личность дарителя не раскрывается
// нигде в ответах (см. serializeItem ниже).

function serializeItem(item: Awaited<ReturnType<typeof db.item.findFirstOrThrow>>) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    price: item.price,
    status: item.status,
    // reservedByUserId сознательно не отдаём наружу - п.2 спеки:
    // "личность дарителя не показывается никому, включая получателя".
  };
}

export async function wishlistRoutes(app: FastifyInstance) {
  app.post("/api/wishlists", async (req, reply) => {
    const body = z.object({ telegramId: z.string() }).parse(req.body);

    const owner = await db.user.upsert({
      where: { telegramId: BigInt(body.telegramId) },
      update: {},
      create: { telegramId: BigInt(body.telegramId), firstName: "" },
    });

    const wishlist = await db.wishlist.create({ data: { ownerId: owner.id } });
    return reply.code(201).send({ id: wishlist.id, slug: wishlist.slug });
  });

  app.get("/api/wishlists/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);

    const wishlist = await db.wishlist.findUnique({
      where: { slug },
      include: { items: true },
    });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });

    const items = await Promise.all(
      wishlist.items.map((i) => resolveExpiredReservation(i.id)),
    );

    return { slug: wishlist.slug, items: items.map(serializeItem) };
  });

  app.post("/api/wishlists/:slug/items", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const body = z
      .object({
        url: z.string().url(),
        title: z.string().optional(),
        price: z.number().int().positive().optional(), // копейки
      })
      .parse(req.body);

    const wishlist = await db.wishlist.findUnique({ where: { slug } });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });

    const item = await db.item.create({
      data: { wishlistId: wishlist.id, ...body },
    });
    return reply.code(201).send(serializeItem(item));
  });

  app.delete("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string() }).parse(req.body);

    // Беклог Б-2: удаление раньше не требовало вообще никакой
    // авторизации - теперь проверяем, что запрос пришёл от владельца
    // вишлиста, которому принадлежит позиция.
    const item = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { wishlist: { include: { owner: true } } },
    });
    if (item.wishlist.owner.telegramId !== BigInt(body.telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    await db.item.delete({ where: { id: itemId } });
    return reply.code(204).send();
  });
}
