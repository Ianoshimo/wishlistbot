import { Bot, InlineKeyboard } from "grammy";
import { extractUrl } from "../services/linkInput.js";
import { env } from "../env.js";
import { db } from "../db.js";
import { getOrCreateWishlist } from "../services/wishlistService.js";
import { checkItemAddAllowed, createItemFromUrl } from "../services/itemCreate.js";
import { track } from "../services/analytics.js";
import { thanksCaption } from "../services/giverMessages.js";

export const bot = new Bot(env.BOT_TOKEN);

// Без bot.catch grammY при long polling на любой ошибке внутри обработчика
// (например, протухший callback query после долгой подгрузки превью
// Wildberries) останавливает приём апдейтов целиком - бот молчит до
// рестарта сервиса. Ошибка одного апдейта не должна ронять остальных.
bot.catch((err) => {
  console.error("[bot] Ошибка в обработчике апдейта", err.ctx?.update?.update_id, err.error);
});

// Ссылки на конкретный вишлист/сбор (t.me/<bot>?startapp=w_<slug> или
// ?startapp=p_<poolId>) открывают мини-апп напрямую - Telegram сам кладёт
// пейлоад в Telegram.WebApp.initDataUnsafe.start_param на стороне
// фронтенда, бот в этом случае вообще не получает сообщение. Обработчик
// ниже - только для случая, когда пользователь открыл бота без ссылки на
// конкретный вишлист (флоу "Первый запуск", см. Продукт/флоу-итерация-1.md).
bot.command("start", async (ctx) => {
  if (!ctx.from) return;

  const existed = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { id: true } });
  const user = await db.user.upsert({
    where: { telegramId: BigInt(ctx.from.id) },
    update: { firstName: ctx.from.first_name, username: ctx.from.username },
    create: {
      telegramId: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    },
  });
  track("bot_started", { userId: user.id, props: { isNewUser: !existed } });

  const keyboard = new InlineKeyboard().webApp(
    "Открыть вишлист-бот",
    env.MINI_APP_URL,
  );

  // Беклог Б-11: раньше текст обещал групповой сбор ("скидывайтесь
  // компанией на дорогой подарок") - он отключён от экранов итерации 1
  // (см. README.md), первое сообщение бота не должно обещать то, чего
  // негде найти.
  await ctx.reply(
    "Вишлист-бот - дарите не гадая.\n\nСобирайте вишлист, бронируйте подарки без задвоений.",
    { reply_markup: keyboard },
  );
});

// Аудит 2026-10-08, А-31: подсказка на /help, неизвестную команду и любой
// текст без ссылки - раньше бот молчал, и казалось, что он сломан.
export const HELP_TEXT =
  "Я помогаю вести вишлист и бронировать подарки без задвоений.\n\n" +
  "• Пришлите ссылку на товар (можно вместе с текстом из «Поделиться» магазина) - предложу добавить её в вишлист.\n" +
  "• Откройте вишлист кнопкой ниже - там можно поделиться списком с друзьями и посмотреть брони.";

function openAppKeyboard() {
  return new InlineKeyboard().webApp("Открыть вишлист", env.MINI_APP_URL);
}

// Меню команд бота (кнопка "Меню" в Telegram). Вызывается при старте
// сервера; сбой (например, токен-заглушка в разработке) не критичен.
export async function setupBotCommands(): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Открыть вишлист" },
      { command: "help", description: "Что умеет бот" },
    ]);
  } catch (err) {
    console.warn("[bot] Не удалось задать меню команд", err instanceof Error ? err.message : err);
  }
}

bot.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { reply_markup: openAppKeyboard() });
});

// Переслать товарную ссылку боту в чат → бот сам предлагает добавить
// (CLAUDE.md, 2026-10-01) - без этого приходится открывать мини-апп и
// вставлять ссылку руками.
//
// Аудит 2026-10-08, А-19: раньше ожидающая ссылка была одна на чат, а
// кнопка - "addlink:yes" без идентификатора: переслал A, потом B, нажал
// "Добавить" под A - добавлялась B. Теперь у каждой ссылки свой короткий
// id в callback_data ("addlink:yes:<id>"), кнопка добавляет ровно свою
// ссылку при любом порядке нажатий. Хранится в памяти процесса (не
// переживает рестарт - тогда кнопка честно просит прислать ссылку ещё раз),
// не больше PENDING_LINKS_MAX записей - самые старые вытесняются.
const PENDING_LINKS_MAX = 1000;
const pendingLinks = new Map<string, { chatId: number; url: string }>();
let pendingSeq = 0;

function rememberLink(chatId: number, url: string): string {
  pendingSeq = (pendingSeq + 1) % 1_000_000_000;
  const id = `${Date.now().toString(36)}${pendingSeq.toString(36)}`;
  pendingLinks.set(id, { chatId, url });
  while (pendingLinks.size > PENDING_LINKS_MAX) {
    const oldest = pendingLinks.keys().next().value;
    if (oldest === undefined) break;
    pendingLinks.delete(oldest);
  }
  return id;
}

bot.on("message:text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const text = ctx.message.text;
  // /start и /help обработаны выше; неизвестная команда - подсказка (А-31).
  if (text.startsWith("/")) {
    await ctx.reply(HELP_TEXT, { reply_markup: openAppKeyboard() });
    return;
  }

  // Аудит 2026-10-08, А-10: общий разбор с мини-аппом и API - хвостовая
  // пунктуация ("...https://ozon.ru/t/Ab.") больше не попадает в ссылку.
  const extracted = extractUrl(text);

  // Беклог Б-8: та же защита от произвольной схемы, что и в
  // routes/wishlists.ts - ссылка пойдёт прямо в href "Перейти в магазин".
  let url: URL | null = null;
  if (extracted) {
    try {
      url = new URL(extracted);
    } catch {
      url = null;
    }
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    // А-31: текст без ссылки - подсказка с кнопкой мини-аппа.
    await ctx.reply(
      "Чтобы добавить подарок, пришлите ссылку на товар - или откройте вишлист кнопкой ниже.\n\nЧто ещё умею - /help",
      { reply_markup: openAppKeyboard() },
    );
    return;
  }

  const id = rememberLink(ctx.chat.id, url.toString());
  await ctx.reply(`Добавить эту ссылку в вишлист?\n${url.toString()}`, {
    link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard()
      .text("Добавить", `addlink:yes:${id}`)
      .text("Не надо", `addlink:no:${id}`),
  });
});

bot.callbackQuery(/^addlink:(yes|no)(?::(.+))?$/, async (ctx) => {
  const [, answer, id] = ctx.match as RegExpMatchArray;
  const pending = id ? pendingLinks.get(id) : undefined;
  // Чужой чат (сообщение переслали) - не трогаем чужую ссылку.
  const own = pending && pending.chatId === ctx.chat?.id ? pending : undefined;

  if (answer === "no") {
    if (own && id) pendingLinks.delete(id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Хорошо, не добавляю.");
    return;
  }
  if (!own || !id) {
    // Старая кнопка (до рестарта сервера или формата без id) - не
    // угадываем, какую ссылку имели в виду.
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Эта кнопка устарела - пришлите ссылку ещё раз.");
    return;
  }
  pendingLinks.delete(id);

  if (!ctx.from) return;
  // Отвечаем на нажатие сразу: подгрузка превью (Wildberries через Apify)
  // идёт до ~30 с, а callback query Telegram протухает раньше - поздний
  // answerCallbackQuery падал с ошибкой.
  await ctx.answerCallbackQuery({ text: "Добавляю…" });
  await ctx.editMessageText("Добавляю - подтягиваю фото и название…");

  try {
    const wishlist = await getOrCreateWishlist(String(ctx.from.id));
    // А-33: те же лимиты, что у мини-аппа.
    const limit = await checkItemAddAllowed(wishlist.id, wishlist.ownerId);
    if (limit) {
      await ctx.editMessageText(
        limit === "item_limit_reached"
          ? "В вишлисте уже слишком много подарков - удалите ненужные в мини-аппе и пришлите ссылку снова."
          : "Слишком много ссылок подряд - подождите минуту и пришлите ещё раз.",
      );
      return;
    }
    const item = await createItemFromUrl(wishlist.id, own.url, { source: "bot", ownerUserId: wishlist.ownerId });
    await ctx.editMessageText(`Добавлено в вишлист: ${item.title}`);
  } catch (err) {
    console.error("[bot] Не удалось добавить ссылку", err);
    await ctx.editMessageText("Не получилось добавить ссылку - попробуйте ещё раз или добавьте её в мини-аппе.");
  }
});

// "Поблагодарить дарителя" фото/видео (2026-10-02, по просьбе
// пользователя) - для selfPurchased-позиций (получатель купил сам,
// даритель перевёл деньги по СБП - см. routes/items.ts, кнопка
// появляется при отметке "куплено"). Личность дарителя по-прежнему не
// раскрывается получателю (п.2 спеки) - получатель жмёт кнопку под
// позицией, даже не видя, кому именно уйдёт сообщение, бот сам находит
// дарителя этой конкретной брони и пересылает ему медиа напрямую.
// Один "ожидающий" item на чат - как и у pendingLinks выше, не переживает
// рестарт процесса, это ожидаемо (можно нажать кнопку ещё раз).
const pendingThanks = new Map<number, string>();

bot.callbackQuery(/^thank:/, async (ctx) => {
  const itemId = ctx.callbackQuery.data.slice("thank:".length);
  if (!ctx.from || !ctx.chat) return;

  // Защита от чужой кнопки (например, если сообщение кому-то переслали) -
  // благодарить может только реальный владелец этой позиции, та же
  // граница, что и у остальных владельческих действий (Б-14/Б-2).
  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { wishlist: { include: { owner: true } } },
  });
  if (!item || item.wishlist.owner.telegramId !== BigInt(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "Эта позиция недоступна" });
    return;
  }

  pendingThanks.set(ctx.chat.id, itemId);
  await ctx.answerCallbackQuery();
  // А-32: раньше обещали "не называя вас" - анонимность защищает дарителя,
  // а не получателя: даритель и так знает, чей это список.
  await ctx.reply(
    `Пришлите фото или короткое видео (в том числе кружочек) - перешлю ${
      item.maxContributors > 1 ? "всем, кто скинулся на" : "дарителю, который подарил"
    } ${item.title?.trim() ? `«${item.title.trim()}»` : "этот подарок"}, с подписью, что это благодарность от вас.`,
  );
});

bot.on(["message:photo", "message:video", "message:video_note"], async (ctx) => {
  const itemId = pendingThanks.get(ctx.chat.id);
  if (!itemId) return; // не в режиме "поблагодарить" - медиа само по себе ничего не триггерит
  pendingThanks.delete(ctx.chat.id);

  const item = await db.item.findUnique({
    where: { id: itemId },
    include: { wishlist: { include: { owner: true } }, giftShares: true },
  });
  if (!ctx.from || !item || item.wishlist.owner.telegramId !== BigInt(ctx.from.id)) {
    await ctx.reply("Не получилось отправить - позиция недоступна.");
    return;
  }

  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - если дарителей
  // несколько, благодарность уходит каждому из них, а не только первому.
  const giverUserIds =
    item.maxContributors > 1
      ? item.giftShares.map((s) => s.userId)
      : item.reservedByUserId
        ? [item.reservedByUserId]
        : [];

  if (giverUserIds.length === 0) {
    await ctx.reply("Не получилось отправить - даритель не найден.");
    return;
  }

  const givers = await db.user.findMany({ where: { id: { in: giverUserIds } } });
  // А-32: от кого и за что - у дарителя может быть несколько друзей.
  // Имя - из самого сообщения (отправитель и есть владелец, проверено
  // выше): в User.firstName может быть пусто, если владелец не запускал /start.
  const caption = thanksCaption({ ownerName: ctx.from.first_name || item.wishlist.owner.firstName, itemTitle: item.title });
  let sent = 0;
  for (const giver of givers) {
    const chatId = giver.telegramId.toString();
    try {
      if (ctx.message.photo) {
        const biggest = ctx.message.photo[ctx.message.photo.length - 1];
        await bot.api.sendPhoto(chatId, biggest.file_id, { caption });
      } else if (ctx.message.video) {
        await bot.api.sendVideo(chatId, ctx.message.video.file_id, { caption });
      } else if (ctx.message.video_note) {
        // sendVideoNote (кружочек) не поддерживает caption в самом API -
        // подпись уходит отдельным сообщением ДО кружочка (А-32), чтобы
        // даритель сразу видел, от кого он.
        await bot.api.sendMessage(chatId, caption);
        await bot.api.sendVideoNote(chatId, ctx.message.video_note.file_id);
      }
      sent++;
    } catch (err) {
      console.error("[thank]", "Не удалось переслать благодарность дарителю", err);
    }
  }

  // Аналитика: только тип медиа и счётчики - без file_id и без дарителей.
  track("thanks_sent", {
    userId: item.wishlist.ownerId,
    wishlistId: item.wishlistId,
    itemId: item.id,
    props: {
      mediaType: ctx.message.photo ? "photo" : ctx.message.video ? "video" : "video_note",
      recipients: givers.length,
      delivered: sent,
    },
  });

  await ctx.reply(
    givers.length > 1 ? `Спасибо отправлено ${sent} из ${givers.length}! 🎉` : sent > 0 ? "Спасибо отправлено! 🎉" : "Не получилось отправить - попробуйте ещё раз позже.",
  );
});
