import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "./env.js";
import { bot } from "./bot/bot.js";
import { wishlistRoutes } from "./routes/wishlists.js";
import { itemRoutes } from "./routes/items.js";
import { poolRoutes } from "./routes/pools.js";
import { calendarRoutes } from "./routes/calendar.js";

const app = Fastify({ logger: true });

// Беклог Б-3 (Продукт/беклог-баги-итерация-1.md): без этого обработчика
// любая ошибка валидации Zod или Prisma долетала до клиента как 500 с
// полным телом исключения (внутренние коды, текст схемы).
app.setErrorHandler((error, req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "validation_error", issues: error.issues });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
    return reply.code(404).send({ error: "not_found" });
  }
  app.log.error(error);
  return reply.code(500).send({ error: "internal_error" });
});

await app.register(cors, { origin: true });
await app.register(wishlistRoutes);
await app.register(itemRoutes);
await app.register(poolRoutes);
await app.register(calendarRoutes);

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: env.PORT, host: "0.0.0.0" });

// Long polling для разработки. В проде переключить на webhook
// (bot.api.setWebhook) - оставлено на этап деплоя, не блокирует разработку.
// Ошибка бота (например, невалидный BOT_TOKEN) не должна класть HTTP API -
// мини-апп обращается напрямую к этим роутам, бот - отдельный канал.
bot.start().catch((err) => {
  app.log.error(err, "Бот не запустился - HTTP API продолжает работать");
});
