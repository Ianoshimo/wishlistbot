import { APP_NAME } from "./brand.js";

// Построение .ics (CLAUDE.md, 2026-10-02) - общая логика для двух мест:
// разового события по конкретному вишлисту (routes/wishlists.ts,
// "Добавить в календарь" на экране дарителя) и личной подписки-агрегата
// по всем вишлистам, где пользователь дарил (routes/calendar.ts).
//
// Повод - не время, а день (день рождения, не "в 14:32") - VALUE=DATE,
// не DATE-TIME, календарь покажет весь день, а не точку на часах.
// RRULE:FREQ=YEARLY - поводы обычно годовые, без этого напоминание
// сработало бы один раз и исчезло бы из вида на следующий год, а
// пересинхронизировать вручную никто не станет. VALARM - триггер за 3
// дня, чтобы реально успеть выбрать и купить подарок, а не просто
// увидеть дату в день икс.

// QA-14: повод - календарный день, а не момент времени. Клиент мог прислать
// "местную полночь" в UTC (15 декабря по Москве = 2026-12-14T21:00Z), и
// голый toISOString() давал день на сутки раньше. Сдвиг на +12 ч и усечение
// до UTC-дня возвращают задуманный день для любого пояса в пределах ±12 ч -
// и для уже сохранённых значений, и для старых закэшированных клиентов.
export function toCalendarDay(d: Date): Date {
  const shifted = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function toIcsDateOnly(d: Date): string {
  return toCalendarDay(d).toISOString().slice(0, 10).replace(/-/g, "");
}

// CRLF и экранирование спецсимволов по RFC 5545 - без этого Apple
// Calendar/Яндекс.Календарь местами либо обрезают текст на запятой,
// либо вовсе отказываются парсить файл.
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

// Аудит 2026-10-08, А-45: RFC 5545 §3.1 - строка не длиннее 75 октетов,
// длиннее - переносится CRLF + пробел. Считаем именно байты UTF-8 (русская
// буква - 2 октета, эмодзи - 4) и не режем символ посередине: SUMMARY повода
// на русском легко выходит за 75 октетов, строгие парсеры такое отвергают.
export const ICS_LINE_OCTETS = 75;

export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= ICS_LINE_OCTETS) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  // Первая строка - до 75 октетов, продолжения - пробел + до 74.
  let limit = ICS_LINE_OCTETS;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = ICS_LINE_OCTETS - 1;
    }
    current += ch;
    bytes += b;
  }
  out.push(current);
  return out.join("\r\n ");
}

export interface OccasionEvent {
  uid: string;
  title: string;
  date: Date;
  // Ссылка обратно на вишлист - из календаря сразу переходишь в
  // мини-апп, не нужно искать переписку с ботом заново.
  url?: string;
}

function buildEvent(event: OccasionEvent): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}@wishlistbot`,
    `DTSTAMP:${new Date().toISOString().slice(0, 10).replace(/-/g, "")}T000000Z`,
    `DTSTART;VALUE=DATE:${toIcsDateOnly(event.date)}`,
    "RRULE:FREQ=YEARLY",
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.url) lines.push(`URL:${event.url}`, `DESCRIPTION:${escapeIcsText(event.url)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Повод скоро — загляните в вишлист",
    "TRIGGER:-P3D",
    "END:VALARM",
    "END:VEVENT",
  );
  return lines.map(foldIcsLine).join("\r\n");
}

// А-45: name - имя календаря-подписки (X-WR-CALNAME понимают Apple, Google,
// Outlook, Яндекс) - иначе подписка в списке календарей называлась адресом.
// Завершающий CRLF - по RFC 5545 каждая строка, включая последнюю.
export function buildIcsCalendar(events: OccasionEvent[], opts: { name?: string } = {}): string {
  const head = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${APP_NAME}//RU`, "CALSCALE:GREGORIAN"];
  if (opts.name) head.push("METHOD:PUBLISH", `X-WR-CALNAME:${escapeIcsText(opts.name)}`);
  return [...head.map(foldIcsLine), ...events.map(buildEvent), "END:VCALENDAR"].join("\r\n") + "\r\n";
}
