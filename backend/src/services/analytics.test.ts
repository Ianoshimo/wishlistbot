import { test } from "node:test";
import assert from "node:assert/strict";
import { allowClientEvent, sanitizeClientEvent } from "./analytics.js";

test("sanitizeClientEvent: неизвестный тип отбрасывается", () => {
  assert.equal(sanitizeClientEvent("drop_table", {}), null);
  assert.equal(sanitizeClientEvent(42, {}), null);
  assert.equal(sanitizeClientEvent("__proto__", {}), null);
});

test("sanitizeClientEvent: остаются только разрешённые примитивные поля", () => {
  const r = sanitizeClientEvent("app_opened", {
    platform: "ios",
    fullscreen: true,
    tgVersion: 8.2,
    phone: "+79990001122",
    startKind: { nested: 1 },
  });
  assert.deepEqual(r, { type: "ui_app_opened", props: { platform: "ios", fullscreen: true, tgVersion: 8.2 } });
});

test("sanitizeClientEvent: строки обрезаются до 100 символов", () => {
  const r = sanitizeClientEvent("screen_viewed", { screen: "x".repeat(500) });
  assert.equal((r?.props.screen as string).length, 100);
});

test("allowClientEvent: не больше 120 событий в минуту на пользователя", () => {
  const now = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < 200; i++) if (allowClientEvent("user-test", now)) allowed++;
  assert.equal(allowed, 120);
  assert.equal(allowClientEvent("user-test", now + 61_000), true);
});
