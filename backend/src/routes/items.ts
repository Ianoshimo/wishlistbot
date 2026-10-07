import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { InlineKeyboard } from "grammy";
import { db } from "../db.js";
import { reservationDeadline, resolveExpiredReservation } from "../services/reservation.js";
import { resolveItem, serializeItemView } from "../services/itemView.js";
import { resolveTelegramId, resolveTelegramUser, telegramIdSchema } from "../auth/telegramAuth.js";
import { upsertUserByTelegramId } from "../services/userUpsert.js";
import { bot } from "../bot/bot.js";
import { monthDay, track, type ReserveMode } from "../services/analytics.js";
import { detectStore } from "../services/linkPreview.js";
import { MAX_CONTRIBUTORS_CAP, PHONE_RE } from "./wishlists.js";
import { planItemEdit } from "../services/itemEdit.js";
import { fetchPreviewWithFallback } from "../services/itemCreate.js";

// Аналитика: "позиция стала bought" - с датой повода вишлиста (месяц-день),
// чтобы покупку можно было привязать к событию. Повод дочитывается
// отдельно и не ждётся - сбой не влияет на ответ.
function trackItemBought(
  item: { id: string; wishlistId: string; url: string; price: number | null; selfPurchased: boolean },
  mode: ReserveMode,
  contributors: number,
  userId: string,
) {
  const base = { mode, selfPurchased: item.selfPurchased, store: detectStore(item.url), price: item.price, contributors };
  db.wishlist
    .findUnique({ where: { id: item.wishlistId }, select: { occasionDate: true } })
    .then((w) => w?.occasionDate ?? null, () => null)
    .then((date) =>
      track("item_bought", {
        userId,
        wishlistId: item.wishlistId,
        itemId: item.id,
        props: { ...base, occasionMonthDay: date ? monthDay(date) : null },
      }),
    );
}

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
// thanksAvailable - подарок деньгами: "уже купил сам" (СБП) или сбор по
// ссылке банка (ТЗ блок 4) - в обоих случаях есть конкретные дарители,
// которым можно переслать благодарность.
async function notifyOwnerPurchased(app: FastifyInstance, wishlistId: string, itemId: string, thanksAvailable: boolean) {
  try {
    const wishlist = await db.wishlist.findUnique({
      where: { id: wishlistId },
      select: { owner: { select: { telegramId: true } } },
    });
    if (!wishlist) return;
    await bot.api.sendMessage(
      wishlist.owner.telegramId.toString(),
      "🎁 Один из подарков в вашем вишлисте отмечен как купленный",
      thanksAvailable
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

    // QA блока 4, QB4-1: slug вишлиста позиции - "Назад" с экрана подарка
    // ведёт дарителя обратно в этот вишлист (в т.ч. при заходе по прямой
    // ссылке без истории), а не на "/". Slug и так публичный - по нему
    // даритель сюда и пришёл.
    return {
      ...serializeItemView(item, item.giftShares, wishlist.owner.sbpPhone, viewer?.id ?? null, isOwnerViewer),
      wishlistSlug: wishlist.slug,
    };
  });

  app.post("/api/items/:itemId/reserve", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z
      .object({ telegramId: z.string().optional(), revealIdentity: z.boolean().optional() })
      .parse(req.body);
    // "Дарить неанонимно": имя дарителя берём из проверенной подписи
    // initData - иначе у пришедшего по ссылке "Поделиться" (минуя /start)
    // firstName навсегда пустой и получатель видит "Дарит:" без имени.
    const initData = req.headers["x-telegram-init-data"];
    const tgUser = resolveTelegramUser(typeof initData === "string" ? initData : undefined, body.telegramId);
    const telegramId = tgUser?.id ?? null;
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

    const user = await upsertUserByTelegramId(telegramId, {
      firstName: tgUser?.firstName,
      username: tgUser?.username,
    });

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
      track("item_reserved", {
        userId: user.id,
        wishlistId: item.wishlistId,
        itemId,
        props: { mode: "split", revealIdentity: Boolean(body.revealIdentity), selfPurchased: item.selfPurchased, store: detectStore(item.url) },
      });
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

    track("item_reserved", {
      userId: user.id,
      wishlistId: item.wishlistId,
      itemId,
      props: { mode: "classic", revealIdentity: Boolean(body.revealIdentity), selfPurchased: item.selfPurchased, store: detectStore(item.url) },
    });
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
        track("purchase_marked", {
          userId: user.id,
          wishlistId: item.wishlistId,
          itemId,
          props: { mode: "split", selfPurchased: item.selfPurchased },
        });
      }

      const shares = await db.giftShare.findMany({ where: { itemId } });
      const allPaid = shares.length === item.maxContributors && shares.every((s) => s.paid);
      if (allPaid && item.status !== "bought") {
        await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
        trackItemBought(item, "split", shares.length, user.id);
        await notifyOwnerPurchased(app, item.wishlistId, item.id, item.selfPurchased || Boolean(item.fundraiserUrl));
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
    track("purchase_marked", {
      userId: user.id,
      wishlistId: item.wishlistId,
      itemId,
      props: { mode: "classic", selfPurchased: item.selfPurchased },
    });
    trackItemBought(item, "classic", 1, user.id);

    // Продукт 2026-10-01: получатель не может отметить свою же позицию
    // купленной (бронь всегда чужая, см. cannot_reserve_own_item выше) -
    // значит уведомляемый владелец и дёргающий этот роут всегда разные
    // люди, отдельная проверка не нужна.
    // Сбор по ссылке бывает только у складчины (QB4-3) - здесь, в
    // classic-пути, благодарность есть только у "уже купил сам".
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
    track("item_priority_toggled", {
      userId: item.wishlist.ownerId,
      wishlistId: item.wishlistId,
      itemId,
      props: { priority: updated.priority },
    });
    return { priority: updated.priority };
  });

  // Редактирование позиции (CLAUDE.md, 2026-10-01; с 2026-10-07 - все
  // поля, ТЗ `Продукт/тз-редактирование-всех-полей.md`). Только владелец,
  // только явно присланные поля. Правила режима подарка (уже купил сам /
  // складчина / сбор) - в services/itemEdit.ts (planItemEdit), здесь
  // только чтение состояния и применение плана.
  app.patch("/api/items/:itemId", async (req, reply) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.params);
    const body = z
      .object({
        telegramId: z.string().optional(),
        title: z.string().min(1).optional(),
        price: z.number().int().positive().nullable().optional(),
        url: z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme").optional(),
        // ТЗ блок 4, п.3: число участников складчины и ссылка на сбор
        // меняются и после создания. null у ссылки - убрать её.
        maxContributors: z.number().int().min(1).max(MAX_CONTRIBUTORS_CAP).optional(),
        fundraiserUrl: z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme").nullable().optional(),
        // "Уже купил(а) сам(а)" и номер СБП - как при создании.
        selfPurchased: z.boolean().optional(),
        sbpPhone: z.string().regex(PHONE_RE, "invalid_phone").optional(),
        priority: z.boolean().optional(),
        // Подтянуть фото (и название, если его не меняли вручную) заново
        // по ссылке - как при создании.
        refreshPreview: z.boolean().optional(),
      })
      .parse(req.body);
    const telegramId = requireTelegramId(req, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    // Владелец проверяется до любых проверок режима - посторонний не
    // узнаёт даже статус позиции.
    const owned = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      include: { wishlist: { include: { owner: true } } },
    });
    if (owned.wishlist.owner.telegramId !== BigInt(telegramId)) {
      return reply.code(403).send({ error: "not_your_wishlist" });
    }

    // Снимаем просроченные брони/доли до проверок - считаем только живых
    // участников (см. срок доли в services/reservation.ts).
    const current = await resolveItem(itemId);
    const joined = current.maxContributors > 1 ? current.giftShares.length : 0;
    const ownerPhone = owned.wishlist.owner.sbpPhone;
    const plan = planItemEdit(
      {
        status: current.status,
        selfPurchased: current.selfPurchased,
        maxContributors: current.maxContributors,
        fundraiserUrl: current.fundraiserUrl,
        reservedByUserId: current.reservedByUserId,
        joined,
      },
      {
        selfPurchased: body.selfPurchased,
        maxContributors: body.maxContributors,
        fundraiserUrl: body.fundraiserUrl,
        sbpPhone: body.sbpPhone,
      },
      ownerPhone,
    );
    if (!plan.ok) {
      track("item_edit_blocked", {
        userId: owned.wishlist.ownerId,
        wishlistId: owned.wishlistId,
        itemId,
        props: {
          reason: plan.error,
          status: current.status,
          mode: current.maxContributors > 1 ? "split" : "classic",
          contributors: current.maxContributors > 1 ? joined : current.reservedByUserId ? 1 : 0,
        },
      });
      return reply.code(plan.code).send(plan.joined !== undefined ? { error: plan.error, joined: plan.joined } : { error: plan.error });
    }

    // Номер СБП - реквизит владельца, а не позиции (как при создании):
    // действует для всех его позиций "уже купил сам".
    if (plan.phoneToSave) {
      await db.user.update({ where: { id: owned.wishlist.ownerId }, data: { sbpPhone: plan.phoneToSave } });
    }

    // Фото по новой ссылке - та же подгрузка, что при создании. Не
    // нашлось - старое фото убираем: оно от другого товара.
    let imageUrl: string | null | undefined;
    let previewTitle: string | undefined;
    if (body.refreshPreview) {
      const target = body.url ?? current.url;
      const preview = await fetchPreviewWithFallback(target);
      imageUrl = preview.imageUrl ?? null;
      if (body.title === undefined && preview.title) previewTitle = preview.title;
    }

    await db.item.update({
      where: { id: itemId },
      data: {
        title: body.title ?? previewTitle,
        price: body.price,
        url: body.url,
        priority: body.priority,
        imageUrl,
        selfPurchased: plan.selfChanged ? plan.selfPurchased : undefined,
        maxContributors: plan.maxChanged ? plan.maxContributors : undefined,
        fundraiserUrl: plan.fundraiserChanged ? plan.fundraiserUrl : undefined,
      },
    });

    const changed: string[] = (["title", "price", "url", "priority"] as const).filter(
      (k) => body[k] !== undefined && body[k] !== current[k],
    );
    if (plan.selfChanged) changed.push("selfPurchased");
    if (plan.maxChanged) changed.push("maxContributors");
    if (plan.fundraiserChanged) changed.push("fundraiserUrl");
    if (plan.phoneToSave) changed.push("sbpPhone");
    if (body.refreshPreview) changed.push("imageUrl");
    track("item_edited", {
      userId: owned.wishlist.ownerId,
      wishlistId: owned.wishlistId,
      itemId,
      props: {
        fields: changed,
        status: current.status,
        mode: plan.maxContributors > 1 ? "split" : "classic",
        selfPurchased: plan.selfPurchased,
        contributors: current.maxContributors > 1 ? joined : current.reservedByUserId ? 1 : 0,
        previewRefreshed: Boolean(body.refreshPreview),
      },
    });
    if (plan.maxChanged || plan.fundraiserChanged) {
      track("split_settings_changed", {
        userId: owned.wishlist.ownerId,
        wishlistId: owned.wishlistId,
        itemId,
        props: { from: current.maxContributors, to: plan.maxContributors, fundraiser: Boolean(plan.fundraiserUrl) },
      });
    }

    // ТЗ блок 4, п.3.5: уменьшили число мест до числа уже оплативших -
    // складчина собрана, позиция становится купленной.
    const nextMax = plan.maxContributors;
    if (nextMax > 1 && current.status !== "bought" && joined === nextMax && current.giftShares.every((s) => s.paid)) {
      await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
      trackItemBought(current, "split", joined, owned.wishlist.ownerId);
      await notifyOwnerPurchased(app, owned.wishlistId, itemId, plan.selfPurchased || Boolean(plan.fundraiserUrl));
    }

    const updated = await resolveItem(itemId);
    // Правит только владелец - viewerUserId null, поэтому номер СБП в
    // ответ не попадает (hotfix Н-1: номер видит только держатель брони),
    // а isOwnerViewer=true позволяет сразу увидеть раскрывшихся дарителей,
    // как и на GET.
    return serializeItemView(updated, updated.giftShares, ownerPhone, null, true);
  });

  // Удаление позиции (Беклог Б-2/Н-4) зарегистрировано в
  // routes/wishlists.ts (DELETE /api/items/:itemId) - исторически рядом
  // с остальными владельческими действиями над вишлистом, не здесь.
}
