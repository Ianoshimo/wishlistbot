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

// sbpPhone передаётся отдельно (не берётся из item), потому что это
// реквизит владельца вишлиста, а не самой позиции - см. User.sbpPhone в
// schema.prisma. До брони (status === "available") номер не отдаём - см.
// то же правило в routes/items.ts.
function serializeItem(
  item: Awaited<ReturnType<typeof db.item.findFirstOrThrow>>,
  ownerSbpPhone: string | null = null,
) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    price: item.price,
    imageUrl: item.imageUrl,
    status: item.status,
    selfPurchased: item.selfPurchased,
    sbpPhone: item.selfPurchased && item.status !== "available" ? ownerSbpPhone : null,
    // reservedByUserId сознательно не отдаём наружу - п.2 спеки:
    // "личность дарителя не показывается никому, включая получателя".
  };
}

const PHONE_RE = /^[\d\s()+-]{10,20}$/;

export async function wishlistRoutes(app: FastifyInstance) {
  // Телефон для СБП - реквизит человека, не позиции (см. User.sbpPhone) -
  // фронту нужно подставить уже сохранённый номер при повторной отметке
  // "купил сам", чтобы не просить вводить его каждый раз заново.
  app.get("/api/me", async (req, reply) => {
    const query = z.object({ telegramId: z.string().optional() }).parse(req.query);
    const telegramId = requireTelegramId(req, query.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return { sbpPhone: user?.sbpPhone ?? null };
  });

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
      include: { items: true, owner: true },
    });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });

    const items = await Promise.all(
      wishlist.items.map((i) => resolveExpiredReservation(i.id)),
    );

    return {
      slug: wishlist.slug,
      items: items.map((i) => serializeItem(i, wishlist.owner.sbpPhone)),
    };
  });

  app.post("/api/wishlists/:slug/items", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const body = z
      .object({
        telegramId: z.string().optional(),
        // Беклог Б-8: z.string().url() считает "javascript:alert(1)"
        // валидным URL (валиден синтаксически, схема не ограничена) -
        // ограничиваем до http(s), иначе значение долетает до href кнопки
        // "Перейти в магазин" с target="_blank".
        url: z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme"),
        title: z.string().optional(),
        price: z.number().int().positive().optional(), // копейки
        // "Уже купил(а) сам(а)" (решение 2026-10-02, по просьбе
        // пользователя) - даритель переводит деньги напрямую получателю по
        // СБП вместо похода в магазин, см. User.sbpPhone.
        selfPurchased: z.boolean().optional(),
        sbpPhone: z.string().regex(PHONE_RE, "invalid_phone").optional(),
      })
      .parse(req.body);

    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const wishlist = await db.wishlist.findUnique({ where: { slug }, include: { owner: true } });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });

    // Беклог Б-14: эндпоинт раньше не проверял вообще никого - любой, кто
    // знает slug (а slug расшаривается дарителям), мог молча добавить
    // позиции в чужой вишлист. Добавлять позиции может только владелец.
    if (wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    // Номер нужен один раз - дальше переиспользуется для всех
    // самостоятельных покупок этого же получателя (см. комментарий у
    // User.sbpPhone в schema.prisma), поэтому новый присланный номер и
    // просто "уже сохранённый" номер - равноценные источники.
    let sbpPhone: string | undefined;
    if (body.selfPurchased) {
      sbpPhone = body.sbpPhone ?? wishlist.owner.sbpPhone ?? undefined;
      if (!sbpPhone) {
        return reply.code(400).send({ error: "sbp_phone_required" });
      }
      if (body.sbpPhone && body.sbpPhone !== wishlist.owner.sbpPhone) {
        await db.user.update({ where: { id: wishlist.ownerId }, data: { sbpPhone: body.sbpPhone } });
      }
    }

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
        url: body.url,
        price: body.price,
        selfPurchased: body.selfPurchased ?? false,
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
    return reply.code(201).send(serializeItem(item, sbpPhone ?? null));
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
