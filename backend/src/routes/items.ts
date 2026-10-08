import type { FastifyInstance, FastifyRequest } from "fastify";
import { preprocessUrlInput } from "../services/linkInput.js";
import { z } from "zod";
import { InlineKeyboard } from "grammy";
import { db } from "../db.js";
import { reservationDeadline, resolveExpiredReservation } from "../services/reservation.js";
import { resolveItem, serializeItemView } from "../services/itemView.js";
import { resolveTelegramId, resolveTelegramUser, telegramIdSchema } from "../auth/telegramAuth.js";
import { upsertUserByTelegramId } from "../services/userUpsert.js";
import { monthDay, payoutProp, track, type ReserveMode } from "../services/analytics.js";
import { detectStore } from "../services/linkPreview.js";
import { BANK_RE, MAX_CONTRIBUTORS_CAP, phoneSchema, priceSchema } from "./wishlists.js";
import { planItemEdit } from "../services/itemEdit.js";
import { miniAppUrl, sendToUser } from "../bot/notify.js";
import { giftCompletedText, giverThanksText, shareThanksText } from "../services/giverMessages.js";
import { checkItemAddAllowed, fetchPreviewWithFallback } from "../services/itemCreate.js";
import { purchaseNoticeText } from "../services/purchaseNotice.js";

// Аналитика: "позиция стала bought" - с датой повода вишлиста (месяц-день),
// чтобы покупку можно было привязать к событию. Повод дочитывается
// отдельно и не ждётся - сбой не влияет на ответ.
function trackItemBought(
  item: { id: string; wishlistId: string; url: string; price: number | null; selfPurchased: boolean; payoutMethod: string | null },
  mode: ReserveMode,
  contributors: number,
  userId: string,
) {
  const base = {
    mode,
    selfPurchased: item.selfPurchased,
    payoutMethod: payoutProp(item.payoutMethod),
    store: detectStore(item.url),
    price: item.price,
    contributors,
  };
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
// Кнопка "Поблагодарить" - у подарка деньгами (А-5: способ СБП или сбор):
// там есть конкретные дарители, которым можно переслать благодарность.
async function notifyOwnerPurchased(app: FastifyInstance, wishlistId: string, itemId: string) {
  try {
    // Аудит 2026-10-08, А-12: название подарка и списка в тексте, разный
    // текст для покупки и перевода денег (services/purchaseNotice.ts),
    // кнопка открыть именно этот вишлист. Дарителя по-прежнему не называем.
    const item = await db.item.findUnique({
      where: { id: itemId },
      select: {
        title: true,
        payoutMethod: true,
        maxContributors: true,
        wishlist: { select: { id: true, slug: true, title: true, owner: { select: { telegramId: true } } } },
      },
    });
    if (!item || item.wishlist.id !== wishlistId) return;
    const text = purchaseNoticeText({
      itemTitle: item.title,
      wishlistTitle: item.wishlist.title,
      payoutMethod: item.payoutMethod,
      split: item.maxContributors > 1,
    });
    const keyboard = new InlineKeyboard();
    if (item.payoutMethod) keyboard.text("🎁 Поблагодарить дарителя", `thank:${itemId}`).row();
    keyboard.webApp("Открыть вишлист", miniAppUrl(`/w/${item.wishlist.slug}`));
    await sendToUser(item.wishlist.owner.telegramId, text, keyboard, `purchase_notice item=${itemId}`);
  } catch (err) {
    app.log.warn({ err }, "Не удалось отправить уведомление о покупке");
  }
}

// Аудит 2026-10-08, А-14: дарителю - спасибо за отметку покупки/перевода;
// в складчине - "ваша часть отмечена", а когда собрали все - "подарок
// собран" каждому участнику (последнему отметившему - только это). Другие
// дарители не называются. Сбой отправки не влияет на ответ.
async function giftContext(itemId: string) {
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { wishlist: { include: { owner: true } }, reservedBy: true, giftShares: { include: { user: true } } },
  });
  if (!item) return null;
  return {
    item,
    ctx: { itemTitle: item.title, wishlistTitle: item.wishlist.title, ownerName: item.wishlist.owner.firstName },
    keyboard: new InlineKeyboard().webApp("Открыть подарок", miniAppUrl(`/item/${item.id}`)),
  };
}

async function notifyGiverMarked(itemId: string, giverUserId: string) {
  const g = await giftContext(itemId);
  if (!g?.item.reservedBy || g.item.reservedBy.id !== giverUserId) return;
  const delivered = await sendToUser(
    g.item.reservedBy.telegramId,
    giverThanksText({ ...g.ctx, payoutMethod: g.item.payoutMethod }),
    g.keyboard,
    `giver_thanks item=${itemId}`,
  );
  track("giver_notified", { userId: giverUserId, wishlistId: g.item.wishlistId, itemId, props: { reason: "purchase_marked", delivered } });
}

async function notifyShareMarked(itemId: string, giverUserId: string, completed: boolean) {
  const g = await giftContext(itemId);
  if (!g) return;
  const recipients = completed ? g.item.giftShares : g.item.giftShares.filter((s) => s.userId === giverUserId);
  const paid = g.item.giftShares.filter((s) => s.paid).length;
  for (const share of recipients) {
    const text = completed
      ? giftCompletedText(g.ctx)
      : shareThanksText({ ...g.ctx, paid, total: g.item.maxContributors });
    const delivered = await sendToUser(share.user.telegramId, text, g.keyboard, `giver_${completed ? "completed" : "share_thanks"} item=${itemId}`);
    track("giver_notified", {
      userId: share.userId,
      wishlistId: g.item.wishlistId,
      itemId,
      props: { reason: completed ? "gift_completed" : "purchase_marked", delivered },
    });
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
      ...serializeItemView(item, item.giftShares, viewer?.id ?? null, isOwnerViewer),
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
        props: {
          mode: "split",
          revealIdentity: Boolean(body.revealIdentity),
          selfPurchased: item.selfPurchased,
          payoutMethod: payoutProp(item.payoutMethod),
          store: detectStore(item.url),
        },
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
        // А-14: напоминания по новой брони - с нуля.
        lastReminderAt: null,
      },
    });
    if (result.count === 0) {
      return reply.code(409).send({ error: "item_not_available" });
    }

    track("item_reserved", {
      userId: user.id,
      wishlistId: item.wishlistId,
      itemId,
      props: {
        mode: "classic",
        revealIdentity: Boolean(body.revealIdentity),
        selfPurchased: item.selfPurchased,
        payoutMethod: payoutProp(item.payoutMethod),
        store: detectStore(item.url),
      },
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
          props: { mode: "split", selfPurchased: item.selfPurchased, payoutMethod: payoutProp(item.payoutMethod) },
        });
      }

      const shares = await db.giftShare.findMany({ where: { itemId } });
      const allPaid = shares.length === item.maxContributors && shares.every((s) => s.paid);
      const completedNow = allPaid && item.status !== "bought";
      if (completedNow) {
        await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
        trackItemBought(item, "split", shares.length, user.id);
        await notifyOwnerPurchased(app, item.wishlistId, item.id);
      }
      // А-14: спасибо дольщику (повторная отметка той же доли - без
      // повторного сообщения).
      if (!share.paid || completedNow) await notifyShareMarked(itemId, user.id, completedNow);
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
      props: { mode: "classic", selfPurchased: item.selfPurchased, payoutMethod: payoutProp(item.payoutMethod) },
    });
    trackItemBought(item, "classic", 1, user.id);

    // Продукт 2026-10-01: получатель не может отметить свою же позицию
    // купленной (бронь всегда чужая, см. cannot_reserve_own_item выше) -
    // значит уведомляемый владелец и дёргающий этот роут всегда разные
    // люди, отдельная проверка не нужна.
    await notifyOwnerPurchased(app, item.wishlistId, item.id);
    // А-14: спасибо держателю брони.
    await notifyGiverMarked(item.id, user.id);

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
        price: priceSchema.nullable().optional(),
        url: z.preprocess(preprocessUrlInput, z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme")).optional(),
        // ТЗ блок 4, п.3: число участников складчины меняется и после создания.
        maxContributors: z.number().int().min(1).max(MAX_CONTRIBUTORS_CAP).optional(),
        // Аудит 2026-10-08, А-5: способ получить деньги (null - без денег)
        // и реквизиты этого подарка. Правила - services/itemEdit.ts.
        payoutMethod: z.enum(["sbp", "fundraiser"]).nullable().optional(),
        fundraiserUrl: z.preprocess(preprocessUrlInput, z.string().url().regex(/^https?:\/\//i, "invalid_url_scheme")).optional(),
        sbpPhone: phoneSchema.optional(),
        sbpBank: z.string().regex(BANK_RE, "invalid_bank").optional(),
        // "Уже купил сам" - с А-5 только информация "в магазин не нужно".
        selfPurchased: z.boolean().optional(),
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
    const owner = owned.wishlist.owner;
    const plan = planItemEdit(
      {
        status: current.status,
        selfPurchased: current.selfPurchased,
        maxContributors: current.maxContributors,
        reservedByUserId: current.reservedByUserId,
        joined,
        payoutMethod: current.payoutMethod,
        sbpPhone: current.sbpPhone,
        sbpBank: current.sbpBank,
        fundraiserUrl: current.fundraiserUrl,
      },
      {
        selfPurchased: body.selfPurchased,
        maxContributors: body.maxContributors,
        payoutMethod: body.payoutMethod,
        sbpPhone: body.sbpPhone,
        sbpBank: body.sbpBank,
        fundraiserUrl: body.fundraiserUrl,
      },
      { sbpPhone: owner.sbpPhone, sbpBank: owner.sbpBank, fundraiserUrl: owner.fundraiserUrl },
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

    // Аудит 2026-10-08, А-33: "обновить фото по ссылке" - тот же запрос к
    // магазину/Apify, что и добавление, считается в тот же лимит частоты.
    if (body.refreshPreview) {
      const limit = await checkItemAddAllowed(owned.wishlistId, owned.wishlist.ownerId, false);
      if (limit) return reply.code(429).send({ error: limit });
    }

    // Последние введённые реквизиты - по умолчанию для следующих подарков
    // (другие подарки от этого не меняются - у каждого свои реквизиты).
    if (Object.keys(plan.profileUpdate).length > 0) {
      await db.user.update({ where: { id: owned.wishlist.ownerId }, data: plan.profileUpdate });
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
        ...(plan.methodChanged || plan.detailsChanged
          ? {
              payoutMethod: plan.payoutMethod,
              sbpPhone: plan.sbpPhone,
              sbpBank: plan.sbpBank,
              fundraiserUrl: plan.fundraiserUrl,
            }
          : {}),
      },
    });

    const changed: string[] = (["title", "price", "url", "priority"] as const).filter(
      (k) => body[k] !== undefined && body[k] !== current[k],
    );
    if (plan.selfChanged) changed.push("selfPurchased");
    if (plan.maxChanged) changed.push("maxContributors");
    if (plan.methodChanged) changed.push("payoutMethod");
    // Только имена полей - значения реквизитов в аналитику не пишем.
    if (plan.sbpPhone !== (current.sbpPhone ?? null)) changed.push("sbpPhone");
    if (plan.sbpBank !== (current.sbpBank ?? null)) changed.push("sbpBank");
    if (plan.fundraiserUrl !== (current.fundraiserUrl ?? null)) changed.push("fundraiserUrl");
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
        payoutMethod: payoutProp(plan.payoutMethod),
        contributors: current.maxContributors > 1 ? joined : current.reservedByUserId ? 1 : 0,
        previewRefreshed: Boolean(body.refreshPreview),
      },
    });
    if (plan.maxChanged || (plan.payoutMethod === "fundraiser" && plan.detailsChanged)) {
      track("split_settings_changed", {
        userId: owned.wishlist.ownerId,
        wishlistId: owned.wishlistId,
        itemId,
        props: { from: current.maxContributors, to: plan.maxContributors, fundraiser: plan.payoutMethod === "fundraiser" },
      });
    }

    // ТЗ блок 4, п.3.5: уменьшили число мест до числа уже оплативших -
    // складчина собрана, позиция становится купленной.
    const nextMax = plan.maxContributors;
    if (nextMax > 1 && current.status !== "bought" && joined === nextMax && current.giftShares.every((s) => s.paid)) {
      await db.item.update({ where: { id: itemId }, data: { status: "bought" } });
      trackItemBought(current, "split", joined, owned.wishlist.ownerId);
      await notifyOwnerPurchased(app, owned.wishlistId, itemId);
      await notifyShareMarked(itemId, owned.wishlist.ownerId, true);
    }

    const updated = await resolveItem(itemId);
    // Правит только владелец (isOwnerViewer=true): ему видны реквизиты
    // своего подарка и раскрывшиеся дарители, как и на GET.
    return serializeItemView(updated, updated.giftShares, null, true);
  });

  // Удаление позиции (Беклог Б-2/Н-4) зарегистрировано в
  // routes/wishlists.ts (DELETE /api/items/:itemId) - исторически рядом
  // с остальными владельческими действиями над вишлистом, не здесь.
}
