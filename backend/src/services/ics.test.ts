import { test } from "node:test";
import assert from "node:assert/strict";
import { ICS_LINE_OCTETS, buildIcsCalendar, foldIcsLine } from "./ics.js";

function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

test("А-45: длинная русская строка сворачивается по 75 октетов и разворачивается обратно", () => {
  const line = `SUMMARY:${"День рождения Анны Ивановны и праздничный ужин у бабушки на даче 🎉 ".repeat(2)}`;
  const folded = foldIcsLine(line);
  for (const part of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(part, "utf8") <= ICS_LINE_OCTETS, `строка ${Buffer.byteLength(part, "utf8")} октетов`);
  }
  assert.equal(unfold(folded), line);
});

test("А-45: короткая строка не меняется", () => {
  assert.equal(foldIcsLine("VERSION:2.0"), "VERSION:2.0");
});

test("А-45: у подписки есть имя календаря, у всех строк - не больше 75 октетов", () => {
  const ics = buildIcsCalendar(
    [
      {
        uid: "occasion-x",
        title: "Очень длинное название повода: юбилей свадьбы родителей, 30 лет вместе",
        date: new Date("2026-12-15T00:00:00Z"),
        url: "https://t.me/wishhdesk_bot?startapp=w_cmabcdefghijklmnopqrstuvw",
      },
    ],
    { name: "Whish Helper — поводы друзей" },
  );
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(unfold(ics).includes("X-WR-CALNAME:Whish Helper — поводы друзей"));
  for (const l of ics.split("\r\n")) assert.ok(Buffer.byteLength(l, "utf8") <= ICS_LINE_OCTETS);
  assert.ok(unfold(ics).includes("SUMMARY:Очень длинное название повода: юбилей свадьбы родителей\\, 30 лет вместе"));
});

test("А-45: разовый .ics без имени календаря", () => {
  const ics = buildIcsCalendar([{ uid: "o", title: "ДР", date: new Date("2026-03-15T00:00:00Z") }]);
  assert.ok(!ics.includes("X-WR-CALNAME"));
});
