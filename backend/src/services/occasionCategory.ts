// Аудит 2026-10-08, А-15: в аналитику (Event.props occasion_set) раньше
// писался свободный текст повода - "ДР Маши Ивановой", т.е. имена третьих
// лиц, вопреки правилу "без имён" (services/analytics.ts). Теперь пишется
// только категория повода из короткого закрытого списка. Сам текст повода
// остаётся в Wishlist.occasionTitle (он нужен для календаря и экрана), но
// в аналитику не попадает.
//
// Та же классификация - в миграции 20261008090000_occasion_event_no_title
// (SQL-версия для уже записанных событий). Меняя список - поменяйте и там.

export type OccasionCategory =
  | "birthday"
  | "wedding"
  | "new_year"
  | "march_8"
  | "feb_23"
  | "anniversary"
  | "baby"
  | "other";

const RULES: [OccasionCategory, RegExp][] = [
  ["new_year", /нов(ый|ым|ого)\s*год|новогод|new\s*year|(?:^|[^а-яё\w])нг(?:$|[^а-яё\w])/i],
  ["march_8", /8\s*март|восьм\S*\s*март|женск\S*\s*д[её]н/i],
  ["feb_23", /23\s*феврал|защитник/i],
  ["wedding", /свадьб|свадеб|бракосочет|венчан|wedding/i],
  ["anniversary", /годовщин|anniversary/i],
  // \b в JS не работает с кириллицей - границы слова явными классами.
  ["birthday", /д(ень|ня)\s*рожд|днюх|юбиле|(?:^|[^а-яё\w])д\.?\s?р(?:$|[^а-яё\w])|birthday|\bbday\b/i],
  // После дня рождения: "день рождения сына" - это день рождения.
  ["baby", /рождени[ея]\s*(ребён|ребен|малыш|сын|доч)|выписк|крестин|baby\s*shower/i],
];

export function occasionCategory(title: string): OccasionCategory {
  for (const [category, re] of RULES) if (re.test(title)) return category;
  return "other";
}
