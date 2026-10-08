import { test } from "node:test";
import assert from "node:assert/strict";

// reminders.ts импортирует env (DATABASE_URL и т.п. обязательны) - для
// юнит-теста чистых функций подставляем заглушки до импорта.
process.env.DATABASE_URL ??= "postgresql://test/test";
process.env.BOT_TOKEN ??= "000000:test";
process.env.MINI_APP_URL ??= "https://example.test";
const { isSendWindow, reminderDue, REMINDER_PERIOD_MS } = await import("./reminders.js");

const H = 60 * 60 * 1000;

test("окно 10:00-21:00 по Москве (UTC+3)", () => {
  // 07:00 UTC = 10:00 МСК - уже можно; 06:59 UTC = 09:59 - ещё нельзя.
  assert.equal(isSendWindow(new Date("2026-10-08T07:00:00Z")), true);
  assert.equal(isSendWindow(new Date("2026-10-08T06:59:00Z")), false);
  // 17:59 UTC = 20:59 МСК - можно; 18:00 UTC = 21:00 - уже нельзя.
  assert.equal(isSendWindow(new Date("2026-10-08T17:59:00Z")), true);
  assert.equal(isSendWindow(new Date("2026-10-08T18:00:00Z")), false);
  // Ночь: 23:30 UTC = 02:30 МСК.
  assert.equal(isSendWindow(new Date("2026-10-08T23:30:00Z")), false);
});

test("первое напоминание - не раньше чем через сутки после брони", () => {
  const reservedAt = new Date("2026-10-08T08:00:00Z");
  const expires = new Date(reservedAt.getTime() + 5 * 24 * H);
  assert.equal(reminderDue(reservedAt, null, expires, new Date(reservedAt.getTime() + 23 * H)), false);
  assert.equal(reminderDue(reservedAt, null, expires, new Date(reservedAt.getTime() + REMINDER_PERIOD_MS)), true);
});

test("не чаще раза в сутки после прошлого напоминания", () => {
  const reservedAt = new Date("2026-10-01T08:00:00Z");
  const expires = new Date(reservedAt.getTime() + 5 * 24 * H);
  const last = new Date("2026-10-03T09:00:00Z");
  assert.equal(reminderDue(reservedAt, last, expires, new Date("2026-10-04T08:59:00Z")), false);
  assert.equal(reminderDue(reservedAt, last, expires, new Date("2026-10-04T09:00:00Z")), true);
});

test("истёкшая бронь - напоминаний больше нет", () => {
  const reservedAt = new Date("2026-10-01T08:00:00Z");
  const expires = new Date(reservedAt.getTime() + 5 * 24 * H);
  assert.equal(reminderDue(reservedAt, null, expires, new Date(expires.getTime() + 1)), false);
  assert.equal(reminderDue(reservedAt, null, expires, expires), false);
});
