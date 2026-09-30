import { Bot, InlineKeyboard } from "grammy";
import { env } from "../env.js";
import { db } from "../db.js";

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

  await ctx.reply(
    "Вишлист-бот - дарите не гадая.\n\nСобирайте вишлист, бронируйте подарки без задвоений, скидывайтесь компанией на дорогой подарок.",
    { reply_markup: keyboard },
  );
});
