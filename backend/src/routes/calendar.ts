import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { buildIcsCalendar } from "../services/ics.js";
import { env } from "../env.js";
import { dailyKey, track } from "../services/analytics.js";

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
        url: `https://t.me/${env.BOT_USERNAME}?startapp=w_${w.slug}`,
      })),
    );

    // Аналитика: календарь опрашивает фид периодически - одно событие на
    // пользователя в сутки (сигнал "подписка реально используется").
    track("calendar_feed_fetched", {
      userId: user.id,
      props: { occasionCount: wishlists.length },
      dedupeKey: dailyKey("calendar_feed_fetched", user.id),
    });

    reply.header("Content-Type", "text/calendar; charset=utf-8");
    return ics;
  });

  // Аудит 2026-10-08, А-22: внутри Telegram ссылку webcal:// открыть нельзя
  // (WebApp.openLink понимает только http/https), а https-ссылка на .ics
  // открывалась как файл - iOS предлагал разово импортировать события, и
  // новые поводы сами уже не появлялись. Теперь мини-апп открывает эту
  // промежуточную страницу (во внешнем браузере), а уже с неё кнопка ведёт
  // на webcal:// - календарь телефона оформляет именно подписку. Для
  // Android - Google Календарь (cid=webcal://...), для остальных - ссылка
  // для ручной подписки. Токен - тот же секрет, что в самом фиде.
  app.get("/api/calendar/:token/subscribe", async (req, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(req.params);
    const user = await db.user.findUnique({ where: { calendarToken: token }, select: { id: true } });
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    if (!user) return reply.code(404).send(subscribePage(null));

    const forwarded = req.headers["x-forwarded-proto"];
    const proto = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") || req.protocol;
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
    const path = `/api/calendar/${encodeURIComponent(token)}.ics`;
    track("calendar_subscribe_page_opened", { userId: user.id, props: {} });
    return subscribePage({ https: `${proto}://${host}${path}`, webcal: `webcal://${host}${path}` });
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function subscribePage(urls: { https: string; webcal: string } | null): string {
  const body = urls
    ? `<h1>Подписка на поводы</h1>
<p>Один раз подпишитесь - дни рождения и другие поводы тех, кому вы дарите, будут появляться в календаре сами, с напоминанием за 3 дня.</p>
<a class="btn primary" href="${esc(urls.webcal)}">Подписаться в Календаре</a>
<p class="hint">iPhone, iPad, Mac: нажмите кнопку и подтвердите «Подписаться».</p>
<a class="btn" href="https://calendar.google.com/calendar/r?cid=${esc(encodeURIComponent(urls.webcal))}">Подписаться в Google Календаре</a>
<p class="hint">Android и любой телефон с Google-аккаунтом.</p>
<h2>Другой календарь</h2>
<p class="hint">Яндекс Календарь, Outlook и другие: добавьте календарь «по ссылке» (подписка, а не импорт файла) и вставьте адрес:</p>
<input readonly value="${esc(urls.https)}" onclick="this.select()">`
    : `<h1>Ссылка устарела</h1><p>Откройте «Повод и календарь» в мини-аппе ещё раз.</p>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Подписка на календарь</title>
<style>
:root{--bg:#f5f4fb;--surface:#fff;--text:#1b1730;--muted:#6b648c;--accent:#4d3e99;--on-accent:#fff;--border:#e3dff2}
@media (prefers-color-scheme:dark){:root{--bg:#15111f;--surface:#211a35;--text:#f2f0fa;--muted:#b0a9c9;--accent:#8a7ae0;--on-accent:#15111f;--border:rgba(242,240,250,.12)}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:440px;margin:0 auto;padding:28px 16px 40px}
h1{font-size:22px;margin:0 0 8px}h2{font-size:16px;margin:28px 0 4px}
p{margin:0 0 16px}.hint{font-size:13px;color:var(--muted);margin:6px 0 18px}
.btn{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--accent);font-weight:600;text-decoration:none}
.btn.primary{background:var(--accent);color:var(--on-accent);border:none}
input{width:100%;box-sizing:border-box;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px}
</style></head><body><main>${body}</main></body></html>`;
}
