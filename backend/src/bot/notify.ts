import { GrammyError, type InlineKeyboard } from "grammy";
import { bot } from "./bot.js";
import { env } from "../env.js";

// Отправка сообщений пользователям от имени бота (уведомления, не ответы
// на апдейты). Аудит 2026-10-08: сбой отправки (пользователь не запускал
// бота, заблокировал его, нет сети) не должен ронять ни запрос, ни
// планировщик напоминаний - возвращаем false и пишем короткий лог.
//
// А-35: telegramId (chat_id) в логи - только в локальной разработке
// (ALLOW_DEV_TELEGRAM_ID), там же исходящее сообщение логируется целиком
// до отправки - так проверяется текст и адресат на стенде с
// токеном-заглушкой, когда до Telegram запрос не доходит.

export function miniAppUrl(path: string): string {
  return `${env.MINI_APP_URL.replace(/\/+$/, "")}${path}`;
}

export async function sendToUser(
  telegramId: bigint | string,
  text: string,
  keyboard: InlineKeyboard | undefined,
  context: string,
): Promise<boolean> {
  const chatId = telegramId.toString();
  if (env.ALLOW_DEV_TELEGRAM_ID) {
    console.info(`[bot-out] ${context} sendMessage`, JSON.stringify({ chat_id: chatId, text, reply_markup: keyboard }));
  }
  try {
    await bot.api.sendMessage(chatId, text, keyboard ? { reply_markup: keyboard } : undefined);
    return true;
  } catch (err) {
    const reason = err instanceof GrammyError ? `${err.error_code} ${err.description}` : err instanceof Error ? err.message : String(err);
    console.warn(`[bot] ${context}: сообщение не доставлено (${reason})`);
    return false;
  }
}
