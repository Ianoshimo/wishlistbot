import { test } from "node:test";
import assert from "node:assert/strict";
import { occasionCategory } from "./occasionCategory.js";

test("occasionCategory: типовые поводы", () => {
  assert.equal(occasionCategory("ДР Маши Ивановой"), "birthday");
  assert.equal(occasionCategory("Мой день рождения"), "birthday");
  assert.equal(occasionCategory("Юбилей мамы"), "birthday");
  assert.equal(occasionCategory("Днюха"), "birthday");
  assert.equal(occasionCategory("Новый год"), "new_year");
  assert.equal(occasionCategory("Новогодние подарки"), "new_year");
  assert.equal(occasionCategory("Свадьба Пети и Оли"), "wedding");
  assert.equal(occasionCategory("8 марта"), "march_8");
  assert.equal(occasionCategory("23 февраля"), "feb_23");
  assert.equal(occasionCategory("Годовщина"), "anniversary");
  assert.equal(occasionCategory("Выписка из роддома"), "baby");
  assert.equal(occasionCategory("День рождения сына"), "birthday");
  assert.equal(occasionCategory("Рождение малыша"), "baby");
  assert.equal(occasionCategory("Встреча выпускников"), "other");
});

test("occasionCategory: результат - только код из закрытого списка, не текст", () => {
  const allowed = ["birthday", "wedding", "new_year", "march_8", "feb_23", "anniversary", "baby", "other"];
  for (const t of ["ДР Маши Ивановой", "Иван Петров", "", "x".repeat(80)]) {
    assert.ok(allowed.includes(occasionCategory(t)));
  }
});
