import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveNameFromUrl,
  isPreviewForRequestedProduct,
  isPrivateIp,
  parseYandexMarketUrl,
} from "./linkPreview.js";

// Н-6: проверка на зафиксированных слепках реальных ответов
// market.yandex.ru (2026-10-07), без сети - Маркет быстро уводит на капчу.
const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8");

const productHtml = fixture("yandex-market-1779000001.html"); // чехол MyPads
const notFoundHtml = fixture("yandex-market-not-found.html");
const cardHtml = fixture("yandex-market-card-4730017077.html"); // чехол Honor 30S

const MYPADS_SLUG =
  "chekhol-mypads-kotiki-v-forme-serdtsa-dlia-honor-x30-magic4-lite-5g-zadniaia-panel-nakladka-bamper";

test("parseYandexMarketUrl: форматы ссылок Маркета", () => {
  assert.deepEqual(parseYandexMarketUrl("https://market.yandex.ru/product--x/1779000001"), {
    kind: "product",
    id: "1779000001",
    slug: "x",
  });
  assert.deepEqual(parseYandexMarketUrl("https://market.yandex.ru/product/1779000001?sku=1"), {
    kind: "product",
    id: "1779000001",
    slug: null,
  });
  assert.deepEqual(parseYandexMarketUrl("https://market.yandex.ru/card/chekhol-na-khonor-30s/4730017077"), {
    kind: "card",
    id: "4730017077",
    slug: "chekhol-na-khonor-30s",
  });
  assert.equal(parseYandexMarketUrl("https://www.ozon.ru/product/naushniki-123/"), null);
  assert.equal(parseYandexMarketUrl("https://market.yandex.ru/search?text=x"), null);
});

test("Н-6: чужой slug при существующем id - превью не доверяем", () => {
  for (const url of [
    "https://market.yandex.ru/product--x/1779000001",
    "https://market.yandex.ru/product--naushniki-sony-wh-1000xm5/1779000001",
  ]) {
    assert.equal(isPreviewForRequestedProduct(url, url, productHtml), false, url);
  }
});

test("Н-6: правильная ссылка на тот же товар - превью принимаем", () => {
  const exact = `https://market.yandex.ru/product--${MYPADS_SLUG}/1779000001?sku=123`;
  assert.equal(isPreviewForRequestedProduct(exact, exact, productHtml), true);
  // slug слегка разошёлся (переименовали карточку) - общее слово есть
  const renamed = "https://market.yandex.ru/product--chekhol-mypads-dlya-honor-x30/1779000001";
  assert.equal(isPreviewForRequestedProduct(renamed, renamed, productHtml), true);
  // ссылка без slug - сверить нечего, кроме id, id совпал
  const bare = "https://market.yandex.ru/product/1779000001";
  assert.equal(isPreviewForRequestedProduct(bare, bare, productHtml), true);
});

test("Н-6: страница показала другой id, чем в ссылке", () => {
  const url = `https://market.yandex.ru/product--${MYPADS_SLUG}/1779000002`;
  assert.equal(isPreviewForRequestedProduct(url, url, productHtml), false);
});

test("Н-6: редирект на другой товар", () => {
  const url = `https://market.yandex.ru/product--${MYPADS_SLUG}/1779000001`;
  const redirected = `https://market.yandex.ru/product--${MYPADS_SLUG}/555`;
  assert.equal(isPreviewForRequestedProduct(url, redirected, productHtml), false);
});

test("Н-6: несуществующий id (200 'Нет такой страницы')", () => {
  const url = "https://market.yandex.ru/product--naushniki/99999999999";
  assert.equal(isPreviewForRequestedProduct(url, url, notFoundHtml), false);
  const card = "https://market.yandex.ru/card/naushniki-sony/99999999999";
  assert.equal(isPreviewForRequestedProduct(card, card, notFoundHtml), false);
});

test("Н-6: формат /card - сверка по og:url", () => {
  const right = "https://market.yandex.ru/card/chekhol-na-khonor-30s/4730017077";
  assert.equal(isPreviewForRequestedProduct(right, right, cardHtml), true);
  const wrongSlug = "https://market.yandex.ru/card/naushniki-sony/4730017077";
  assert.equal(isPreviewForRequestedProduct(wrongSlug, wrongSlug, cardHtml), false);
  const wrongSku = "https://market.yandex.ru/card/chekhol-na-khonor-30s/4730017078";
  assert.equal(isPreviewForRequestedProduct(wrongSku, wrongSku, cardHtml), false);
});

test("Другие магазины проверка не затрагивает", () => {
  const html = '<meta property="og:title" content="Наушники"><meta property="og:image" content="https://x/y.jpg">';
  for (const url of [
    "https://www.ozon.ru/product/naushniki-sony-123456/",
    "https://www.wildberries.ru/catalog/123456/detail.aspx",
    "https://aliexpress.ru/item/1005001.html",
    "https://example.com/some-page",
  ]) {
    assert.equal(isPreviewForRequestedProduct(url, url, html), true, url);
  }
});

test("Запасное название из ссылки Маркета", () => {
  assert.equal(deriveNameFromUrl("https://market.yandex.ru/product--x/1779000001"), "Товар (Яндекс.Маркет)");
  assert.equal(
    deriveNameFromUrl("https://market.yandex.ru/product--naushniki-sony-wh-1000xm5/1779000001"),
    "Naushniki sony wh 1000xm5",
  );
});

// SSRF: какие адреса считаются внутренними (сервер не должен туда ходить
// ни по ссылке пользователя, ни по редиректу).
test("isPrivateIp: внутренние адреса", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test("isPrivateIp: публичные адреса", () => {
  for (const ip of ["8.8.8.8", "93.158.134.3", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "2a02:6b8::2:242", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});
