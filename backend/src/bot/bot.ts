import { Bot, InlineKeyboard } from "grammy";
import { env } from "../env.js";
import { db } from "../db.js";
import { getOrCreateWishlist } from "../services/wishlistService.js";
import { createItemFromUrl } from "../services/itemCreate.js";

export const bot = new Bot(env.BOT_TOKEN);

// Ссылки на конкретный вишлист/сбор (t.me/<bot>?startapp=w_<slug> или
// ?startapp=p_<poolId>) открывают мини-апп напрямую - Telegram сам кладёт
// пейлоад в Telegram.WebApp.initDataUnsafe.start_param на стороне
// фронтенда, бот в этом случае вообще не получает сообщение. Обработчик
// ниже - только для случая, когда пользователь открыл бота без ссылки на
// конкретный вишлист (флоу "Первый запуск", см. Продукт/флоу-итерация-1.md).
bot.command("start", async (ctx) => {
  if (!ctx.from) return;

  await db.user.upsert({
    where: { telegramId: BigInt(ctx.from.id) },
    update: { firstName: ctx.from.first_name, username: ctx.from.username },
    create: {
      telegramId: BigInt(ctx.from.id),
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    },
  });

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

// Переслать товарную ссылку боту в чат → бот сам предлагает добавить
// (CLAUDE.md, 2026-10-01) - без этого приходится открывать мини-апп и
// вставлять ссылку руками. Одна позиция "в ожидании" на чат - свежая
// ссылка просто перезаписывает предыдущую, этого достаточно для обычной
// переписки один на один с ботом (не переживает рестарт процесса, это
// ожидаемо - переслать можно ещё раз).
const pendingLinks = new Map<number, string>();
const URL_RE = /https?:\/\/[^\s]+/i;

bot.on("message:text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const text = ctx.message.text;
  if (text.startsWith("/")) return; // команды (/start и т.п.) - не ссылки

  const match = text.match(URL_RE);
  if (!match) return;

  // Беклог Б-8: та же защита от произвольной схемы, что и в
  // routes/wishlists.ts - ссылка пойдёт прямо в href "Перейти в магазин".
  let url: URL;
  try {
    url = new URL(match[0]);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  pendingLinks.set(ctx.chat.id, url.toString());
  await ctx.reply("Добавить эту ссылку в вишлист?", {
    reply_markup: new InlineKeyboard()
      .text("Добавить", "addlink:yes")
      .text("Не надо", "addlink:no"),
  });
});

bot.callbackQuery(["addlink:yes", "addlink:no"], async (ctx) => {
  const url = pendingLinks.get(ctx.chat!.id);
  pendingLinks.delete(ctx.chat!.id);

  if (ctx.callbackQuery.data === "addlink:no" || !url) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Хорошо, не добавляю.");
    return;
  }

  if (!ctx.from) return;
  const wishlist = await getOrCreateWishlist(String(ctx.from.id));
  const item = await createItemFromUrl(wishlist.id, url);

  await ctx.answerCallbackQuery({ text: "Добавлено в вишлист" });
  await ctx.editMessageText(`Добавлено в вишлист: ${item.title}`);
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
  await ctx.reply(
    "Пришлите фото или короткое видео (в том числе кружочек) - перешлю дарителю, не называя вас.",
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
  const caption = "🎁 Получатель подарка благодарит вас!";
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
        // подпись уходит отдельным сообщением следом.
        await bot.api.sendVideoNote(chatId, ctx.message.video_note.file_id);
        await bot.api.sendMessage(chatId, caption);
      }
      sent++;
    } catch (err) {
      console.error("[thank]", "Не удалось переслать благодарность дарителю", err);
    }
  }

  await ctx.reply(
    givers.length > 1 ? `Спасибо отправлено ${sent} из ${givers.length}! 🎉` : sent > 0 ? "Спасибо отправлено! 🎉" : "Не получилось отправить - попробуйте ещё раз позже.",
  );
});
