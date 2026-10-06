import { useState } from "react";
import { api, describeError, type Item } from "../api";
import { ErrorBanner, Field, PrimaryButton } from "./UI";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const invalid = validationError(url, price);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateItem(item.id, {
        url,
        title: title.trim() || undefined,
        price: price ? Math.round(Number(price) * 100) : null,
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
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </PrimaryButton>
      </div>
    </>
  );
}
