import { test } from "node:test";
import assert from "node:assert/strict";
import { SlidingLimiter } from "./itemLimits.js";

test("А-33: лимит в минуту - после N действий отказ, через минуту снова можно", () => {
  const l = new SlidingLimiter(3, 100);
  const t0 = 1_000_000;
  assert.equal(l.take("u", t0), true);
  assert.equal(l.take("u", t0 + 1), true);
  assert.equal(l.take("u", t0 + 2), true);
  assert.equal(l.take("u", t0 + 3), false);
  // другой пользователь не затронут
  assert.equal(l.take("v", t0 + 3), true);
  assert.equal(l.take("u", t0 + 60_001), true);
});

test("А-33: дневной потолок держится и после минутного окна", () => {
  const l = new SlidingLimiter(100, 5);
  const t0 = 5_000_000;
  for (let i = 0; i < 5; i++) assert.equal(l.take("u", t0 + i * 70_000), true);
  assert.equal(l.take("u", t0 + 10 * 70_000), false);
  assert.equal(l.take("u", t0 + 24 * 3_600_000 + 1), true);
});
