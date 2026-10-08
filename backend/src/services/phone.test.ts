import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "./phone.js";

test("А-18: примеры из аудита нормализуются к +7XXXXXXXXXX", () => {
  assert.equal(normalizePhone("8.900.123.45.67"), "+79001234567");
  assert.equal(normalizePhone("+7 (900) 123 - 45 - 67"), "+79001234567");
  assert.equal(normalizePhone("89001234567"), "+79001234567");
  assert.equal(normalizePhone("+79001234567"), "+79001234567");
  assert.equal(normalizePhone("9001234567"), "+79001234567");
  assert.equal(normalizePhone("  +7 900 123-45-67 "), "+79001234567");
});

test("А-18: мало цифр, лишние цифры, буквы, чужой код - ошибка", () => {
  assert.equal(normalizePhone("900 123 45"), null);
  assert.equal(normalizePhone("+7 900 123 45 67 8"), null);
  assert.equal(normalizePhone("+1 900 123 45 67"), null);
  assert.equal(normalizePhone("тел 89001234567"), null);
  assert.equal(normalizePhone(""), null);
});
