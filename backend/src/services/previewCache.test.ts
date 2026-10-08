import { test } from "node:test";
import assert from "node:assert/strict";
import { PreviewCache } from "./previewCache.js";

test("А-33: найденное превью отдаётся из кэша сутки", () => {
  const c = new PreviewCache();
  const p = { title: "Мышка", imageUrl: "https://img/1.jpg" };
  c.set("https://wildberries.ru/catalog/1/detail.aspx", p, true, 0);
  assert.deepEqual(c.get("https://wildberries.ru/catalog/1/detail.aspx", 23 * 3_600_000), p);
  assert.equal(c.get("https://wildberries.ru/catalog/1/detail.aspx", 25 * 3_600_000), null);
});

test("А-33: пустой платный результат кэшируется на час, бесплатный - нет", () => {
  const c = new PreviewCache();
  const empty = { title: null, imageUrl: null };
  c.set("https://wb/1", empty, true, 0);
  c.set("https://ozon/1", empty, false, 0);
  assert.deepEqual(c.get("https://wb/1", 59 * 60_000), empty);
  assert.equal(c.get("https://wb/1", 61 * 60_000), null);
  assert.equal(c.get("https://ozon/1", 1), null);
});
