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

function toIcsDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// CRLF и экранирование спецсимволов по RFC 5545 - без этого Apple
// Calendar/Яндекс.Календарь местами либо обрезают текст на запятой,
// либо вовсе отказываются парсить файл.
function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
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
    `DTSTAMP:${toIcsDateOnly(new Date())}T000000Z`,
    `DTSTART;VALUE=DATE:${toIcsDateOnly(event.date)}`,
    "RRULE:FREQ=YEARLY",
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.url) lines.push(`URL:${event.url}`, `DESCRIPTION:${escapeIcsText(event.url)}`);
  lines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Повод скоро - загляните в вишлист",
    "TRIGGER:-P3D",
    "END:VALARM",
    "END:VEVENT",
  );
  return lines.join("\r\n");
}

export function buildIcsCalendar(events: OccasionEvent[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//wishlistbot//ru",
    "CALSCALE:GREGORIAN",
    ...events.map(buildEvent),
    "END:VCALENDAR",
  ].join("\r\n");
}
