import { createHmac } from "node:crypto";
import { env } from "../env.js";

// Раньше бэкенд слепо доверял telegramId, присланному в теле запроса -
// любой клиент мог представиться кем угодно (решение 2026-10-02,
// "привязать логин через Telegram"). Мини-апп получает от Telegram
// строку initData, подписанную HMAC-SHA256 секретом, который знает
// только бот (алгоритм официальный, см.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
// Проверяем подпись здесь и достаём telegramId из неё, а не из тела.

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // защита от повторного использования старого initData

export interface TelegramAuthUser {
  id: string;
  firstName: string;
  username?: string;
}

export function verifyInitData(initData: string): TelegramAuthUser | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computedHash !== hash) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  const user = JSON.parse(userRaw) as { id: number; first_name: string; username?: string };

  return { id: String(user.id), firstName: user.first_name, username: user.username };
}

// Вне настоящего Telegram (обычный браузер, локальная разработка - см.
// README.md "Запуск локально") initData не существует. Разрабатывать
// дальше без реального бота должно оставаться возможным - поэтому в этом
// режиме по-прежнему доверяем telegramId из тела запроса, но только если
// явно включено локальным флагом ALLOW_DEV_TELEGRAM_ID, который не
// должен попасть в прод-конфиг.
export function resolveTelegramId(
  initData: string | undefined,
  bodyTelegramId: string | undefined,
): string | null {
  const verified = initData ? verifyInitData(initData) : null;
  if (verified) return verified.id;
  if (env.ALLOW_DEV_TELEGRAM_ID && bodyTelegramId) return bodyTelegramId;
  return null;
}
