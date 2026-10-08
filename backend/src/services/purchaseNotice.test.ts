import { test } from "node:test";
import assert from "node:assert/strict";
import { purchaseNoticeText } from "./purchaseNotice.js";

const base = { wishlistTitle: "Мой вишлист", payoutMethod: null, split: false } as const;

test("покупка в магазине: название подарка и списка", () => {
  assert.equal(
    purchaseNoticeText({ ...base, itemTitle: "Мышка Logitech" }),
    "🎁 Подарок «Мышка Logitech» из списка «Мой вишлист» отмечен как купленный.",
  );
});

test("СБП: текст о переводе, а не о покупке", () => {
  const t = purchaseNoticeText({ ...base, itemTitle: "Мышка", payoutMethod: "sbp" });
  assert.match(t, /перевели деньги за «Мышка»/);
  assert.doesNotMatch(t, /купленн/);
});

test("складчина и сбор по ссылке", () => {
  assert.match(purchaseNoticeText({ ...base, itemTitle: "Велосипед", payoutMethod: "sbp", split: true }), /складчины перевели деньги за «Велосипед»/);
  assert.match(purchaseNoticeText({ ...base, itemTitle: "Велосипед", payoutMethod: "fundraiser", split: true }), /скинулись за «Велосипед».*сбор/);
  assert.match(purchaseNoticeText({ ...base, itemTitle: "Велосипед", payoutMethod: "fundraiser" }), /перевели деньги за «Велосипед».*через сбор/);
});

test("длинное название обрезается, без названия - понятный текст", () => {
  const t = purchaseNoticeText({ ...base, itemTitle: "а".repeat(300) });
  assert.ok(t.length < 200);
  assert.match(t, /…»/);
  assert.equal(purchaseNoticeText({ ...base, itemTitle: null }), "🎁 Подарок без названия из списка «Мой вишлист» отмечен как купленный.");
});
