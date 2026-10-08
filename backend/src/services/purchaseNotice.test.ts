import { test } from "node:test";
import assert from "node:assert/strict";
import { purchaseNoticeText } from "./purchaseNotice.js";

const base = { wishlistTitle: "Мой вишлист", selfPurchased: false, fundraiser: false, split: false };

test("покупка в магазине: название подарка и списка", () => {
  assert.equal(
    purchaseNoticeText({ ...base, itemTitle: "Мышка Logitech" }),
    "🎁 Подарок «Мышка Logitech» из списка «Мой вишлист» отмечен как купленный.",
  );
});

test("уже купил сам: текст о переводе, а не о покупке", () => {
  const t = purchaseNoticeText({ ...base, itemTitle: "Мышка", selfPurchased: true });
  assert.match(t, /перевели деньги за «Мышка»/);
  assert.doesNotMatch(t, /купленн/);
});

test("складчина и сбор по ссылке", () => {
  assert.match(purchaseNoticeText({ ...base, itemTitle: "Велосипед", selfPurchased: true, split: true }), /складчины перевели деньги за «Велосипед»/);
  assert.match(purchaseNoticeText({ ...base, itemTitle: "Велосипед", fundraiser: true, split: true }), /скинулись за «Велосипед».*сбор/);
});

test("длинное название обрезается, без названия - понятный текст", () => {
  const t = purchaseNoticeText({ ...base, itemTitle: "а".repeat(300) });
  assert.ok(t.length < 200);
  assert.match(t, /…»/);
  assert.equal(purchaseNoticeText({ ...base, itemTitle: null }), "🎁 Подарок без названия из списка «Мой вишлист» отмечен как купленный.");
});
