-- QA-14: occasionDate хранился как "местная полночь" клиента в UTC
-- (15 декабря по Москве = 2026-12-14 21:00 UTC), из-за чего .ics давал
-- день на сутки раньше. Приводим к UTC-полночи задуманного дня - тот же
-- сдвиг +12 ч и усечение, что и services/ics.ts toCalendarDay.
UPDATE "Wishlist"
SET "occasionDate" = date_trunc('day', "occasionDate" + interval '12 hours')
WHERE "occasionDate" IS NOT NULL;
