-- Аудит 2026-10-08, А-15: в событиях occasion_set лежал свободный текст
-- повода ("ДР Маши Ивановой") - имена третьих лиц в аналитике. Новый код
-- пишет только категорию (services/occasionCategory.ts). Здесь - то же для
-- уже записанных событий: категория из текста (SQL-копия правил; если
-- локаль БД не понимает кириллицу, категория станет 'other' - главное,
-- что текст удаляется в любом случае), затем ключ title удаляется.
UPDATE "Event"
SET props = (props::jsonb - 'title') || jsonb_build_object(
  'category',
  CASE
    WHEN lower(props->>'title') ~ '(нов(ый|ым|ого)\s*год|новогод|new\s*year|(^|[^а-яёa-z0-9_])нг($|[^а-яёa-z0-9_]))' THEN 'new_year'
    WHEN lower(props->>'title') ~ '(8\s*март|восьм\S*\s*март|женск\S*\s*д[её]н)' THEN 'march_8'
    WHEN lower(props->>'title') ~ '(23\s*феврал|защитник)' THEN 'feb_23'
    WHEN lower(props->>'title') ~ '(свадьб|свадеб|бракосочет|венчан|wedding)' THEN 'wedding'
    WHEN lower(props->>'title') ~ '(годовщин|anniversary)' THEN 'anniversary'
    WHEN lower(props->>'title') ~ '(д(ень|ня)\s*рожд|днюх|юбиле|(^|[^а-яёa-z0-9_])д\.?\s?р($|[^а-яёa-z0-9_])|birthday|bday)' THEN 'birthday'
    WHEN lower(props->>'title') ~ '(рождени[ея]\s*(ребён|ребен|малыш|сын|доч)|выписк|крестин|baby\s*shower)' THEN 'baby'
    ELSE 'other'
  END
)
WHERE type = 'occasion_set' AND props::jsonb ? 'title';
