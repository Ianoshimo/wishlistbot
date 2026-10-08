import { useEffect, useState } from "react";
import { api, apiError, uiError, type Item, type Me, type UiError } from "../api";
import { ErrorBanner, Field, PrimaryButton, ToggleRow } from "./UI";
import { parseProductLink } from "../linkInput";
import { PayoutDetails, PayoutSegment, toMethod, validatePayout, type PayoutValues } from "./PayoutFields";

// Форма "Добавить позицию" - содержимое bottom sheet на MyWishlist
// (CLAUDE.md, 2026-10-01). Аудит 2026-10-08, А-5: способ получить деньги
// (В магазине / СБП / Сбор) выбирается на каждый подарок и не зависит от
// "уже купил сам" - см. components/PayoutFields.tsx.

// ТЗ блок 4: складчина до 100 участников.
export const MAX_CONTRIBUTORS_CAP = 100;
// Аудит 2026-10-08, А-17: потолок цены, как на бэкенде (20 млн ₽).
export const MAX_PRICE_RUB = 20_000_000;
export const PRICE_TOO_LARGE_TEXT = "Цена слишком большая — максимум 20 000 000 ₽";
// Аудит 2026-10-08, А-37: как ITEM_TITLE_MAX на бэкенде.
export const ITEM_TITLE_MAX = 120;
// Подсказка про деньги появляется для подарков от этой цены (в рублях).
const MONEY_HINT_RUB = 5000;

export function AddItemForm({ slug, onAdded }: { slug: string; onAdded: (item: Item) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [selfPurchased, setSelfPurchased] = useState(false);
  const [payout, setPayout] = useState<PayoutValues>({ choice: "none", phone: "", bank: "", fundraiserUrl: "" });
  const [profile, setProfile] = useState<Me | null>(null);
  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - только при денежном способе.
  const [split, setSplit] = useState(false);
  const [maxContributors, setMaxContributors] = useState("2");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const patchPayout = (patch: Partial<PayoutValues>) => setPayout((p) => ({ ...p, ...patch }));

  // Реквизиты по умолчанию из профиля - не просим вводить заново.
  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        setProfile(me);
        setPayout((p) => ({
          ...p,
          phone: p.phone || me.sbpPhone || "",
          bank: p.bank || me.sbpBank || "",
          fundraiserUrl: p.fundraiserUrl || me.fundraiserUrl || "",
        }));
      })
      .catch(() => {
        // Нет настоящего Telegram-входа - поля остаются пустыми для ручного ввода.
      });
  }, []);

  const money = payout.choice !== "none";

  const submit = async () => {
    // Аудит 2026-10-08, А-10/А-6: ссылка вырезается из текста "Поделиться",
    // номер телефона распознаётся, тексты ошибок - без http://.
    const product = parseProductLink(url);
    if (product.error) return setError(product.error);
    if (price && Number(price) <= 0) return setError(uiError("invalid_price", "Цена должна быть больше нуля"));
    if (price && Number(price) > MAX_PRICE_RUB) return setError(uiError("price_too_large", PRICE_TOO_LARGE_TEXT));
    if (selfPurchased && !money) {
      return setError(uiError("self_purchased_needs_payout", "Подарок уже куплен — выберите, как друзьям перевести деньги: СБП или сбор"));
    }
    const n = Number(maxContributors);
    if (split && (!Number.isInteger(n) || n < 2 || n > MAX_CONTRIBUTORS_CAP)) {
      return setError(uiError("invalid_contributors", `Сколько человек может скинуться — от 2 до ${MAX_CONTRIBUTORS_CAP}`));
    }
    const checked = validatePayout(payout, true);
    if (checked.error) return setError(checked.error);

    // Показываем, что именно сохранится (ссылка без окружающего текста).
    setUrl(product.url);
    if (checked.fundraiserUrl) patchPayout({ fundraiserUrl: checked.fundraiserUrl });
    if (checked.phone) patchPayout({ phone: checked.phone });
    setSaving(true);
    setError(null);
    try {
      const item = await api.addItem(slug, {
        url: product.url,
        title: title.trim() || undefined,
        price: price ? Math.round(Number(price) * 100) : undefined,
        selfPurchased: selfPurchased || undefined,
        maxContributors: split && money ? n : undefined,
        payoutMethod: toMethod(payout.choice),
        ...(payout.choice === "sbp" ? { sbpPhone: checked.phone, sbpBank: payout.bank.trim() } : {}),
        ...(payout.choice === "fundraiser" ? { fundraiserUrl: checked.fundraiserUrl } : {}),
      });
      onAdded(item);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Аудит 2026-10-08, А-4: ошибка проверки снимается при любом
          изменении формы (ввод в поле, переключатель). Сегменты - кнопки,
          у них нет change-события, поэтому сброс - и по клику. */}
      <div
        onChangeCapture={() => setError(null)}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("[role=radio]")) setError(null);
        }}
        style={{ padding: "4px 20px 20px", display: "flex", flexDirection: "column", gap: 20 }}
      >
        <Field label="Ссылка на товар" value={url} onChange={setUrl} placeholder="Ссылка или текст из «Поделиться»" type="url" />
        <Field label="Название (необязательно)" value={title} onChange={setTitle} placeholder="Например: наушники Sony" maxLength={ITEM_TITLE_MAX} />
        <Field label="Цена, ₽ (необязательно)" value={price} onChange={setPrice} placeholder="6990" type="number" min="0" />

        <ToggleRow
          checked={selfPurchased}
          onChange={(v) => {
            setSelfPurchased(v);
            // Уже куплено - в магазин идти незачем: сразу предлагаем СБП.
            if (v && payout.choice === "none") patchPayout({ choice: "sbp" });
          }}
          title="Этот подарок уже у меня"
          hint="Друзья увидят, что в магазин идти не нужно, и переведут деньги выбранным способом"
        />

        <PayoutSegment
          value={payout.choice}
          onChange={(choice) => {
            patchPayout({ choice });
            if (choice === "none") setSplit(false);
          }}
        />
        <PayoutDetails values={payout} set={patchPayout} savedProfile={profile} />

        {!money && Number(price) >= MONEY_HINT_RUB && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "10px 12px", borderRadius: 12, background: "var(--accent-soft)" }}>
            Дорогой подарок? Выберите «СБП» или «Сбор» и включите «Можно скинуться нескольким» — друзья скинутся вместе.
          </div>
        )}

        {money && (
          <ToggleRow
            checked={split}
            onChange={setSplit}
            title="Можно скинуться нескольким"
            hint={
              payout.choice === "sbp"
                ? "Каждый переведёт свою часть по вашему номеру и отметит перевод отдельно"
                : "Каждый скинется через ваш сбор в банке и отметит своё участие"
            }
          />
        )}

        {split && money && (
          <Field
            label={`Сколько человек может скинуться (2–${MAX_CONTRIBUTORS_CAP})`}
            value={maxContributors}
            onChange={setMaxContributors}
            type="number"
            min="2"
          />
        )}
      </div>
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* QB4-2: ошибка - рядом с кнопкой, а не вверху длинной прокрученной
            шторки, где её не видно на 390px. */}
        {error && <ErrorBanner {...error} screen="add_item" revealParent />}
        {saving && (
          // QA-5: подгрузка фото/названия (особенно Wildberries через
          // Apify) может идти до ~30 с - без пояснения кажется зависанием.
          <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", marginBottom: 8 }}>
            Подтягиваем фото и название из магазина — это может занять до 30 секунд
          </div>
        )}
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Добавляем…" : "Добавить в вишлист"}
        </PrimaryButton>
      </div>
    </>
  );
}
