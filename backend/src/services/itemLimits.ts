// Аудит 2026-10-08, А-33: лимиты на добавление позиций. Каждая ссылка
// Wildberries без превью - платный вызов Apify (~$0.005), плюс исходящий
// запрос к магазину на любую ссылку - без лимитов скрипт мог раздуть счёт
// и нагрузку линейно. Лимиты щедрые для живого человека и ограничивают
// только автоматизацию:
// - не больше ITEMS_PER_WISHLIST позиций в одном вишлисте (409
//   item_limit_reached);
// - не больше ADDS_PER_MINUTE / ADDS_PER_DAY добавлений и "обновить фото
//   по ссылке" на пользователя (429 too_many_requests) - общий счётчик для
//   мини-аппа и бота.
// Счётчик частоты - в памяти процесса (на Railway один инстанс), рестарт
// его обнуляет - это приемлемо: дневной потолок всё равно ограничивает
// расход между рестартами. Потолок позиций - по БД, переживает рестарт.

export const ITEMS_PER_WISHLIST = 200;
export const ADDS_PER_MINUTE = 20;
export const ADDS_PER_DAY = 300;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class SlidingLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly perDay: number,
  ) {}

  // true - действие разрешено и засчитано; false - лимит исчерпан (не
  // засчитывается, чтобы повторы после ошибки не продлевали блокировку).
  take(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < DAY);
    const lastMinute = list.filter((t) => now - t < MINUTE).length;
    if (lastMinute >= this.perMinute || list.length >= this.perDay) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [k, list] of this.hits) {
      if (!list.some((t) => now - t < DAY)) this.hits.delete(k);
    }
  }
}

export const itemAddLimiter = new SlidingLimiter(ADDS_PER_MINUTE, ADDS_PER_DAY);

// Аудит 2026-10-08, А-37: потолок длины названия подарка. Вручную длиннее
// не сохранить (400 title_too_long), название из превью магазина (бывают
// простыни с характеристиками) - обрезается до этой длины с многоточием.
export const ITEM_TITLE_MAX = 120;

export function clampItemTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length <= ITEM_TITLE_MAX ? t : `${t.slice(0, ITEM_TITLE_MAX - 1).trimEnd()}…`;
}
