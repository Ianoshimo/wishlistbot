import { test } from "node:test";
import assert from "node:assert/strict";
import { planItemEdit, type EditCurrent } from "./itemEdit.js";

const free: EditCurrent = {
  status: "available",
  selfPurchased: false,
  maxContributors: 1,
  fundraiserUrl: null,
  reservedByUserId: null,
  joined: 0,
};
const PHONE = "+7 900 000-00-00";

test("свободная позиция: включить 'уже купил сам' с сохранённым номером", () => {
  const p = planItemEdit(free, { selfPurchased: true }, PHONE);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.selfPurchased, true);
    assert.equal(p.selfChanged, true);
    assert.equal(p.phoneToSave, null);
  }
});

test("свободная позиция: включить 'уже купил сам' с новым номером - номер сохраняется", () => {
  const p = planItemEdit(free, { selfPurchased: true, sbpPhone: "+79001112233" }, PHONE);
  assert.equal(p.ok && p.phoneToSave, "+79001112233");
});

test("включение 'уже купил сам' без номера - sbp_phone_required", () => {
  const p = planItemEdit(free, { selfPurchased: true }, null);
  assert.deepEqual(p, { ok: false, code: 400, error: "sbp_phone_required" });
});

test("выключение 'уже купил сам' у свободной позиции - можно, номер не нужен", () => {
  const p = planItemEdit({ ...free, selfPurchased: true }, { selfPurchased: false }, null);
  assert.equal(p.ok, true);
});

test("classic-бронь: смена 'уже купил сам' в обе стороны - item_has_givers", () => {
  const reserved: EditCurrent = { ...free, status: "reserved", reservedByUserId: "u1" };
  assert.deepEqual(planItemEdit(reserved, { selfPurchased: true }, PHONE), {
    ok: false,
    code: 409,
    error: "item_has_givers",
  });
  assert.deepEqual(planItemEdit({ ...reserved, selfPurchased: true }, { selfPurchased: false }, PHONE), {
    ok: false,
    code: 409,
    error: "item_has_givers",
  });
});

test("то же значение режима - не смена, бронь не мешает", () => {
  const reserved: EditCurrent = { ...free, status: "reserved", reservedByUserId: "u1", selfPurchased: true };
  const p = planItemEdit(reserved, { selfPurchased: true, maxContributors: 1, fundraiserUrl: null }, PHONE);
  assert.equal(p.ok, true);
});

test("classic-бронь: включить складчину - split_item_already_reserved", () => {
  const reserved: EditCurrent = { ...free, status: "reserved", reservedByUserId: "u1", selfPurchased: true };
  const p = planItemEdit(reserved, { maxContributors: 3 }, PHONE);
  assert.equal(!p.ok && p.error, "split_item_already_reserved");
});

test("складчина с долями: смена 'уже купил сам' - item_has_givers", () => {
  const split: EditCurrent = { ...free, maxContributors: 3, fundraiserUrl: "https://bank/f", joined: 1 };
  const p = planItemEdit(split, { selfPurchased: true }, PHONE);
  assert.equal(!p.ok && p.error, "item_has_givers");
});

test("складчина с долями: число мест не меньше участников, ссылку можно сменить, убрать нельзя", () => {
  const split: EditCurrent = { ...free, maxContributors: 3, fundraiserUrl: "https://bank/f", joined: 2 };
  assert.equal(planItemEdit(split, { maxContributors: 2 }, null).ok, true);
  const below = planItemEdit(split, { maxContributors: 1 }, null);
  assert.equal(!below.ok && below.error, "contributors_below_joined");
  const fund = planItemEdit(split, { fundraiserUrl: "https://bank/g" }, null);
  assert.equal(fund.ok && fund.fundraiserUrl, "https://bank/g");
  const removed = planItemEdit(split, { fundraiserUrl: null }, null);
  assert.equal(!removed.ok && removed.error, "split_needs_payment_target");
});

test("куплено: любое поле режима - item_already_bought, пустая правка - можно", () => {
  const bought: EditCurrent = { ...free, status: "bought", reservedByUserId: "u1" };
  for (const req of [{ selfPurchased: true }, { maxContributors: 3, fundraiserUrl: "https://bank/f" }]) {
    const p = planItemEdit(bought, req, PHONE);
    assert.equal(!p.ok && p.error, "item_already_bought");
  }
  assert.equal(planItemEdit(bought, {}, PHONE).ok, true);
  const boughtSplit: EditCurrent = { ...free, status: "bought", maxContributors: 2, fundraiserUrl: "https://bank/f", joined: 2 };
  const p = planItemEdit(boughtSplit, { fundraiserUrl: "https://bank/x" }, null);
  assert.equal(!p.ok && p.error, "item_already_bought");
});

test("QB4-3: включение 'уже купил сам' у складчины со сбором очищает ссылку", () => {
  const split: EditCurrent = { ...free, maxContributors: 3, fundraiserUrl: "https://bank/f" };
  const p = planItemEdit(split, { selfPurchased: true }, PHONE);
  assert.equal(p.ok && p.fundraiserUrl, null);
  assert.equal(p.ok && p.fundraiserChanged, true);
});

test("QB4-3: выключение 'уже купил сам' у складчины без ссылки - split_needs_payment_target", () => {
  const split: EditCurrent = { ...free, selfPurchased: true, maxContributors: 3 };
  const p = planItemEdit(split, { selfPurchased: false }, PHONE);
  assert.equal(!p.ok && p.error, "split_needs_payment_target");
  const ok = planItemEdit(split, { selfPurchased: false, fundraiserUrl: "https://bank/f" }, PHONE);
  assert.equal(ok.ok && ok.fundraiserUrl, "https://bank/f");
});

test("QB4-3: выключение складчины очищает ссылку; ссылка у обычной позиции игнорируется", () => {
  const split: EditCurrent = { ...free, maxContributors: 3, fundraiserUrl: "https://bank/f" };
  const off = planItemEdit(split, { maxContributors: 1 }, null);
  assert.equal(off.ok && off.fundraiserUrl, null);
  const classic = planItemEdit(free, { fundraiserUrl: "https://bank/f" }, null);
  assert.equal(classic.ok && classic.fundraiserUrl, null);
  assert.equal(classic.ok && classic.fundraiserChanged, false);
});

test("включить складчину без способа перевода - split_needs_payment_target", () => {
  const p = planItemEdit(free, { maxContributors: 4 }, PHONE);
  assert.equal(!p.ok && p.error, "split_needs_payment_target");
  assert.equal(planItemEdit(free, { maxContributors: 4, selfPurchased: true }, PHONE).ok, true);
});
