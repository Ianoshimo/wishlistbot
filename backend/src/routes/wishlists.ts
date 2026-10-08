import type { FastifyInstance, FastifyRequest } from "fastify";
import { occasionCategory } from "../services/occasionCategory.js";
import { preprocessUrlInput } from "../services/linkInput.js";
import { z } from "zod";
import { db } from "../db.js";
import { resolveItem, serializeItemView } from "../services/itemView.js";
import { createItemFromUrl } from "../services/itemCreate.js";
import { resolveTelegramId } from "../auth/telegramAuth.js";
import { upsertUserByTelegramId } from "../services/userUpsert.js";
import { buildIcsCalendar, toCalendarDay } from "../services/ics.js";
import { env } from "../env.js";
import { dailyKey, monthDay, track, viewerKey } from "../services/analytics.js";

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
// нигде в ответах (см. services/itemView.ts serializeItemView).

export const PHONE_RE = /^[\d\s()+-]{10,20}$/;
// ТЗ блок 4: складчина до 100 участников (раньше 10).
export const MAX_CONTRIBUTORS_CAP = 100;
// "Сделай 3 и названия для них" (CLAUDE.md, 2026-10-02) - продуктовый
// лимит, не структурное ограничение БД (специально не уникальный
// индекс/constraint - проще поднять позже, если понадобится). Раньше
// было жёстко "1" (Беклог Н-2) - вместо него теперь явный "до 3",
// проверяется здесь же, при создании.
const WISHLIST_LIMIT = 3;

export async function wishlistRoutes(app: FastifyInstance) {
  // Телефон для СБП - реквизит человека, не позиции (см. User.sbpPhone) -
  // фронту нужно подставить уже сохранённый номер при повторной отметке
  // "купил сам", чтобы не просить вводить его каждый раз заново.
  app.get("/api/me", async (req, reply) => {
    const query = z.object({ telegramId: z.string().optional() }).parse(req.query);
    const telegramId = requireTelegramId(req, query.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    // К этому моменту у пользователя уже есть запись User - её создаёт
    // POST /api/wishlists при первом открытии мини-аппа (см. Home.tsx),
    // раньше, чем мог бы отрендериться что-либо, что вызывает /api/me.
    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return { sbpPhone: user?.sbpPhone ?? null, calendarToken: user?.calendarToken ?? null };
  });

  // До 3 вишлистов на человека (CLAUDE.md, 2026-10-02) - в отличие от
  // старого поведения (Беклог Н-2, "один владелец - один вишлист"),
  // каждый вызов теперь создаёт НОВЫЙ список, а не находит существующий.
  // Восстановление при потере localStorage, которое раньше решал этот
  // же эндпоинт, переехало на фронт - см. GET /api/wishlists/mine ниже
  // и MyWishlist.tsx (сначала смотрим, что уже есть, создаём только
  // если вообще ничего нет - тот же Н-2 сценарий, просто в другом месте).
  app.post("/api/wishlists", async (req, reply) => {
    const body = z
      .object({
        telegramId: z.string().optional(),
        title: z.string().min(1).max(60).optional(),
        // Автосоздание первого списка при первом запуске (MyWishlist.tsx) -
        // если список уже есть, вернуть его, а не создавать второй. Кнопка
        // "+" этот флаг не шлёт и создаёт новый список как обычно.
        onlyIfNone: z.boolean().optional(),
      })
      .parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const owner = await upsertUserByTelegramId(telegramId);

    // QA-1: два параллельных первых запуска (двойной эффект React, два
    // открытия мини-аппа подряд) оба видели 0 списков и оба создавали
    // новый. Advisory-lock на владельца сериализует проверку и создание -
    // заодно и лимит WISHLIST_LIMIT больше нельзя обойти гонкой.
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${owner.id}))`;
      const existing = await tx.wishlist.findMany({ where: { ownerId: owner.id }, orderBy: { createdAt: "asc" } });
      if (body.onlyIfNone && existing.length > 0) return { wishlist: existing[0], created: false };
      if (existing.length >= WISHLIST_LIMIT) return null;
      const wishlist = await tx.wishlist.create({
        // QA-2: первый список - "Мой вишлист" (как в схеме и документации),
        // следующие - "Вишлист N".
        data: { ownerId: owner.id, title: body.title ?? (existing.length === 0 ? "Мой вишлист" : `Вишлист ${existing.length + 1}`) },
      });
      return { wishlist, created: true, ordinal: existing.length + 1 };
    });
    if (!result) return reply.code(409).send({ error: "wishlist_limit_reached" });

    const { wishlist, created } = result;
    if (created) {
      track("wishlist_created", {
        userId: owner.id,
        wishlistId: wishlist.id,
        props: { source: "app", ordinal: result.ordinal ?? 1 },
      });
    }
    return reply.code(created ? 201 : 200).send({ id: wishlist.id, slug: wishlist.slug, title: wishlist.title });
  });

  // Список своих вишлистов для переключателя (CLAUDE.md, 2026-10-02) -
  // и восстановления при потере localStorage (тот самый сценарий из
  // Н-2: переустановка, автоочистка WebView - теперь это читает фронт
  // сам, прежде чем решить, создавать новый список или нет).
  app.get("/api/wishlists/mine", async (req, reply) => {
    const query = z.object({ telegramId: z.string().optional() }).parse(req.query);
    const telegramId = requireTelegramId(req, query.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    if (!user) return { wishlists: [] };

    const wishlists = await db.wishlist.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { items: true } } },
    });

    return {
      wishlists: wishlists.map((w) => ({ slug: w.slug, title: w.title, itemCount: w._count.items })),
    };
  });

  app.get("/api/wishlists/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const query = z.object({ telegramId: z.string().optional() }).parse(req.query);

    // Беклог Н-8: без явного orderBy Postgres не гарантирует порядок
    // строк - список позиций мог отображаться в разном порядке между
    // запросами к одной и той же странице.
    const wishlist = await db.wishlist.findUnique({
      where: { slug },
      include: { items: { orderBy: { createdAt: "asc" } }, owner: true },
    });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });

    // Беклог В-10: получатель, открывший свою же ссылку "Поделиться",
    // видел экран приглашения "чужого" человека - фронт не знал, что это
    // его собственный список. Личность не определена (аноним) -> false,
    // не 401 - просмотр по ссылке должен остаться анонимным.
    const telegramId = requireTelegramId(req, query.telegramId);
    const isOwner = Boolean(telegramId && wishlist.owner.telegramId === BigInt(telegramId));

    // Для Н-1/В-6: нужен User.id текущего просматривающего, чтобы
    // сравнить с reservedByUserId каждой позиции (сам id наружу не идёт).
    const viewer = telegramId ? await db.user.findUnique({ where: { telegramId: BigInt(telegramId) } }) : null;

    const items = await Promise.all(
      wishlist.items.map((i) => resolveItem(i.id)),
    );

    // Аналитика: открытие чужого вишлиста - сигнал "поделился и открыли
    // дарители" в воронке. Не чаще раза в сутки на зрителя+вишлист, чтобы
    // рефреши не спамили; совсем анонимные (без initData) - общим ключом
    // на вишлист.
    if (!isOwner) {
      track("wishlist_viewed", {
        userId: viewer?.id ?? null,
        wishlistId: wishlist.id,
        props: { anonymous: !telegramId, registered: Boolean(viewer), itemCount: wishlist.items.length },
        dedupeKey: dailyKey("wishlist_viewed", wishlist.id, viewerKey(viewer?.id, telegramId)),
      });
    }

    return {
      slug: wishlist.slug,
      isOwner,
      title: wishlist.title,
      // Повод (CLAUDE.md, 2026-10-02) - необязательный, задаёт владелец
      // через PATCH ниже. Публично виден всем, у кого есть ссылка -
      // ровно та же анонимная видимость, что и у самого списка позиций.
      occasionTitle: wishlist.occasionTitle,
      occasionDate: wishlist.occasionDate,
      items: items.map((i) =>
        serializeItemView(i, i.giftShares, wishlist.owner.sbpPhone, viewer?.id ?? null, isOwner),
      ),
    };
  });

  // Повод вишлиста (CLAUDE.md, 2026-10-02, "продумай бизнесово как
  // пользователю будет удобно синхронизировать календари") - лёгкая
  // замена старой версии календаря, завязанной на Pool (деньги,
  // итерация 2, отключена от экранов) - живёт на самом вишлисте, не
  // требует денег/сбора. Только владелец, и только оба поля вместе -
  // date без title показывал бы в календаре "Без названия", а title без
  // date вообще некуда положить.
  // title - имя самого списка (переключатель, "сделай 3 и названия для
  // них" - CLAUDE.md, 2026-10-02); occasionTitle/occasionDate - повод с
  // датой для календаря (другая фича, см. комментарий у Item выше). Оба
  // независимы друг от друга и необязательны в каждом вызове - но если
  // трогаем повод, то оба его поля вместе (date без title показывал бы
  // в календаре "Без названия", title без date вообще некуда положить).
  app.patch("/api/wishlists/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const body = z
      .object({
        telegramId: z.string().optional(),
        title: z.string().min(1).max(60).optional(),
        occasionTitle: z.string().min(1).max(80).nullable().optional(),
        occasionDate: z.string().datetime().nullable().optional(),
      })
      .refine((b) => (b.occasionTitle !== undefined) === (b.occasionDate !== undefined), {
        message: "occasion_title_and_date_together",
      })
      .refine((b) => b.occasionTitle === undefined || (b.occasionTitle === null) === (b.occasionDate === null), {
        message: "occasion_title_and_date_together",
      })
      .parse(req.body);

    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const wishlist = await db.wishlist.findUnique({ where: { slug }, include: { owner: true } });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });
    if (wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    const updated = await db.wishlist.update({
      where: { slug },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.occasionTitle !== undefined
          ? {
              occasionTitle: body.occasionTitle,
              occasionDate: body.occasionDate ? toCalendarDay(new Date(body.occasionDate)) : null,
            }
          : {}),
      },
    });

    if (body.title !== undefined && body.title !== wishlist.title) {
      track("wishlist_renamed", { userId: wishlist.ownerId, wishlistId: wishlist.id, props: {} });
    }

    // Аналитика: повод - ключевые данные о событии (что и когда дарят).
    if (body.occasionTitle !== undefined) {
      if (updated.occasionTitle && updated.occasionDate) {
        track("occasion_set", {
          userId: wishlist.ownerId,
          wishlistId: wishlist.id,
          // А-15: не текст повода (там имена людей), а только категория.
          props: { category: occasionCategory(updated.occasionTitle), monthDay: monthDay(updated.occasionDate) },
        });
      } else if (wishlist.occasionTitle) {
        track("occasion_cleared", { userId: wishlist.ownerId, wishlistId: wishlist.id, props: {} });
      }
    }

    return {
      title: updated.title,
      occasionTitle: updated.occasionTitle,
      occasionDate: updated.occasionDate,
    };
  });

  // Разовое "Добавить в календарь" (CLAUDE.md, 2026-10-02) - главный,
  // низкотрудозатратный сценарий для дарителя: один тап/скачивание,
  // работает в Apple Calendar/Google Calendar/Яндекс.Календаре без
  // авторизации и подписки. Публичный, как и сам вишлист - доступен
  // всем, у кого есть ссылка.
  app.get("/api/wishlists/:slug/occasion.ics", async (req, reply) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const wishlist = await db.wishlist.findUnique({ where: { slug } });
    if (!wishlist) return reply.code(404).send({ error: "wishlist_not_found" });
    if (!wishlist.occasionTitle || !wishlist.occasionDate) {
      return reply.code(404).send({ error: "occasion_not_set" });
    }

    const ics = buildIcsCalendar([
      {
        uid: `occasion-${wishlist.id}`,
        title: wishlist.occasionTitle,
        date: wishlist.occasionDate,
        url: `https://t.me/${env.BOT_USERNAME}?startapp=w_${wishlist.slug}`,
      },
    ]);

    reply.header("Content-Type", "text/calendar; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${wishlist.slug}.ics"`);
    // Публичный эндпоинт без идентичности - userId неизвестен.
    track("occasion_ics_downloaded", { wishlistId: wishlist.id, props: {} });
    return ics;
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
        // Аудит 2026-10-08, А-10: текст из "Поделиться" маркетплейса
        // ("Смотри на Ozon https://...") - вырезаем первую ссылку.
        url: z.preprocess(preprocessUrlInput, z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme")),
        title: z.string().optional(),
        price: z.number().int().positive().optional(), // копейки
        // "Уже купил(а) сам(а)" (решение 2026-10-02, по просьбе
        // пользователя) - даритель переводит деньги напрямую получателю по
        // СБП вместо похода в магазин, см. User.sbpPhone.
        selfPurchased: z.boolean().optional(),
        sbpPhone: z.string().regex(PHONE_RE, "invalid_phone").optional(),
        // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - получатель
        // задаёт, сколько дарителей могут разделить этот перевод. Имеет
        // смысл только вместе с selfPurchased - проверяется ниже.
        maxContributors: z.number().int().min(1).max(MAX_CONTRIBUTORS_CAP).optional(),
        // Сбор по ссылке банка (ТЗ блок 4) - для ещё не купленного
        // дорогого подарка. Та же защита схемы, что и у ссылки на товар (Б-8).
        fundraiserUrl: z.preprocess(preprocessUrlInput, z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme")).optional(),
      })
      .parse(req.body);

    // Складчина - только если есть куда переводить: номер СБП ("уже купил
    // сам") или ссылка на сбор в банке.
    if (body.maxContributors && body.maxContributors > 1 && !body.selfPurchased && !body.fundraiserUrl) {
      return reply.code(400).send({ error: "validation_error" });
    }

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

    // Автоподгрузка фото/названия по ссылке (решение 2026-10-02) -
    // services/itemCreate.ts, переиспользуется ботом (пересылка ссылки в
    // чат, см. bot/bot.ts).
    const item = await createItemFromUrl(
      wishlist.id,
      body.url,
      body.title,
      body.price,
      body.selfPurchased,
      body.maxContributors,
      // QA блока 4, QB4-3: ссылка на сбор живёт только вместе со
      // складчиной - у обычной позиции её некому использовать (экран
      // подарка показывает бронь и магазин), а список рисовал "Сбор по
      // ссылке банка". Молча отбрасываем, как и при выключении складчины.
      {
        source: "app",
        ownerUserId: wishlist.ownerId,
        // Ссылка на сбор и "уже купил сам" взаимоисключающие: деньги идут
        // либо на номер СБП, либо в сбор (ТЗ редактирования всех полей).
        fundraiserUrl: (body.maxContributors ?? 1) > 1 && !body.selfPurchased ? body.fundraiserUrl : undefined,
      },
    );
    // Новая позиция никогда не забронирована в момент создания.
    return reply.code(201).send(serializeItemView({ ...item, reservedBy: null }, [], sbpPhone ?? null, null, true));
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

    const contributors = await db.giftShare.count({ where: { itemId } });
    await db.item.delete({ where: { id: itemId } });
    track("item_deleted", {
      userId: item.wishlist.ownerId,
      wishlistId: item.wishlistId,
      itemId,
      props: { status: item.status, mode: item.maxContributors > 1 ? "split" : "classic", contributors },
    });
    return reply.code(204).send();
  });
}
