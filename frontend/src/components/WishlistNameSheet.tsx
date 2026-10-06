import { useState } from "react";
import { describeError } from "../api";
import { ErrorBanner, Field, PrimaryButton } from "./UI";

const TITLE_MAX = 60;

// Создание/переименование вишлиста (CLAUDE.md, 2026-10-02, "сделай 3 и
// названия для них") - один маленький sheet на оба сценария: initialTitle
// пуст для нового списка, заполнен для переименования текущего.
export function WishlistNameSheet({
  initialTitle,
  submitLabel,
  onSubmit,
}: {
  initialTitle: string;
  submitLabel: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("Укажите название");
      return;
    }
    // QA-4: лимит бэкенда - 60 символов; говорим об этом прямо, а не общим
    // "Проверьте введённые данные".
    if (title.trim().length > TITLE_MAX) {
      setError(`Название - не длиннее ${TITLE_MAX} символов`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(title.trim());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {error && <ErrorBanner message={error} />}
      <Field label="Название" value={title} onChange={setTitle} placeholder="Например: Новый год" maxLength={TITLE_MAX} />
      <PrimaryButton onClick={submit} disabled={saving}>
        {saving ? "Сохраняем…" : submitLabel}
      </PrimaryButton>
    </div>
  );
}
