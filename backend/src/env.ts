import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  MINI_APP_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
  // Платный фоллбэк на случай, когда свой og-парсинг заблокирован антиботом
  // (см. Продукт/беклог-баги-итерация-1.md, задача "найти бесплатное
  // решение") - сейчас используется только для wildberries.ru-ссылок.
  // Без токена фоллбэк просто не срабатывает, не блокирует остальной API.
  APIFY_TOKEN: z.string().optional(),
  // Беклог 2026-10-02 "привязать логин через Telegram": вне настоящего
  // Telegram нет initData для проверки подписи - этот флаг разрешает
  // локальной разработке по-прежнему доверять telegramId из тела запроса.
  // В проде должен быть выключен (не задан) - см. auth/telegramAuth.ts.
  ALLOW_DEV_TELEGRAM_ID: z.coerce.boolean().default(false),
});

export const env = schema.parse(process.env);
