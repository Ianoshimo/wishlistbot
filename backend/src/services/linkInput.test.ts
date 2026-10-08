import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUrl, looksLikePhone, preprocessUrlInput } from "./linkInput.js";

test("extractUrl: голая ссылка остаётся как есть", () => {
  assert.equal(extractUrl("https://www.ozon.ru/product/abc-123/"), "https://www.ozon.ru/product/abc-123/");
  assert.equal(extractUrl("  http://example.com/x  "), "http://example.com/x");
});

test("extractUrl: текст из 'Поделиться' маркетплейсов", () => {
  assert.equal(extractUrl("Смотри, что нашёл на Ozon https://ozon.ru/t/AbCdEf"), "https://ozon.ru/t/AbCdEf");
  assert.equal(
    extractUrl("Посмотрите, что я нашел на Wildberries! https://www.wildberries.ru/catalog/123456/detail.aspx"),
    "https://www.wildberries.ru/catalog/123456/detail.aspx",
  );
  assert.equal(
    extractUrl("Наушники Sony WH-1000XM5 — 29 990 ₽\nhttps://www.avito.ru/moskva/audio/naushniki_123?utm_source=share"),
    "https://www.avito.ru/moskva/audio/naushniki_123?utm_source=share",
  );
  assert.equal(
    extractUrl("Робот-пылесос за 15 990 ₽ на Яндекс Маркете https://market.yandex.ru/cc/7AbCd"),
    "https://market.yandex.ru/cc/7AbCd",
  );
});

test("extractUrl: берётся первая ссылка, хвостовая пунктуация отрезается", () => {
  assert.equal(extractUrl("вот (https://ozon.ru/t/Ab), и ещё https://wb.ru/x"), "https://ozon.ru/t/Ab");
  assert.equal(extractUrl("Ссылка: https://ozon.ru/t/Ab."), "https://ozon.ru/t/Ab");
  assert.equal(extractUrl("«https://ozon.ru/t/Ab»"), "https://ozon.ru/t/Ab");
});

test("extractUrl: ссылка без схемы дополняется https://", () => {
  assert.equal(extractUrl("ozon.ru/t/AbCdEf"), "https://ozon.ru/t/AbCdEf");
  assert.equal(extractUrl("смотри ozon.ru/t/AbCdEf"), "https://ozon.ru/t/AbCdEf");
  assert.equal(extractUrl("www.ozon.ru"), "https://www.ozon.ru");
});

test("extractUrl: не ссылка - null", () => {
  assert.equal(extractUrl(""), null);
  assert.equal(extractUrl("89000000000"), null);
  assert.equal(extractUrl("+7 900 123-45-67"), null);
  assert.equal(extractUrl("наушники sony"), null);
  assert.equal(extractUrl("javascript:alert(1)"), null);
  assert.equal(extractUrl("т.е. хочу"), null);
});

test("looksLikePhone", () => {
  assert.equal(looksLikePhone("89000000000"), true);
  assert.equal(looksLikePhone("+7 900 123-45-67"), true);
  assert.equal(looksLikePhone("8 (900) 123 45 67"), true);
  assert.equal(looksLikePhone("9001234567"), true);
  assert.equal(looksLikePhone("12345"), false);
  assert.equal(looksLikePhone("https://ozon.ru/t/123"), false);
  assert.equal(looksLikePhone("Сбор 89000000000"), false);
});

test("preprocessUrlInput: не строка и не ссылка - без изменений", () => {
  assert.equal(preprocessUrlInput(42), 42);
  assert.equal(preprocessUrlInput("абв"), "абв");
  assert.equal(preprocessUrlInput("Смотри https://ozon.ru/t/A"), "https://ozon.ru/t/A");
});
