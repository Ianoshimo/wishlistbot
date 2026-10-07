-- QA блока 4, QB4-3: ссылка на сбор имеет смысл только у складчины
-- (maxContributors > 1). Раньше API принимал её и у обычной позиции и не
-- очищал при выключении складчины - такие ссылки никто не использует,
-- а список показывал "Сбор по ссылке банка". Чистим.
UPDATE "Item" SET "fundraiserUrl" = NULL WHERE "maxContributors" <= 1 AND "fundraiserUrl" IS NOT NULL;
