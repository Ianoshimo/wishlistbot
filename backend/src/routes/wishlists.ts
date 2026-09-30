import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { resolveExpiredReservation } from "../services/reservation.js";
import { deriveNameFromUrl, fetchLinkPreview } from "../services/linkPreview.js";
import { fetchWildberriesViaApify, isWildberriesUrl } from "../services/wildberriesApify.js";
import { resolveTelegramId } from "../auth/telegramAuth.js";

// Привязка логина через Telegram (2026-10-02): telegramId больше не
// берётся из тела запроса напрямую - только из проверенной подписи
// initData (см. auth/telegramAuth.ts), с фоллбэком на тело запроса в
// локальной разработке (ALLOW_DEV_TELEGRAM_ID).
function requireTelegramId(req: FastifyRequest, bodyTelegramId: string | undefined): string | null {
  const initData = req.headers["x-telegram-init-data"];
  return resolveTelegramId(typeof initData === "string" ? initData : undefined, bodyTelegramId);
}

// Спека итерации 1, п.1, п.6, п.9: получатель ведёт вишлист, доступ по
// ссылке без отдельной регистрации, личность дарителя не раскрывается
// нигде в ответах (см. serializeItem ниже).

function serializeItem(item: Awaited<ReturnType<typeof db.item.findFirstOrThrow>>) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    price: item.price,
    imageUrl: item.imageUrl,
    status: item.status,
    // reservedByUserId сознательно не отдаём наружу - п.2 спеки:
    // "личность дарителя не показывается никому, включая получателя".
  };
}

export async function wishlistRoutes(app: FastifyInstance) {
  app.post("/api/wishlists", async (req, reply) => {
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const owner = await db.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {},
      create: { telegramId: BigInt(telegramId), firstName: "" },
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

    // Автоподгрузка фото/названия по ссылке вместо ручной загрузки
    // (решение 2026-10-02, без партнёрок - см. services/linkPreview.ts).
    // Не у каждой ссылки получится - это ожидаемо, не блокируем сохранение.
    let preview = await fetchLinkPreview(body.url);

    // Wildberries блокирует свой og-парсинг антиботом даже через headless-
    // браузер (см. беклог, "найти бесплатное решение") - пока не найдём
    // бесплатный обход, добираем через платный актор на Apify.
    if (!preview.title && !preview.imageUrl) {
      try {
        const parsed = new URL(body.url);
        if (isWildberriesUrl(parsed)) {
          preview = await fetchWildberriesViaApify(body.url);
        }
      } catch {
        // невалидный URL уже отсеян схемой выше, но на всякий случай
      }
    }

    // Ссылка может вести прямо на картинку (см. fetchLinkPreview) - тогда
    // у самой картинки нет "названия", и разбирать путь CDN-ссылки ради
    // имени бессмысленно (получится мусор вроде хэша файла).
    const isDirectImage = preview.imageUrl === body.url;

    const item = await db.item.create({
      data: {
        wishlistId: wishlist.id,
        ...body,
        // Пользователь просил не голые ссылки, а названия (2026-10-02) -
        // title всегда непустой: свой ввод -> подтянутый по ссылке -> имя,
        // придуманное из самой ссылки (см. deriveNameFromUrl).
        title:
          body.title ??
          preview.title ??
          (isDirectImage ? "Фото по ссылке" : deriveNameFromUrl(body.url)),
        imageUrl: preview.imageUrl ?? undefined,
      },
    });
    return reply.code(201).send(serializeItem(item));
  });

  app.delete("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z.object({ telegramId: z.string().optional() }).parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    // Беклог Б-2: удаление раньше не требовало вообще никакой
    // авторизации - теперь проверяем, что запрос пришёл от владельца
    // вишлиста, которому принадлежит позиция.
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
