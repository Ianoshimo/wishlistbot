import { useState } from "react";
import { api, describeError, type Item } from "../api";
import { ErrorBanner, Field, PrimaryButton } from "./UI";
import { MAX_CONTRIBUTORS_CAP } from "./AddItemForm";

// Редактирование позиции (CLAUDE.md, 2026-10-01) - раньше опечатку в
// цене/ссылке можно было только удалить и добавить заново. Только эти три
// поля - не трогаем selfPurchased/СБП, это отдельный флоу (AddItemForm).

function validationError(url: string, price: string): string | null {
  if (!/^https?:\/\/.+/i.test(url)) return "Ссылка должна начинаться с http:// или https://";
  if (price && Number(price) <= 0) return "Цена должна быть больше нуля";
  return null;
}

export function EditItemForm({ item, onSaved }: { item: Item; onSaved: (item: Item) => void }) {
  const [url, setUrl] = useState(item.url);
  const [title, setTitle] = useState(item.title ?? "");
  const [price, setPrice] = useState(item.price ? String(item.price / 100) : "");
  // ТЗ блок 4, п.3: число участников складчины и ссылка на сбор
  // редактируются. 1 - без складчины.
  const [maxContributors, setMaxContributors] = useState(String(item.maxContributors));
  const [fundraiserUrl, setFundraiserUrl] = useState(item.fundraiserUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const invalid = validationError(url, price);
    if (invalid) {
      setError(invalid);
      return;
    }
    const n = Number(maxContributors);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CONTRIBUTORS_CAP) {
      setError(`Сколько человек может скинуться - от 1 до ${MAX_CONTRIBUTORS_CAP} (1 - без складчины)`);
      return;
    }
    const fund = fundraiserUrl.trim();
    if (fund && !/^https?:\/\/.+/i.test(fund)) {
      setError("Ссылка на сбор должна начинаться с http:// или https://");
      return;
    }
    if (n > 1 && !item.selfPurchased && !fund) {
      setError("Чтобы скинуться, вставьте ссылку на сбор из приложения банка");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateItem(item.id, {
        url,
        title: title.trim() || undefined,
        price: price ? Math.round(Number(price) * 100) : null,
        ...(n !== item.maxContributors ? { maxContributors: n } : {}),
        ...(fund !== (item.fundraiserUrl ?? "") ? { fundraiserUrl: fund || null } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div style={{ padding: "4px 20px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <ErrorBanner message={error} />}
        <Field label="Ссылка на товар" value={url} onChange={setUrl} placeholder="https://ozon.ru/product/..." type="url" />
        <Field label="Название" value={title} onChange={setTitle} placeholder="Например: наушники Sony" />
        <Field label="Цена, ₽ (необязательно)" value={price} onChange={setPrice} placeholder="6990" type="number" min="0" />
        <Field
          label={`Сколько человек может скинуться (1-${MAX_CONTRIBUTORS_CAP}, 1 - без складчины)`}
          value={maxContributors}
          onChange={setMaxContributors}
          type="number"
          min="1"
        />
        {!item.selfPurchased && (Number(maxContributors) > 1 || fundraiserUrl) && (
          <Field label="Ссылка на сбор в банке" value={fundraiserUrl} onChange={setFundraiserUrl} placeholder="https://..." type="url" />
        )}
        {item.contributorsCount > 0 && item.maxContributors > 1 && (
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -10 }}>
            Уже участвуют {item.contributorsCount} - меньше мест поставить нельзя.
          </div>
        )}
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </PrimaryButton>
      </div>
    </>
  );
}
