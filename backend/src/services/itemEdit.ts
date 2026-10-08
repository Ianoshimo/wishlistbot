// Правила "как подарить" для создания и редактирования подарка (ТЗ
// `Продукт/тз-редактирование-всех-полей.md`, с аудита 2026-10-08 -
// `Продукт/тз-аудит-p1-решения-владельца.md`, п.1, А-5).
//
// Чистая функция без БД - правила в одном месте, покрыты юнит-тестами.
// Роуты (POST /api/wishlists/:slug/items и PATCH /api/items/:itemId) только
// читают текущее состояние (после снятия просроченных броней/долей) и
// применяют план. Создание - это правка "пустого" подарка (EMPTY_ITEM).
//
// А-5: способ получить деньги (payoutMethod: СБП / сбор / нет) выбирается
// на каждый подарок отдельно и больше не связан с "уже купил сам" - та
// галочка теперь только информация "идти в магазин не нужно". Реквизиты
// (номер + банк, ссылка на сбор) хранятся на подарке; по умолчанию берутся
// из профиля владельца, последние введённые запоминаются в профиле.
//
// Принцип правки: нельзя молча сломать обязательство уже присоединившегося
// дарителя - он бронировал под конкретный способ подарить и мог уже
// купить или перевести деньги, не отметив это. Поэтому способ подарить
// меняется только пока участников нет; реквизиты (опечатка в номере,
// новая ссылка на сбор) исправлять можно; у купленного - только косметика.

export type PayoutMethod = "sbp" | "fundraiser";

export interface PayoutProfile {
  sbpPhone: string | null;
  sbpBank: string | null;
  fundraiserUrl: string | null;
}

export interface EditCurrent {
  status: "available" | "reserved" | "bought";
  selfPurchased: boolean;
  maxContributors: number;
  reservedByUserId: string | null;
  // Живые доли складчины (после снятия просроченных); 0 для classic.
  joined: number;
  payoutMethod: PayoutMethod | null;
  sbpPhone: string | null;
  sbpBank: string | null;
  fundraiserUrl: string | null;
}

export interface EditRequest {
  selfPurchased?: boolean;
  maxContributors?: number;
  // null - без денег (даритель покупает в магазине).
  payoutMethod?: PayoutMethod | null;
  sbpPhone?: string;
  sbpBank?: string;
  fundraiserUrl?: string;
}

export type EditError =
  | "item_already_bought"
  | "item_has_givers"
  | "split_item_already_reserved"
  | "contributors_below_joined"
  | "split_needs_payout"
  | "self_purchased_needs_payout"
  | "sbp_phone_required"
  | "sbp_bank_required"
  | "fundraiser_url_required";

export type EditPlan =
  | { ok: false; code: 400 | 409; error: EditError; joined?: number }
  | {
      ok: true;
      selfPurchased: boolean;
      maxContributors: number;
      payoutMethod: PayoutMethod | null;
      sbpPhone: string | null;
      sbpBank: string | null;
      fundraiserUrl: string | null;
      selfChanged: boolean;
      maxChanged: boolean;
      methodChanged: boolean;
      // Номер, банк или ссылка на сбор на подарке стали другими.
      detailsChanged: boolean;
      // Что запомнить в профиле владельца как реквизиты по умолчанию
      // (только присланное и отличное от профиля).
      profileUpdate: Partial<PayoutProfile>;
    };

// Новый подарок: создание = правка пустого подарка.
export const EMPTY_ITEM: EditCurrent = {
  status: "available",
  selfPurchased: false,
  maxContributors: 1,
  reservedByUserId: null,
  joined: 0,
  payoutMethod: null,
  sbpPhone: null,
  sbpBank: null,
  fundraiserUrl: null,
};

export function hasGivers(cur: EditCurrent): boolean {
  if (cur.maxContributors > 1) return cur.joined > 0;
  return Boolean(cur.reservedByUserId) || cur.status === "reserved";
}

function clean(v: string | undefined | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function planItemEdit(cur: EditCurrent, req: EditRequest, profile: PayoutProfile): EditPlan {
  const nextSelf = req.selfPurchased ?? cur.selfPurchased;
  const nextMax = req.maxContributors ?? cur.maxContributors;
  const nextMethod = req.payoutMethod !== undefined ? req.payoutMethod : cur.payoutMethod;
  const methodChanged = nextMethod !== cur.payoutMethod;

  // Реквизиты: присланное > то, что уже на подарке (если способ тот же) >
  // профиль. Реквизиты другого способа на подарке очищаются.
  const keepSbp = cur.payoutMethod === "sbp";
  const keepFund = cur.payoutMethod === "fundraiser";
  const sbpPhone =
    nextMethod === "sbp" ? clean(req.sbpPhone) ?? (keepSbp ? cur.sbpPhone : null) ?? profile.sbpPhone : null;
  const sbpBank =
    nextMethod === "sbp" ? clean(req.sbpBank) ?? (keepSbp ? cur.sbpBank : null) ?? profile.sbpBank : null;
  const fundraiserUrl =
    nextMethod === "fundraiser"
      ? clean(req.fundraiserUrl) ?? (keepFund ? cur.fundraiserUrl : null) ?? profile.fundraiserUrl
      : null;

  const selfChanged = nextSelf !== cur.selfPurchased;
  const maxChanged = nextMax !== cur.maxContributors;
  const detailsChanged =
    sbpPhone !== (cur.sbpPhone ?? null) || sbpBank !== (cur.sbpBank ?? null) || fundraiserUrl !== (cur.fundraiserUrl ?? null);
  const givers = hasGivers(cur);

  // Куплено - сделка закрыта, денежные поля не меняются.
  if (cur.status === "bought" && (selfChanged || maxChanged || methodChanged || detailsChanged)) {
    return { ok: false, code: 409, error: "item_already_bought" };
  }
  // Даритель уже присоединился под этот способ подарить.
  if ((selfChanged || methodChanged) && givers) {
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
  // Складчине нужно, куда переводить.
  if (nextMax > 1 && !nextMethod) {
    return { ok: false, code: 400, error: "split_needs_payout" };
  }
  // "Уже купил сам" без денег - дарить нечего.
  if (nextSelf && !nextMethod) {
    return { ok: false, code: 400, error: "self_purchased_needs_payout" };
  }
  if (nextMethod === "sbp") {
    if (!sbpPhone) return { ok: false, code: 400, error: "sbp_phone_required" };
    // Банк обязателен при выборе СБП; у подарков до А-5 (миграция) его нет
    // - их не блокируем, пока способ не меняют.
    if (!sbpBank && methodChanged) return { ok: false, code: 400, error: "sbp_bank_required" };
  }
  if (nextMethod === "fundraiser" && !fundraiserUrl) {
    return { ok: false, code: 400, error: "fundraiser_url_required" };
  }

  const profileUpdate: Partial<PayoutProfile> = {};
  if (nextMethod === "sbp") {
    if (clean(req.sbpPhone) && clean(req.sbpPhone) !== profile.sbpPhone) profileUpdate.sbpPhone = clean(req.sbpPhone);
    if (clean(req.sbpBank) && clean(req.sbpBank) !== profile.sbpBank) profileUpdate.sbpBank = clean(req.sbpBank);
  }
  if (nextMethod === "fundraiser" && clean(req.fundraiserUrl) && clean(req.fundraiserUrl) !== profile.fundraiserUrl) {
    profileUpdate.fundraiserUrl = clean(req.fundraiserUrl);
  }

  return {
    ok: true,
    selfPurchased: nextSelf,
    maxContributors: nextMax,
    payoutMethod: nextMethod,
    sbpPhone,
    sbpBank,
    fundraiserUrl,
    selfChanged,
    maxChanged,
    methodChanged,
    detailsChanged,
    profileUpdate,
  };
}
