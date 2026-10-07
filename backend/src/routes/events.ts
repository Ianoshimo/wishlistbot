import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { resolveTelegramId } from "../auth/telegramAuth.js";
import { allowClientEvent, sanitizeClientEvent, trackClient } from "../services/analytics.js";

// ТЗ блок 4 (логи): приём клиентских событий мини-аппа. Только
// авторизованный пользователь (initData; в деве - ALLOW_DEV_TELEGRAM_ID),
// белый список типов и полей (services/analytics.ts CLIENT_EVENTS), лимит
// частоты. Ответ всегда 204, даже если событие отброшено, - клиенту не
// нужно знать, записалось ли оно.
export async function eventRoutes(app: FastifyInstance) {
  app.post("/api/events", async (req, reply) => {
    const body = z
      .object({
        telegramId: z.string().optional(),
        events: z.array(z.object({ name: z.unknown(), props: z.unknown().optional() })).max(20),
      })
      .parse(req.body);
    const initData = req.headers["x-telegram-init-data"];
    const telegramId = resolveTelegramId(typeof initData === "string" ? initData : undefined, body.telegramId);
    if (!telegramId) return reply.code(401).send({ error: "unauthorized" });

    const user = await db.user.findUnique({ where: { telegramId: BigInt(telegramId) }, select: { id: true } });
    const key = user?.id ?? "tg:" + telegramId;
    for (const e of body.events) {
      const clean = sanitizeClientEvent(e.name, e.props);
      if (!clean || !allowClientEvent(key)) continue;
      trackClient(clean.type, user?.id ?? null, clean.props);
    }
    return reply.code(204).send();
  });
}
