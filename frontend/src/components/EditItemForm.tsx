import { useEffect, useState } from "react";
import { api, apiError, uiError, type Item, type Me, type UiError } from "../api";
import { ErrorBanner, Field, PrimaryButton, ToggleRow } from "./UI";
import { MAX_CONTRIBUTORS_CAP } from "./AddItemForm";
import { extractUrl, parseProductLink } from "../linkInput";
import { PayoutDetails, PayoutSegment, toChoice, toMethod, validatePayout, type PayoutValues } from "./PayoutFields";

// Редактирование позиции (CLAUDE.md, 2026-10-01; с 2026-10-07 - все поля,
// ТЗ `Продукт/тз-редактирование-всех-полей.md`): всё, что задаётся при
// создании (AddItemForm), плюс приоритет и "Обновить фото по ссылке".
// Способ подарить (СБП / сбор / магазин, "уже купил сам", складчина -
// аудит 2026-10-08, А-5) меняется, только пока никто не присоединился;
// реквизиты (номер, банк, ссылку) исправлять можно; у купленной - только
// косметика. Те же правила проверяет бэкенд (services/itemEdit.ts), здесь -
// чтобы сразу показать, что заблокировано и почему, а не ловить 409.

const note = { fontSize: 12.5, color: "var(--text-secondary)" } as const;

export function EditItemForm({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  const [url, setUrl] = useState(item.url);
  const [title, setTitle] = useState(item.title ?? "");
  const [price, setPrice] = useState(item.price ? String(item.price / 100) : "");
  const [priority, setPriority] = useState(item.priority);
  const [selfPurchased, setSelfPurchased] = useState(item.selfPurchased);
  // Реквизиты этого подарка (владельцу бэкенд их отдаёт); пустые -
  // подставляются из профиля при выборе способа.
  const initial: PayoutValues = {
    choice: toChoice(item.payoutMethod),
    phone: item.sbpPhone ?? "",
    bank: item.sbpBank ?? "",
    fundraiserUrl: item.fundraiserUrl ?? "",
  };
  const [payout, setPayout] = useState<PayoutValues>(initial);
  const [profile, setProfile] = useState<Me | null>(null);
  const [split, setSplit] = useState(item.maxContributors > 1);
  const [maxContributors, setMaxContributors] = useState(String(item.maxContributors > 1 ? item.maxContributors : 2));
  const [refreshPreview, setRefreshPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const patchPayout = (patch: Partial<PayoutValues>) => setPayout((p) => ({ ...p, ...patch }));

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
        // dev-режим без Telegram - поля остаются для ручного ввода.
      });
  }, []);

  const bought = item.status === "bought";
  // Кто-то уже присоединился: classic-бронь или хотя бы одна доля.
  const hasGivers = item.maxContributors > 1 ? item.contributorsCount > 0 : item.status !== "available";
  const modeLocked = bought || hasGivers;
  const money = payout.choice !== "none";
  const methodChanged = toMethod(payout.choice) !== item.payoutMethod;
  // Сравниваем уже извлечённую ссылку: вставка "Смотри https://<та же>"
  // - не изменение ссылки.
  const urlChanged = (extractUrl(url) ?? url.trim()) !== item.url;

  const submit = async () => {
    // Аудит 2026-10-08, А-10/А-6: ссылка вырезается из текста
    // "Поделиться", номер телефона распознаётся, без http:// в текстах.
    const product = parseProductLink(url);
    if (product.error) return setError(product.error);
    const nextUrl = product.url;
    if (price && Number(price) <= 0) return setError(uiError("invalid_price", "Цена должна быть больше нуля"));
    if (selfPurchased && !money) {
      return setError(uiError("self_purchased_needs_payout", "Подарок уже куплен - выберите, как друзьям перевести деньги: СБП или сбор"));
    }
    const n = split && money ? Number(maxContributors) : 1;
    if (split && money && (!Number.isInteger(n) || n < 2 || n > MAX_CONTRIBUTORS_CAP)) {
      return setError(uiError("invalid_contributors", `Сколько человек может скинуться - от 2 до ${MAX_CONTRIBUTORS_CAP}`));
    }
    if (item.maxContributors > 1 && n > 1 && n < item.contributorsCount) {
      return setError(uiError("contributors_below_joined", `Уже участвуют ${item.contributorsCount} - меньше мест поставить нельзя`));
    }
    // У купленного реквизиты не правятся - не проверяем их.
    let fund = "";
    if (!bought) {
      // Банк обязателен, когда СБП выбирают заново (у старых подарков его нет).
      const checked = validatePayout(payout, methodChanged);
      if (checked.error) return setError(checked.error);
      fund = checked.fundraiserUrl;
    }

    // Шлём только изменённое - бэкенд и так сравнивает с текущим, но
    // меньше шансов упереться в блокировку на ровном месте.
    const nextPrice = price ? Math.round(Number(price) * 100) : null;
    const nextTitle = title.trim();
    const phone = payout.phone.trim();
    const bank = payout.bank.trim();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateItem(item.id, {
        ...(urlChanged ? { url: nextUrl } : {}),
        ...(nextTitle && nextTitle !== item.title ? { title: nextTitle } : {}),
        ...(nextPrice !== item.price ? { price: nextPrice } : {}),
        ...(priority !== item.priority ? { priority } : {}),
        ...(selfPurchased !== item.selfPurchased ? { selfPurchased } : {}),
        ...(methodChanged ? { payoutMethod: toMethod(payout.choice) } : {}),
        ...(!bought && payout.choice === "sbp" && phone !== (item.sbpPhone ?? "") ? { sbpPhone: phone } : {}),
        ...(!bought && payout.choice === "sbp" && bank && bank !== (item.sbpBank ?? "") ? { sbpBank: bank } : {}),
        ...(!bought && payout.choice === "fundraiser" && fund !== (item.fundraiserUrl ?? "") ? { fundraiserUrl: fund } : {}),
        ...(n !== item.maxContributors ? { maxContributors: n } : {}),
        ...(urlChanged && refreshPreview ? { refreshPreview: true } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Аудит 2026-10-08, А-4: ошибка снимается при любом изменении формы. */}
      <div
        onChangeCapture={() => setError(null)}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("[role=radio]")) setError(null);
        }}
        style={{ padding: "4px 20px 20px", display: "flex", flexDirection: "column", gap: 20 }}
      >
        <Field label="Ссылка на товар" value={url} onChange={setUrl} placeholder="Ссылка или текст из «Поделиться»" type="url" />
        {urlChanged && (
          <ToggleRow
            checked={refreshPreview}
            onChange={setRefreshPreview}
            title="Обновить фото по новой ссылке"
            hint="Подтянем фото из магазина, как при добавлении. Название тоже обновится, если вы его не меняли."
          />
        )}
        <Field label="Название" value={title} onChange={setTitle} placeholder="Например: наушники Sony" />
        <Field label="Цена, ₽ (необязательно)" value={price} onChange={setPrice} placeholder="6990" type="number" min="0" />

        <ToggleRow
          checked={priority}
          onChange={setPriority}
          title="Хочу больше всего"
          hint="Позиция будет наверху списка со звёздочкой - друзья увидят её первой"
        />

        {modeLocked && (
          <div style={{ ...note, padding: "10px 12px", borderRadius: 12, background: "var(--accent-soft)" }}>
            {bought
              ? "Подарок уже куплен - менять можно только ссылку, название, цену, фото и приоритет."
              : item.maxContributors > 1
                ? "Уже есть участники - способ подарить и складчину не меняем, чтобы не подвести дарителей. Реквизиты и число мест исправить можно."
                : "Подарок уже забронирован - способ подарить не меняем, чтобы не подвести дарителя. Реквизиты исправить можно - даритель увидит новые."}
          </div>
        )}

        <ToggleRow
          checked={selfPurchased}
          onChange={(v) => {
            setSelfPurchased(v);
            if (v && payout.choice === "none") patchPayout({ choice: "sbp" });
          }}
          disabled={modeLocked}
          title="Я уже купил этот подарок"
          hint="Друзья увидят, что в магазин идти не нужно, и переведут деньги выбранным способом"
        />

        <PayoutSegment
          value={payout.choice}
          disabled={modeLocked}
          onChange={(choice) => {
            patchPayout({ choice });
            if (choice === "none") setSplit(false);
          }}
        />
        <PayoutDetails values={payout} set={patchPayout} savedProfile={profile} disabled={bought} />
        {payout.choice === "sbp" && !bought && !payout.bank.trim() && !methodChanged && (
          <div style={{ ...note, marginTop: -10 }}>Банк не указан - дарители увидят «уточните у получателя». Лучше указать.</div>
        )}

        {money && (
          <ToggleRow
            checked={split}
            onChange={setSplit}
            disabled={modeLocked}
            title="Можно скинуться нескольким"
            hint={
              payout.choice === "sbp"
                ? "Каждый переведёт свою часть по вашему номеру и отметит перевод отдельно"
                : "Каждый скинется через ваш сбор в банке и отметит своё участие"
            }
          />
        )}

        {split && money && !bought && (
          <>
            <Field
              label={`Сколько человек может скинуться (2-${MAX_CONTRIBUTORS_CAP})`}
              value={maxContributors}
              onChange={setMaxContributors}
              type="number"
              min="2"
            />
            {item.maxContributors > 1 && item.contributorsCount > 0 && (
              <div style={{ ...note, marginTop: -10 }}>
                Уже участвуют {item.contributorsCount} - меньше мест поставить нельзя.
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* QB4-2: ошибка - рядом с кнопкой, а не вверху шторки. */}
        {error && <ErrorBanner {...error} screen="edit_item" revealParent />}
        {saving && urlChanged && refreshPreview && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center" }}>
            Подтягиваем фото из магазина - это может занять до 30 секунд
          </div>
        )}
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </PrimaryButton>
      </div>
    </>
  );
}
