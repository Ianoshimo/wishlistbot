import { uiError, type Me, type PayoutMethod, type UiError } from "../api";
import { Field } from "./UI";
import { parseFundraiserLink } from "../linkInput";
import { normalizePhone } from "../phone";

// Аудит 2026-10-08, А-5 (решение владельца): способ получить деньги
// выбирается на КАЖДЫЙ подарок сегментами "В магазине" / "СБП" / "Сбор" и
// не связан с "уже купил сам". Реквизиты подставляются из профиля
// (GET /api/me), на подарке их можно изменить; последние введённые бэкенд
// запоминает в профиле для следующих подарков. Те же правила проверяет
// бэкенд (services/itemEdit.ts) - здесь, чтобы сразу показать ошибку.

export type PayoutChoice = "none" | PayoutMethod;

export function toChoice(m: PayoutMethod | null): PayoutChoice {
  return m ?? "none";
}

export function toMethod(c: PayoutChoice): PayoutMethod | null {
  return c === "none" ? null : c;
}

// Подсказки для поля "Банк" - свободный ввод остаётся (банков больше).
const BANKS = [
  "Т-Банк",
  "Сбербанк",
  "Альфа-Банк",
  "ВТБ",
  "Газпромбанк",
  "Озон Банк",
  "Яндекс Банк",
  "Райффайзенбанк",
  "Совкомбанк",
  "Почта Банк",
  "МТС Банк",
  "Россельхозбанк",
];

const OPTIONS: { value: PayoutChoice; label: string }[] = [
  { value: "none", label: "В магазине" },
  { value: "sbp", label: "СБП" },
  { value: "fundraiser", label: "Сбор" },
];

export function PayoutSegment({
  value,
  onChange,
  disabled,
}: {
  value: PayoutChoice;
  onChange: (v: PayoutChoice) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Как подарить</span>
      <div
        role="radiogroup"
        aria-label="Как подарить"
        style={{
          display: "flex",
          padding: 4,
          gap: 4,
          borderRadius: 14,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {OPTIONS.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                if (!active) onChange(o.value);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                height: 44, // А-27: не ниже 44 px
                borderRadius: 10,
                border: "none",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--on-accent)" : "var(--text-secondary)",
                fontSize: 14,
                fontWeight: 600,
                cursor: disabled ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
        {value === "none"
          ? "Друг забронирует подарок и купит его сам в магазине."
          : value === "sbp"
            ? "Друг переведёт деньги на ваш номер по СБП - номер и банк увидит только тот, кто забронировал."
            : "Друг переведёт деньги в ваш сбор в приложении банка - ссылку увидят только участники."}
      </span>
    </div>
  );
}

export interface PayoutValues {
  choice: PayoutChoice;
  phone: string;
  bank: string;
  fundraiserUrl: string;
}

export function PayoutDetails({
  values,
  set,
  savedProfile,
  disabled,
}: {
  values: PayoutValues;
  set: (patch: Partial<PayoutValues>) => void;
  // Реквизиты по умолчанию - подсказать, что новые заменят их для
  // следующих подарков.
  savedProfile: Me | null;
  disabled?: boolean;
}) {
  if (disabled) return null;
  if (values.choice === "sbp") {
    const changed =
      savedProfile &&
      ((savedProfile.sbpPhone && values.phone.trim() !== savedProfile.sbpPhone) ||
        (savedProfile.sbpBank && values.bank.trim() !== savedProfile.sbpBank));
    return (
      <>
        <Field label="Номер телефона для перевода по СБП" value={values.phone} onChange={(phone) => set({ phone })} placeholder="+7 900 123-45-67" type="tel" />
        <Field label="Банк получателя" value={values.bank} onChange={(bank) => set({ bank })} placeholder="Например: Т-Банк" list="payout-banks" maxLength={40} />
        <datalist id="payout-banks">
          {BANKS.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -10 }}>
          {changed
            ? "Эти реквизиты подставим и в следующие подарки. Уже добавленные подарки не изменятся."
            : "Запомним номер и банк - в следующий раз подставим сами."}
        </div>
      </>
    );
  }
  if (values.choice === "fundraiser") {
    return (
      <>
        <Field
          label="Ссылка на сбор в банке"
          value={values.fundraiserUrl}
          onChange={(fundraiserUrl) => set({ fundraiserUrl })}
          placeholder="Ссылка из приложения банка"
          type="url"
        />
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -10 }}>
          Создайте сбор в приложении своего банка (обычно «Платежи» или «Накопления» → «Сбор денег»), скопируйте ссылку и вставьте сюда. Ссылку увидят только те, кто присоединится.
        </div>
      </>
    );
  }
  return null;
}

// Клиентская проверка реквизитов. requireBank - банк обязателен, когда
// способ СБП выбирается заново (у старых подарков до А-5 банка нет).
// Аудит 2026-10-08, А-18: номер проверяется и нормализуется по тому же
// правилу, что на бэкенде (src/phone.ts) - в phone уходит +7XXXXXXXXXX.
export function validatePayout(
  v: PayoutValues,
  requireBank: boolean,
): { error: UiError } | { error: null; fundraiserUrl: string; phone: string } {
  let phone = "";
  if (v.choice === "sbp") {
    if (!v.phone.trim()) {
      return { error: uiError("invalid_phone", "Укажите номер телефона для перевода по СБП") };
    }
    const normalized = normalizePhone(v.phone);
    if (!normalized) {
      return {
        error: uiError("invalid_phone", "Проверьте номер: нужен российский номер из 10-11 цифр, например +7 900 123-45-67"),
      };
    }
    phone = normalized;
    if (requireBank && !v.bank.trim()) {
      return { error: uiError("sbp_bank_required", "Укажите банк - дарителю нужно выбрать его в переводе по СБП") };
    }
  }
  if (v.choice === "fundraiser") {
    if (!v.fundraiserUrl.trim()) {
      return {
        error: uiError("fundraiser_url_required", "Вставьте ссылку на сбор из приложения банка - по ней друзья будут переводить деньги"),
      };
    }
    const f = parseFundraiserLink(v.fundraiserUrl);
    if (f.error) return { error: f.error };
    return { error: null, fundraiserUrl: f.url, phone };
  }
  return { error: null, fundraiserUrl: "", phone };
}
