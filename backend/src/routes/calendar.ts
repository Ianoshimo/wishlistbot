import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";

// Спека итерации 1, раздел "Календарь и внешние интеграции": один ICS/webcal
// фид на пользователя, единый механизм под Apple Calendar и Яндекс.Календарь.
//
// Открытый вопрос приватности не закрыт (видит ли пользователь чужие поводы
// по умолчанию) - до решения фид отдаёт только события, где пользователь
// сам организатор или даритель, без чужих дней рождения.

function toIcsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export async function calendarRoutes(app: FastifyInstance) {
  app.get("/api/calendar/:telegramId.ics", async (req, reply) => {
    const { telegramId } = z
      .object({ telegramId: z.string() })
      .parse(req.params);

    const user = await db.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });
    if (!user) return reply.code(404).send({ error: "user_not_found" });

    const organizedPools = await db.pool.findMany({
      where: { organizerId: user.id },
    });
    const contributedPools = await db.pool.findMany({
      where: { contributions: { some: { contributorId: user.id } } },
    });
    const pools = [...organizedPools, ...contributedPools];

    const events = pools
      .map(
        (p) => `BEGIN:VEVENT
UID:${p.id}@wishlistbot
DTSTAMP:${toIcsDate(new Date())}
DTSTART:${toIcsDate(p.deadline)}
SUMMARY:${p.title} - срок сбора
END:VEVENT`,
      )
      .join("\n");

    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//wishlistbot//ru
${events}
END:VCALENDAR`;

    reply.header("Content-Type", "text/calendar; charset=utf-8");
    return ics;
  });
}
