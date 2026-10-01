import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, describeError } from "../api";
import { ErrorBanner, Header, PrimaryButton, Screen } from "../components/UI";

// Беклог В-12: раньше поля никак не проверялись на клиенте - невалидный
// URL и отрицательная/нулевая цена уходили прямо на бэкенд и там тихо
// падали (см. Б-4). Проверяем здесь же, до сетевого запроса.
function validationError(url: string, price: string, selfPurchased: boolean, sbpPhone: string): string | null {
  if (!/^https?:\/\/.+/i.test(url)) return "Ссылка должна начинаться с http:// или https://";
  if (price && Number(price) <= 0) return "Цена должна быть больше нуля";
  if (selfPurchased && sbpPhone.replace(/\D/g, "").length < 10) return "Укажите номер телефона для перевода";
  return null;
}

export function AddItem() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  // "Уже купил(а) сам(а)" (решение 2026-10-02, по просьбе пользователя) -
  // даритель переводит деньги напрямую получателю по СБП вместо похода в
  // магазин, см. ItemDetail.tsx и backend/src/services/... (User.sbpPhone).
  const [selfPurchased, setSelfPurchased] = useState(false);
  const [sbpPhone, setSbpPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Номер - реквизит получателя, не отдельной позиции: подставляем уже
  // сохранённый с прошлого раза, чтобы не просить вводить заново.
  useEffect(() => {
    api
      .getMe()
      .then((me) => {
        if (me.sbpPhone) setSbpPhone(me.sbpPhone);
      })
      .catch(() => {
        // Нет настоящего Telegram-входа (dev-режим без заголовка) - просто
        // не подставляем номер, поле остаётся пустым для ручного ввода.
      });
  }, []);

  const submit = async () => {
    const invalid = validationError(url, price, selfPurchased, sbpPhone);
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
        selfPurchased: selfPurchased || undefined,
        sbpPhone: selfPurchased ? sbpPhone.trim() : undefined,
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

        <label
          style={{
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
            padding: 14,
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={selfPurchased}
            onChange={(e) => setSelfPurchased(e.target.checked)}
            style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
          />
          <span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
              Уже купил(а) этот подарок сам(а)
            </span>
            <span style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              Друг увидит, что покупать не нужно, и просто переведёт вам деньги по номеру телефона
            </span>
          </span>
        </label>

        {selfPurchased && (
          <Field
            label="Номер телефона для перевода по СБП"
            value={sbpPhone}
            onChange={setSbpPhone}
            placeholder="+7 900 123-45-67"
            type="tel"
          />
        )}
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
