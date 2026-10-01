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

// Беклог В-9: BigInt("") === 0n в JS, не ошибка - пустой telegramId
// схлопывал разных клиентов в одного пользователя с telegramId=0,
// нечисловая строка валила необработанное исключение -> 500.
export const telegramIdSchema = /^\d+$/;

// Временное логирование (2026-10-02) - реальный Telegram на проде
// отвечает 401 на валидный на вид initData, причина непонятна вслепую.
// Снять после диагностики, см. Продукт/беклог-баги-итерация-1.md.
function debugLog(reason: string, extra?: Record<string, unknown>) {
  console.error("[telegramAuth]", reason, extra ?? "");
}

export function verifyInitData(initData: string): TelegramAuthUser | null {
  if (!initData) {
    debugLog("initData пустой/отсутствует");
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    debugLog("нет поля hash", { initDataLength: initData.length, initDataSample: initData.slice(0, 200) });
    return null;
  }
  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > MAX_AUTH_AGE_SECONDS) {
    debugLog("auth_date невалиден или устарел", { authDate, ageSeconds });
    return null;
  }

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(env.BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computedHash !== hash) {
    debugLog("хэш не совпал", {
      computedHash,
      expectedHash: hash,
      dataCheckString,
      initDataLength: initData.length,
    });
    return null;
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    debugLog("нет поля user");
    return null;
  }
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
  if (env.ALLOW_DEV_TELEGRAM_ID && bodyTelegramId && telegramIdSchema.test(bodyTelegramId)) {
    return bodyTelegramId;
  }
  return null;
}
