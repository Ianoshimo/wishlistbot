import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, describeError } from "../api";
import { ErrorBanner, Header, PrimaryButton, Screen } from "../components/UI";

// Беклог В-12: раньше поля никак не проверялись на клиенте - невалидный
// URL и отрицательная/нулевая цена уходили прямо на бэкенд и там тихо
// падали (см. Б-4). Проверяем здесь же, до сетевого запроса.
function validationError(url: string, price: string): string | null {
  if (!/^https?:\/\/.+/i.test(url)) return "Ссылка должна начинаться с http:// или https://";
  if (price && Number(price) <= 0) return "Цена должна быть больше нуля";
  return null;
}

export function AddItem() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
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
      await api.addItem(slug, {
        url,
        title: title || undefined,
        price: price ? Math.round(Number(price) * 100) : undefined,
      });
      navigate("/");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title="Новая позиция" backTo="/" />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20, flexGrow: 1 }}>
        {error && <ErrorBanner message={error} />}
        <Field label="Ссылка на товар" value={url} onChange={setUrl} placeholder="https://ozon.ru/product/..." type="url" />
        <Field label="Название (необязательно)" value={title} onChange={setTitle} placeholder="Например: наушники Sony" />
        <Field label="Цена, ₽ (необязательно)" value={price} onChange={setPrice} placeholder="6990" type="number" min="0" />
      </div>
      <div style={{ padding: "12px 16px 20px" }}>
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Добавляем…" : "Добавить в вишлист"}
        </PrimaryButton>
      </div>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 48,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text-primary)",
          padding: "0 14px",
          fontSize: 16,
        }}
      />
    </label>
  );
}
