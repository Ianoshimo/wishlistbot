import "dotenv/config";
import { db } from "../db.js";
import { EVENT_TYPES } from "../services/analytics.js";

// Отчёт продуктовой аналитики (2026-10-07) - только CLI, без
// HTTP-эндпоинта (не расширяем поверхность атаки). Читает таблицу Event
// (см. services/analytics.ts) и текущие поводы из Wishlist.
//
//   npm run analytics:report          # последние 30 дней
//   npm run analytics:report -- 7     # последние 7 дней
//   node dist/scripts/analyticsReport.js 30   # в проде, после build

const days = Number(process.argv[2] ?? 30);
if (!Number.isFinite(days) || days <= 0) {
  console.error("Использование: npm run analytics:report -- <дней>");
  process.exit(1);
}
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "-");
const rub = (kop: number | null) => (kop == null ? "-" : `${Math.round(kop / 100).toLocaleString("ru-RU")} ₽`);
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function section(title: string) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  console.log(`Отчёт аналитики за ${days} дн. (с ${since.toISOString().slice(0, 10)})`);

  // 1. События по типам
  section("События по типам");
  const byType = await db.$queryRaw<{ type: string; events: bigint; users: bigint }[]>`
    -- Зрители без записи User различимы только по псевдониму в dedupeKey
    -- (wishlist_viewed:<wishlistId>:<зритель>:<дата>, см. viewerKey()).
    SELECT type, COUNT(*) AS events,
      COUNT(DISTINCT COALESCE("userId", CASE WHEN type = 'wishlist_viewed' THEN split_part("dedupeKey", ':', 3) END)) AS users
    FROM "Event" WHERE "createdAt" >= ${since} GROUP BY type`;
  const typeMap = new Map(byType.map((r) => [r.type, r]));
  for (const type of EVENT_TYPES) {
    const r = typeMap.get(type);
    console.log(`  ${type.padEnd(26)} ${String(n(r?.events)).padStart(6)}   польз.: ${n(r?.users)}`);
  }

  // 2. Воронка по вишлистам, созданным за период
  section("Воронка (вишлисты, созданные за период)");
  const [f] = await db.$queryRaw<
    { created: bigint; with_item: bigint; viewed: bigint; reserved: bigint; bought: bigint }[]
  >`
    WITH cohort AS (
      SELECT DISTINCT "wishlistId" AS id FROM "Event"
      WHERE type = 'wishlist_created' AND "createdAt" >= ${since} AND "wishlistId" IS NOT NULL
    ),
    reached AS (
      SELECT e."wishlistId" AS id, e.type FROM "Event" e JOIN cohort c ON c.id = e."wishlistId"
      WHERE e.type IN ('item_added', 'wishlist_viewed', 'item_reserved', 'item_bought')
      GROUP BY e."wishlistId", e.type
    )
    SELECT
      (SELECT COUNT(*) FROM cohort) AS created,
      COUNT(*) FILTER (WHERE type = 'item_added') AS with_item,
      COUNT(*) FILTER (WHERE type = 'wishlist_viewed') AS viewed,
      COUNT(*) FILTER (WHERE type = 'item_reserved') AS reserved,
      COUNT(*) FILTER (WHERE type = 'item_bought') AS bought
    FROM reached`;
  const steps: [string, number][] = [
    ["создал вишлист", n(f?.created)],
    ["добавил позицию", n(f?.with_item)],
    ["открыли дарители", n(f?.viewed)],
    ["бронь", n(f?.reserved)],
    ["покупка", n(f?.bought)],
  ];
  steps.forEach(([label, v], i) => {
    const prev = i === 0 ? v : steps[i - 1][1];
    console.log(`  ${label.padEnd(20)} ${String(v).padStart(6)}   от старта: ${pct(v, steps[0][1]).padStart(4)}   от пред.: ${pct(v, prev)}`);
  });

  // 3. Позиции: магазины, цены, режимы
  section("Добавленные позиции");
  const [items] = await db.$queryRaw<
    { total: bigint; self: bigint; split: bigint; from_bot: bigint; priced: bigint; avg_price: number | null; median_price: number | null }[]
  >`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE (props->>'selfPurchased')::boolean) AS self,
      COUNT(*) FILTER (WHERE (props->>'maxContributors')::int > 1) AS split,
      COUNT(*) FILTER (WHERE props->>'source' = 'bot') AS from_bot,
      COUNT(props->>'price') AS priced,
      AVG((props->>'price')::numeric)::float8 AS avg_price,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (props->>'price')::numeric)::float8 AS median_price
    FROM "Event" WHERE type = 'item_added' AND "createdAt" >= ${since}`;
  const total = n(items?.total);
  console.log(`  всего: ${total}`);
  console.log(`  "уже купил(а) сам(а)" (selfPurchased): ${n(items?.self)} (${pct(n(items?.self), total)})`);
  console.log(`  "скинуться" (maxContributors > 1):     ${n(items?.split)} (${pct(n(items?.split), total)})`);
  console.log(`  добавлено через бота:                  ${n(items?.from_bot)} (${pct(n(items?.from_bot), total)})`);
  console.log(`  с ценой: ${n(items?.priced)}, средняя ${rub(items?.avg_price ?? null)}, медиана ${rub(items?.median_price ?? null)}`);

  section("Магазины (по добавленным позициям)");
  const stores = await db.$queryRaw<{ store: string | null; c: bigint }[]>`
    SELECT props->>'store' AS store, COUNT(*) AS c FROM "Event"
    WHERE type = 'item_added' AND "createdAt" >= ${since}
    GROUP BY 1 ORDER BY c DESC`;
  if (stores.length === 0) console.log("  нет данных");
  for (const s of stores) console.log(`  ${(s.store ?? "другое").padEnd(20)} ${String(n(s.c)).padStart(6)}   ${pct(n(s.c), total)}`);

  section("Брони и покупки");
  const [res] = await db.$queryRaw<{ classic: bigint; split: bigint; revealed: bigint; bought: bigint; bought_occ: bigint }[]>`
    SELECT
      COUNT(*) FILTER (WHERE type = 'item_reserved' AND props->>'mode' = 'classic') AS classic,
      COUNT(*) FILTER (WHERE type = 'item_reserved' AND props->>'mode' = 'split') AS split,
      COUNT(*) FILTER (WHERE type = 'item_reserved' AND (props->>'revealIdentity')::boolean) AS revealed,
      COUNT(*) FILTER (WHERE type = 'item_bought') AS bought,
      COUNT(*) FILTER (WHERE type = 'item_bought' AND props->>'occasionMonthDay' IS NOT NULL) AS bought_occ
    FROM "Event" WHERE "createdAt" >= ${since}`;
  const reservedTotal = n(res?.classic) + n(res?.split);
  console.log(`  броней: ${reservedTotal} (classic ${n(res?.classic)}, доли "скинуться" ${n(res?.split)})`);
  console.log(`  раскрыли себя получателю: ${n(res?.revealed)} (${pct(n(res?.revealed), reservedTotal)})`);
  console.log(`  куплено позиций: ${n(res?.bought)}, из них к поводу с датой: ${n(res?.bought_occ)}`);

  // 4. Ближайшие поводы - текущее состояние Wishlist, не события
  section("Ближайшие поводы (следующие 12 мес., текущие данные)");
  const occ = await db.$queryRaw<{ m: number; wishlists: bigint; items: bigint }[]>`
    SELECT EXTRACT(MONTH FROM w."occasionDate")::int AS m,
      COUNT(DISTINCT w.id) AS wishlists, COUNT(i.id) AS items
    FROM "Wishlist" w LEFT JOIN "Item" i ON i."wishlistId" = w.id AND i.status <> 'bought'
    WHERE w."occasionDate" IS NOT NULL
    GROUP BY 1`;
  const byMonth = new Map(occ.map((r) => [r.m, r]));
  const now = new Date();
  for (let k = 0; k < 12; k++) {
    const m = ((now.getUTCMonth() + k) % 12) + 1;
    const r = byMonth.get(m);
    if (r) console.log(`  ${MONTHS[m - 1]}   поводов: ${String(n(r.wishlists)).padStart(4)}   некупленных позиций: ${n(r.items)}`);
  }
  if (occ.length === 0) console.log("  поводы ещё не заданы");

  const topTitles = await db.$queryRaw<{ title: string; c: bigint }[]>`
    SELECT lower(trim(props->>'title')) AS title, COUNT(*) AS c FROM "Event"
    WHERE type = 'occasion_set' AND "createdAt" >= ${since}
    GROUP BY 1 ORDER BY c DESC LIMIT 10`;
  if (topTitles.length > 0) {
    console.log("  частые названия поводов за период:");
    for (const t of topTitles) console.log(`    ${t.title} - ${n(t.c)}`);
  }
}

main()
  .catch((err) => {
    console.error("Отчёт не построен:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
