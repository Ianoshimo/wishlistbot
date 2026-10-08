import { useEffect, useState, type ReactNode } from "react";
import { api, apiError, uiError, type Item, type UiError } from "../api";
import { ErrorBanner, Field, PrimaryButton } from "./UI";
import { MAX_CONTRIBUTORS_CAP } from "./AddItemForm";
import { extractUrl, parseFundraiserLink, parseProductLink } from "../linkInput";

// Редактирование позиции (CLAUDE.md, 2026-10-01; с 2026-10-07 - все поля,
// ТЗ `Продукт/тз-редактирование-всех-полей.md`): всё, что задаётся при
// создании (AddItemForm), плюс приоритет и "Обновить фото по ссылке".
// Способ подарить ("уже купил сам", складчина, сбор) меняется, только пока
// никто не присоединился; у купленной - только косметика. Те же правила
// проверяет бэкенд (services/itemEdit.ts), здесь - чтобы сразу показать,
// что заблокировано и почему, а не ловить 409 после "Сохранить".

function ToggleRow({
  checked,
  onChange,
  disabled,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title: string;
  hint: ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: 14,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
      />
      <span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

const note = { fontSize: 12.5, color: "var(--text-secondary)" } as const;

export function EditItemForm({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  const [url, setUrl] = useState(item.url);
  const [title, setTitle] = useState(item.title ?? "");
  const [price, setPrice] = useState(item.price ? String(item.price / 100) : "");
  const [priority, setPriority] = useState(item.priority);
  const [selfPurchased, setSelfPurchased] = useState(item.selfPurchased);
  const [sbpPhone, setSbpPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [split, setSplit] = useState(item.maxContributors > 1);
  const [maxContributors, setMaxContributors] = useState(String(item.maxContributors > 1 ? item.maxContributors : 2));
  const [fundraiserUrl, setFundraiserUrl] = useState(item.fundraiserUrl ?? "");
  const [refreshPreview, setRefreshPreview] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  // Номер СБП - реквизит владельца, а не позиции: подставляем сохранённый.
  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        setSavedPhone(me.sbpPhone);
        if (me.sbpPhone) setSbpPhone(me.sbpPhone);
      })
      .catch(() => {
        // dev-режим без Telegram - поле остаётся пустым для ручного ввода.
      });
  }, []);

  const bought = item.status === "bought";
  // Кто-то уже присоединился: classic-бронь или хотя бы одна доля.
  const hasGivers = item.maxContributors > 1 ? item.contributorsCount > 0 : item.status !== "available";
  const modeLocked = bought || hasGivers;
  // Сравниваем уже извлечённую ссылку: вставка "Смотри https://<та же>"
  // - не изменение ссылки.
  const urlChanged = (extractUrl(url) ?? url.trim()) !== item.url;

  const submit = async () => {
    // Аудит 2026-10-08, А-10/А-6: ссылка вырезается из текста
    // "Поделиться", номер телефона распознаётся, без http:// в текстах.
    const product = parseProductLink(url);
    if (product.error) {
      setError(product.error);
      return;
    }
    const nextUrl = product.url;
    if (price && Number(price) <= 0) {
      setError(uiError("invalid_price", "Цена должна быть больше нуля"));
      return;
    }
    if (selfPurchased && sbpPhone.replace(/\D/g, "").length < 10) {
      setError(uiError("invalid_phone", "Укажите номер телефона для перевода"));
      return;
    }
    const n = split ? Number(maxContributors) : 1;
    if (split && (!Number.isInteger(n) || n < 2 || n > MAX_CONTRIBUTORS_CAP)) {
      setError(uiError("invalid_contributors", `Сколько человек может скинуться - от 2 до ${MAX_CONTRIBUTORS_CAP}`));
      return;
    }
    if (split && item.maxContributors > 1 && n < item.contributorsCount) {
      setError(uiError("contributors_below_joined", `Уже участвуют ${item.contributorsCount} - меньше мест поставить нельзя`));
      return;
    }
    // QB4-3: ссылка на сбор - только у складчины без "уже купил сам".
    let fund = split && !selfPurchased ? fundraiserUrl.trim() : "";
    if (fund) {
      const f = parseFundraiserLink(fund);
      if (f.error) {
        setError(f.error);
        return;
      }
      fund = f.url;
    }
    if (split && !selfPurchased && !fund) {
      setError(uiError("fundraiser_url_required", "Чтобы скинуться, вставьте ссылку на сбор из приложения банка"));
      return;
    }

    // Шлём только изменённое - бэкенд и так сравнивает с текущим, но
    // меньше шансов упереться в блокировку режима на ровном месте.
    const nextPrice = price ? Math.round(Number(price) * 100) : null;
    const nextTitle = title.trim();
    const phone = sbpPhone.trim();
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateItem(item.id, {
        ...(urlChanged ? { url: nextUrl } : {}),
        ...(nextTitle && nextTitle !== item.title ? { title: nextTitle } : {}),
        ...(nextPrice !== item.price ? { price: nextPrice } : {}),
        ...(priority !== item.priority ? { priority } : {}),
        ...(selfPurchased !== item.selfPurchased ? { selfPurchased } : {}),
        ...(selfPurchased && phone !== (savedPhone ?? "") ? { sbpPhone: phone } : {}),
        ...(n !== item.maxContributors ? { maxContributors: n } : {}),
        ...(fund !== (item.fundraiserUrl ?? "") ? { fundraiserUrl: fund || null } : {}),
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
                ? "Уже есть участники - способ подарить («уже купил сам», складчина) не меняется, чтобы не подвести дарителей. Ссылку на сбор и число мест менять можно."
                : "Подарок уже забронирован - способ подарить («уже купил сам», складчина) не меняется, чтобы не подвести дарителя."}
          </div>
        )}

        <ToggleRow
          checked={selfPurchased}
          onChange={setSelfPurchased}
          disabled={modeLocked}
          title="Уже купил(а) этот подарок сам(а)"
          hint="Друг увидит, что покупать не нужно, и просто переведёт вам деньги по номеру телефона"
        />

        {selfPurchased && (
          <>
            <Field
              label="Номер телефона для перевода по СБП"
              value={sbpPhone}
              onChange={setSbpPhone}
              placeholder="+7 900 123-45-67"
              type="tel"
            />
            {savedPhone && sbpPhone.trim() !== savedPhone && (
              <div style={{ ...note, marginTop: -10 }}>
                Новый номер заменит прежний во всех ваших подарках «уже купил сам».
              </div>
            )}
          </>
        )}

        <ToggleRow
          checked={split}
          onChange={(v) => {
            setSplit(v);
            // QB4-3: без складчины ссылка на сбор не нужна.
            if (!v) setFundraiserUrl("");
          }}
          disabled={modeLocked}
          title="Можно скинуться нескольким"
          hint={
            selfPurchased
              ? "Каждый переведёт свою часть по тому же номеру и отметит перевод отдельно"
              : "Друзья скинутся через сбор в вашем банке, каждый отметит своё участие"
          }
        />

        {/* У купленной режим не меняется - общей подсказки выше достаточно. */}
        {split && !selfPurchased && !bought && (
          <>
            <Field label="Ссылка на сбор в банке" value={fundraiserUrl} onChange={setFundraiserUrl} placeholder="Ссылка из приложения банка" type="url" />
            <div style={{ ...note, marginTop: -10 }}>
              Создайте сбор в приложении своего банка и вставьте ссылку на него. Ссылку увидят только те, кто присоединится.
            </div>
          </>
        )}

        {split && !bought && (
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
