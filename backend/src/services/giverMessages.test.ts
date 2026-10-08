import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysLeft,
  giftCompletedText,
  giverThanksText,
  itemDeletedText,
  peopleWord,
  thanksCaption,
  reminderText,
  shareThanksText,
} from "./giverMessages.js";

const ctx = { itemTitle: "Наушники Sony", wishlistTitle: "ДР", ownerName: "Аня" };

test("напоминание: подарок, чей список, сколько осталось, что сделать", () => {
  const t = reminderText({ ...ctx, payoutMethod: null, split: false, days: 3 });
  assert.match(t, /забронировали подарок «Наушники Sony» из списка «ДР» \(Аня\)/);
  assert.match(t, /Бронь снимется через 3 дня, если не отметить покупку/);
  assert.match(t, /Отметить купленным/);
});

test("напоминание: СБП и складчина - про перевод и место", () => {
  const t = reminderText({ ...ctx, payoutMethod: "sbp", split: true, days: 1 });
  assert.match(t, /складчине/);
  assert.match(t, /свою часть по СБП/);
  assert.match(t, /Место снимется меньше чем через сутки, если не отметить перевод/);
  const f = reminderText({ ...ctx, payoutMethod: "fundraiser", split: false, days: 5 });
  assert.match(f, /в сбор/);
  assert.match(f, /через 5 дней/);
});

test("напоминание без имени владельца - без пустых скобок", () => {
  const t = reminderText({ ...ctx, ownerName: "", payoutMethod: null, split: false, days: 2 });
  assert.doesNotMatch(t, /\(\)/);
});

test("daysLeft округляет вверх и не уходит в минус", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(daysLeft(new Date("2026-10-10T11:00:00Z"), now), 2);
  assert.equal(daysLeft(new Date("2026-10-08T13:00:00Z"), now), 1);
  assert.equal(daysLeft(new Date("2026-10-07T13:00:00Z"), now), 0);
});

test("спасибо дарителю: покупка и перевод", () => {
  assert.match(giverThanksText({ ...ctx, payoutMethod: null }), /отмечен купленным - спасибо/);
  assert.match(giverThanksText({ ...ctx, payoutMethod: "sbp" }), /Перевод за подарок «Наушники Sony».*спасибо/);
});

test("складчина: своя часть и подарок собран - без имён других дарителей", () => {
  assert.match(shareThanksText({ ...ctx, paid: 1, total: 3 }), /отметили 1 из 3/);
  assert.match(giftCompletedText(ctx), /собран/);
});

test("удаление: бронь/место сняты, про деньги - только тому, кто отметил перевод", () => {
  const t = itemDeletedText({ ...ctx, split: false, paidByGiver: false });
  assert.match(t, /удалил подарок «Наушники Sony».*ваша бронь снята/);
  assert.doesNotMatch(t, /вернуть/);
  const p = itemDeletedText({ ...ctx, split: true, paidByGiver: true });
  assert.match(p, /место в складчине снято/);
  assert.match(p, /вернуть/);
});

test("склонение 'человек'", () => {
  assert.deepEqual([1, 2, 5, 11, 22].map(peopleWord), ["человек", "человека", "человек", "человек", "человека"]);
});

test("А-32: подпись благодарности - имя получателя и название подарка", () => {
  assert.equal(thanksCaption({ ownerName: "Аня", itemTitle: "Мышка" }), "🎁 Аня благодарит вас за «Мышка»!");
  assert.equal(thanksCaption({ ownerName: " ", itemTitle: null }), "🎁 Получатель подарка благодарит вас за подарок!");
});
