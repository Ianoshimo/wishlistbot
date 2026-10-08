import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_ITEM, planItemEdit, type EditCurrent, type PayoutProfile } from "./itemEdit.js";

const free: EditCurrent = EMPTY_ITEM;
const PHONE = "+7 900 000-00-00";
const profile: PayoutProfile = { sbpPhone: PHONE, sbpBank: "Т-Банк", fundraiserUrl: "https://bank/default" };
const emptyProfile: PayoutProfile = { sbpPhone: null, sbpBank: null, fundraiserUrl: null };
const sbpItem: EditCurrent = { ...free, payoutMethod: "sbp", sbpPhone: "+79001112233", sbpBank: "Сбербанк" };
const fundItem: EditCurrent = { ...free, payoutMethod: "fundraiser", fundraiserUrl: "https://bank/f" };

// --- А-5: создание (правка пустого подарка) ---

test("создание без денег (магазин) - можно, реквизитов нет", () => {
  const p = planItemEdit(free, {}, profile);
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.payoutMethod, null);
    assert.equal(p.sbpPhone, null);
    assert.equal(p.fundraiserUrl, null);
    assert.deepEqual(p.profileUpdate, {});
  }
});

test("создание СБП: номер и банк подставляются из профиля", () => {
  const p = planItemEdit(free, { payoutMethod: "sbp" }, profile);
  assert.equal(p.ok && p.sbpPhone, PHONE);
  assert.equal(p.ok && p.sbpBank, "Т-Банк");
  assert.deepEqual(p.ok && p.profileUpdate, {});
});

test("создание СБП с новыми реквизитами - на подарке они, профиль запоминает последние", () => {
  const p = planItemEdit(free, { payoutMethod: "sbp", sbpPhone: "+79005556677", sbpBank: "Альфа-Банк" }, profile);
  assert.equal(p.ok && p.sbpPhone, "+79005556677");
  assert.deepEqual(p.ok && p.profileUpdate, { sbpPhone: "+79005556677", sbpBank: "Альфа-Банк" });
});

test("СБП без номера - sbp_phone_required, без банка - sbp_bank_required", () => {
  assert.deepEqual(planItemEdit(free, { payoutMethod: "sbp" }, emptyProfile), {
    ok: false,
    code: 400,
    error: "sbp_phone_required",
  });
  const p = planItemEdit(free, { payoutMethod: "sbp", sbpPhone: PHONE }, emptyProfile);
  assert.equal(!p.ok && p.error, "sbp_bank_required");
  // Пробелы - не банк.
  const blank = planItemEdit(free, { payoutMethod: "sbp", sbpPhone: PHONE, sbpBank: "   " }, emptyProfile);
  assert.equal(!blank.ok && blank.error, "sbp_bank_required");
});

test("Сбор: ссылка из профиля или присланная, без ссылки - fundraiser_url_required", () => {
  const p = planItemEdit(free, { payoutMethod: "fundraiser" }, profile);
  assert.equal(p.ok && p.fundraiserUrl, "https://bank/default");
  const none = planItemEdit(free, { payoutMethod: "fundraiser" }, emptyProfile);
  assert.equal(!none.ok && none.error, "fundraiser_url_required");
  const own = planItemEdit(free, { payoutMethod: "fundraiser", fundraiserUrl: "https://bank/new" }, profile);
  assert.deepEqual(own.ok && own.profileUpdate, { fundraiserUrl: "https://bank/new" });
});

test("А-5: складчина по СБП на НЕкупленный подарок - можно", () => {
  const p = planItemEdit(free, { payoutMethod: "sbp", maxContributors: 5 }, profile);
  assert.equal(p.ok, true);
  assert.equal(p.ok && p.selfPurchased, false);
  assert.equal(p.ok && p.maxContributors, 5);
});

test("складчина без денежного способа - split_needs_payout", () => {
  const p = planItemEdit(free, { maxContributors: 4 }, profile);
  assert.equal(!p.ok && p.error, "split_needs_payout");
  assert.equal(planItemEdit(free, { maxContributors: 4, payoutMethod: "fundraiser" }, profile).ok, true);
});

test("'уже купил сам' без денежного способа - self_purchased_needs_payout, со способом - можно", () => {
  const p = planItemEdit(free, { selfPurchased: true }, profile);
  assert.equal(!p.ok && p.error, "self_purchased_needs_payout");
  assert.equal(planItemEdit(free, { selfPurchased: true, payoutMethod: "sbp" }, profile).ok, true);
  assert.equal(planItemEdit(free, { selfPurchased: true, payoutMethod: "fundraiser" }, profile).ok, true);
});

test("реквизиты другого способа не сохраняются на подарке", () => {
  const p = planItemEdit(free, { payoutMethod: "fundraiser", sbpPhone: "+79001112233", fundraiserUrl: "https://bank/x" }, profile);
  assert.equal(p.ok && p.sbpPhone, null);
  assert.equal(p.ok && p.fundraiserUrl, "https://bank/x");
  assert.deepEqual(p.ok && p.profileUpdate, { fundraiserUrl: "https://bank/x" });
});

// --- правка ---

test("реквизиты подарка не берутся из профиля, пока способ тот же (переопределение на подарке)", () => {
  const p = planItemEdit(sbpItem, { selfPurchased: false }, profile);
  assert.equal(p.ok && p.sbpPhone, "+79001112233");
  assert.equal(p.ok && p.sbpBank, "Сбербанк");
  assert.equal(p.ok && p.detailsChanged, false);
});

test("смена способа СБП -> Сбор очищает номер и банк", () => {
  const p = planItemEdit(sbpItem, { payoutMethod: "fundraiser", fundraiserUrl: "https://bank/f" }, profile);
  assert.equal(p.ok && p.sbpPhone, null);
  assert.equal(p.ok && p.sbpBank, null);
  assert.equal(p.ok && p.methodChanged, true);
});

test("старый подарок после миграции (СБП без банка): правка без смены способа не требует банк", () => {
  const legacy: EditCurrent = { ...free, selfPurchased: true, payoutMethod: "sbp", sbpPhone: PHONE, sbpBank: null };
  const p = planItemEdit(legacy, { maxContributors: 1 }, emptyProfile);
  assert.equal(p.ok, true);
  // Банк из профиля подтягивается, если он там есть.
  const withProfile = planItemEdit(legacy, {}, profile);
  assert.equal(withProfile.ok && withProfile.sbpBank, "Т-Банк");
});

test("classic-бронь: смена способа или 'уже купил сам' - item_has_givers", () => {
  const reserved: EditCurrent = { ...sbpItem, status: "reserved", reservedByUserId: "u1" };
  for (const req of [{ payoutMethod: null }, { payoutMethod: "fundraiser" as const, fundraiserUrl: "https://bank/f" }, { selfPurchased: true }]) {
    const p = planItemEdit(reserved, req, profile);
    assert.deepEqual(p, { ok: false, code: 409, error: "item_has_givers" });
  }
});

test("classic-бронь: исправить номер/банк можно (опечатка)", () => {
  const reserved: EditCurrent = { ...sbpItem, status: "reserved", reservedByUserId: "u1" };
  const p = planItemEdit(reserved, { sbpPhone: "+79009998877", sbpBank: "ВТБ" }, profile);
  assert.equal(p.ok && p.detailsChanged, true);
  assert.equal(p.ok && p.sbpPhone, "+79009998877");
});

test("то же значение способа - не смена, бронь не мешает", () => {
  const reserved: EditCurrent = { ...sbpItem, status: "reserved", reservedByUserId: "u1" };
  assert.equal(planItemEdit(reserved, { payoutMethod: "sbp", maxContributors: 1 }, profile).ok, true);
});

test("classic-бронь: включить складчину - split_item_already_reserved", () => {
  const reserved: EditCurrent = { ...sbpItem, status: "reserved", reservedByUserId: "u1" };
  const p = planItemEdit(reserved, { maxContributors: 3 }, profile);
  assert.equal(!p.ok && p.error, "split_item_already_reserved");
});

test("складчина с долями: число мест не меньше участников, ссылку можно сменить", () => {
  const split: EditCurrent = { ...fundItem, maxContributors: 3, joined: 2 };
  assert.equal(planItemEdit(split, { maxContributors: 2 }, emptyProfile).ok, true);
  const below = planItemEdit(split, { maxContributors: 1 }, emptyProfile);
  assert.equal(!below.ok && below.error, "contributors_below_joined");
  const fund = planItemEdit(split, { fundraiserUrl: "https://bank/g" }, emptyProfile);
  assert.equal(fund.ok && fund.fundraiserUrl, "https://bank/g");
  const removed = planItemEdit(split, { payoutMethod: null }, emptyProfile);
  assert.equal(!removed.ok && removed.error, "item_has_givers");
});

test("куплено: любое денежное поле - item_already_bought, пустая правка - можно", () => {
  const bought: EditCurrent = { ...sbpItem, status: "bought", reservedByUserId: "u1" };
  for (const req of [
    { selfPurchased: true },
    { payoutMethod: null },
    { sbpPhone: "+79009998877" },
    { maxContributors: 3 },
  ]) {
    const p = planItemEdit(bought, req, profile);
    assert.equal(!p.ok && p.error, "item_already_bought");
  }
  assert.equal(planItemEdit(bought, {}, profile).ok, true);
  const boughtSplit: EditCurrent = { ...fundItem, status: "bought", maxContributors: 2, joined: 2 };
  const p = planItemEdit(boughtSplit, { fundraiserUrl: "https://bank/x" }, emptyProfile);
  assert.equal(!p.ok && p.error, "item_already_bought");
});

test("выключение складчины возвращает обычный подарок, способ остаётся", () => {
  const split: EditCurrent = { ...fundItem, maxContributors: 3 };
  const off = planItemEdit(split, { maxContributors: 1 }, emptyProfile);
  assert.equal(off.ok && off.maxContributors, 1);
  assert.equal(off.ok && off.payoutMethod, "fundraiser");
});
