// Редактирование всех полей позиции (ТЗ `Продукт/тз-редактирование-всех-
// полей.md`, решение владельца 2026-10-07 "редактировать можно всё").
//
// Чистая функция без БД - правила режима подарка (уже купил сам /
// складчина / ссылка на сбор) в одном месте, чтобы их можно было покрыть
// юнит-тестами. Роут PATCH /api/items/:itemId только читает текущее
// состояние (после снятия просроченных броней/долей) и применяет план.
//
// Принцип: нельзя молча сломать обязательство уже присоединившегося
// дарителя - он бронировал под конкретный способ подарить и мог уже
// купить в магазине или перевести деньги, не отметив это. Поэтому способ
// подарить меняется только пока участников нет; купленная позиция - только
// косметика (ссылка/название/цена/фото/приоритет).

export interface EditCurrent {
  status: "available" | "reserved" | "bought";
  selfPurchased: boolean;
  maxContributors: number;
  fundraiserUrl: string | null;
  reservedByUserId: string | null;
  // Живые доли складчины (после снятия просроченных); 0 для classic.
  joined: number;
}

export interface EditRequest {
  selfPurchased?: boolean;
  maxContributors?: number;
  // null - убрать ссылку.
  fundraiserUrl?: string | null;
  sbpPhone?: string;
}

export type EditError =
  | "item_already_bought"
  | "item_has_givers"
  | "split_item_already_reserved"
  | "contributors_below_joined"
  | "split_needs_payment_target"
  | "sbp_phone_required";

export type EditPlan =
  | { ok: false; code: 400 | 409; error: EditError; joined?: number }
  | {
      ok: true;
      selfPurchased: boolean;
      maxContributors: number;
      fundraiserUrl: string | null;
      selfChanged: boolean;
      maxChanged: boolean;
      fundraiserChanged: boolean;
      // Номер, который нужно сохранить владельцу (присланный и отличный от
      // сохранённого), иначе null.
      phoneToSave: string | null;
    };

export function hasGivers(cur: EditCurrent): boolean {
  if (cur.maxContributors > 1) return cur.joined > 0;
  return Boolean(cur.reservedByUserId) || cur.status === "reserved";
}

export function planItemEdit(cur: EditCurrent, req: EditRequest, ownerSbpPhone: string | null): EditPlan {
  const nextSelf = req.selfPurchased ?? cur.selfPurchased;
  const nextMax = req.maxContributors ?? cur.maxContributors;
  // QB4-3: ссылка на сбор - только у складчины без "уже купил сам"; в
  // остальных случаях молча очищается (как при создании).
  const nextFundraiser =
    nextMax > 1 && !nextSelf
      ? req.fundraiserUrl !== undefined
        ? req.fundraiserUrl
        : cur.fundraiserUrl
      : null;

  const selfChanged = nextSelf !== cur.selfPurchased;
  const maxChanged = nextMax !== cur.maxContributors;
  const fundraiserChanged = (nextFundraiser ?? null) !== (cur.fundraiserUrl ?? null);
  const givers = hasGivers(cur);

  // Куплено - сделка закрыта, режим не меняется (QB4-4, расширено на все
  // поля режима).
  if (cur.status === "bought" && (selfChanged || maxChanged || fundraiserChanged)) {
    return { ok: false, code: 409, error: "item_already_bought" };
  }
  // Даритель уже присоединился под этот способ подарить.
  if (selfChanged && givers) {
    return { ok: false, code: 409, error: "item_has_givers" };
  }
  if (maxChanged) {
    if (cur.maxContributors === 1 && nextMax > 1 && givers) {
      return { ok: false, code: 409, error: "split_item_already_reserved" };
    }
    if (nextMax === 1 && cur.joined > 0) {
      return { ok: false, code: 409, error: "contributors_below_joined", joined: cur.joined };
    }
    if (nextMax > 1 && nextMax < cur.joined) {
      return { ok: false, code: 409, error: "contributors_below_joined", joined: cur.joined };
    }
  }
  // Складчине нужно, куда переводить: номер СБП или ссылка на сбор.
  if (nextMax > 1 && !nextSelf && !nextFundraiser) {
    return { ok: false, code: 400, error: "split_needs_payment_target" };
  }

  let phoneToSave: string | null = null;
  if (nextSelf) {
    const phone = req.sbpPhone ?? ownerSbpPhone;
    if (!phone) return { ok: false, code: 400, error: "sbp_phone_required" };
    if (req.sbpPhone && req.sbpPhone !== ownerSbpPhone) phoneToSave = req.sbpPhone;
  }

  return {
    ok: true,
    selfPurchased: nextSelf,
    maxContributors: nextMax,
    fundraiserUrl: nextFundraiser,
    selfChanged,
    maxChanged,
    fundraiserChanged,
    phoneToSave,
  };
}
