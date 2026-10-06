import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { buildIcsCalendar } from "../services/ics.js";
import { env } from "../env.js";

// Личная подписка-агрегат на поводы (CLAUDE.md, 2026-10-02, "продумай
// бизнесово как пользователю будет удобно синхронизировать календари") -
// переписано с нуля: раньше фид строился из Pool (групповой сбор денег,
// итерация 2, отключена от экранов) и был пуст для всех в итерации 1.
// Теперь источник - Wishlist.occasionDate (см. routes/wishlists.ts),
// работает уже сейчас, без денег.
//
// Открытый вопрос приватности из CLAUDE.md ("видит ли пользователь чужие
// поводы по умолчанию") решён так: в подписку попадают только поводы
// вишлистов, где этот пользователь реально дарил - забронировал позицию
// (classic) или присоединился к доле ("скинуться"). Не все поводы на
// свете, не поводы случайных людей - только те, где уже есть личная
// вовлечённость.

export async function calendarRoutes(app: FastifyInstance) {
  // Беклог Б-15: путь - случайный токен (User.calendarToken), а не
  // telegramId, который не секрет (виден в Telegram-группах/URL
  // профиля) - иначе чужой календарь можно было скачать, просто
  // подставив чужой id.
  app.get("/api/calendar/:token.ics", async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.params);

    const user = await db.user.findUnique({ where: { calendarToken: token } });
    if (!user) return reply.code(404).send({ error: "user_not_found" });

    const wishlists = await db.wishlist.findMany({
      where: {
        occasionDate: { not: null },
        items: {
          some: {
            OR: [{ reservedByUserId: user.id }, { giftShares: { some: { userId: user.id } } }],
          },
        },
      },
    });

    const ics = buildIcsCalendar(
      wishlists.map((w) => ({
        uid: `occasion-${w.id}`,
        title: w.occasionTitle ?? "Повод в Вишлист-боте",
        date: w.occasionDate as Date,
        url: `${env.MINI_APP_URL}/w/${w.slug}`,
      })),
    );

    reply.header("Content-Type", "text/calendar; charset=utf-8");
    return ics;
  });
}
