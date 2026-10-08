import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "./env.js";
import { bot, setupBotCommands } from "./bot/bot.js";
import { wishlistRoutes } from "./routes/wishlists.js";
import { itemRoutes } from "./routes/items.js";
import { calendarRoutes } from "./routes/calendar.js";
import { eventRoutes } from "./routes/events.js";
import { track } from "./services/analytics.js";
import { startReminderScheduler } from "./services/reminders.js";

// Аудит 2026-10-08, А-35: в лог запроса - только путь, без query-строки.
// Раньше мини-апп слал ?telegramId=... в каждом GET, и в логах (на Railway -
// у третьей стороны) копилась связка "telegramId <-> вишлист", хотя
// аналитика нарочно без telegramId. Фронт больше не шлёт telegramId внутри
// Telegram, а сериализатор режет query на случай старых клиентов.
const app = Fastify({
  logger: {
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: (req.url ?? "").split("?")[0],
          hostname: req.hostname,
          remoteAddress: req.ip,
        };
      },
    },
  },
});

// Беклог Б-3 (Продукт/беклог-баги-итерация-1.md): без этого обработчика
// любая ошибка валидации Zod или Prisma долетала до клиента как 500 с
// полным телом исключения (внутренние коды, текст схемы).
app.setErrorHandler((error, req, reply) => {
  if (error instanceof ZodError) {
    // Аудит 2026-10-08, А-17/А-18: у части проверок сообщение - машинный
    // код (`price_too_large`, `invalid_phone`) - отдаём его как error, чтобы
    // фронт показал конкретный текст, а не общее "Проверьте данные".
    // Стандартные сообщения Zod ("Required", "Invalid url") - не коды.
    const coded = error.issues.find((i) => /^[a-z][a-z0-9_]{2,49}$/.test(i.message));
    return reply.code(400).send({ error: coded?.message ?? "validation_error", issues: error.issues });
  }
  // Аудит 2026-10-08, А-23: ошибки самого Fastify с клиентским статусом
  // (битый JSON - FST_ERR_CTP_INVALID_JSON, 400; не тот Content-Type - 415;
  // слишком большое тело - 413) раньше превращались в 500 и засоряли
  // api_error. Отдаём их статус как есть.
  const status = (error as { statusCode?: number }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return reply.code(status).send({ error: status === 400 ? "bad_request" : `http_${status}` });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return reply.code(404).send({ error: "not_found" });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "internal_error" });
});

// ТЗ блок 4 (логи): каждая 5xx - событие api_error с шаблоном маршрута
// (не конкретным URL с id), чтобы ошибки считались в статистике.
app.addHook("onResponse", async (req, reply) => {
  if (reply.statusCode >= 500) {
    track("api_error", {
      props: { method: req.method, route: req.routeOptions?.url ?? "unknown", status: reply.statusCode },
    });
  }
});

// Беклог Б-14 (Продукт/беклог-баги-итерация-1.md): origin: true отражал
// любой Origin - сторонний сайт мог дёргать API из браузера жертвы. Сужаем
// до реального домена мини-аппа (прод - MINI_APP_URL, разработка -
// localhost:5173 Vite dev-сервера).
await app.register(cors, { origin: [env.MINI_APP_URL, "http://localhost:5173"] });
await app.register(wishlistRoutes);
await app.register(itemRoutes);
// Аудит 2026-10-08, А-2 (P0): роуты сборов итерации 2 (routes/pools.ts)
// не регистрируются, пока итерация 2 выключена - в них нет проверки
// подписи initData (telegramId берётся из тела, /extend не проверяет
// ничего), любой мог создавать "пользователей", сборы и взносы от чужого
// имени. Код роутов не удалён - задел под итерацию 2. Перед включением:
// перевести на resolveTelegramId + проверку организатора, затем вернуть
// `await app.register(poolRoutes)` (import из "./routes/pools.js").
await app.register(calendarRoutes);
await app.register(eventRoutes);

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Long polling для разработки. В проде переключить на webhook
// (bot.api.setWebhook) - оставлено на этап деплоя, не блокирует разработку.
// Ошибка бота (например, невалидный BOT_TOKEN) не должна класть HTTP API -
// мини-апп обращается напрямую к этим роутам, бот - отдельный канал.
bot.start().catch((err) => {
  app.log.error(err, "Бот не запустился - HTTP API продолжает работать");
});
// Аудит 2026-10-08, А-31: меню команд (/start, /help).
void setupBotCommands();

// Аудит 2026-10-08, А-14: напоминания дарителям о брони - планировщик в
// этом же процессе (на Railway один инстанс), см. services/reminders.ts.
startReminderScheduler();
