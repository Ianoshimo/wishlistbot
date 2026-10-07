import { useEffect, useState } from "react";
import { api, describeError, type Item } from "../api";
import { ErrorBanner, Field, PrimaryButton } from "./UI";

// Форма "Добавить позицию" - раньше отдельная страница (/w/:slug/add),
// теперь содержимое bottom sheet на MyWishlist (CLAUDE.md, 2026-10-01:
// "Bottom sheet для 'Добавить позицию' ... вместо перехода на отдельную
// страницу - быстрее ощущается"). Логика валидации не изменилась.

// ТЗ блок 4: складчина до 100 участников.
export const MAX_CONTRIBUTORS_CAP = 100;
// Подсказка про сбор появляется для подарков от этой цены (в рублях).
const FUNDRAISER_HINT_RUB = 5000;

function validationError(
  url: string,
  price: string,
  selfPurchased: boolean,
  sbpPhone: string,
  split: boolean,
  maxContributors: string,
  fundraiserUrl: string,
): string | null {
  if (!/^https?:\/\/.+/i.test(url)) return "Ссылка должна начинаться с http:// или https://";
  if (price && Number(price) <= 0) return "Цена должна быть больше нуля";
  if (selfPurchased && sbpPhone.replace(/\D/g, "").length < 10) return "Укажите номер телефона для перевода";
  if (split) {
    const n = Number(maxContributors);
    if (!Number.isInteger(n) || n < 2 || n > MAX_CONTRIBUTORS_CAP) {
      return `Сколько человек может скинуться - от 2 до ${MAX_CONTRIBUTORS_CAP}`;
    }
    if (!selfPurchased && !/^https?:\/\/.+/i.test(fundraiserUrl)) {
      return "Вставьте ссылку на сбор из приложения банка - по ней друзья будут скидываться";
    }
  }
  return null;
}

export function AddItemForm({ slug, onAdded }: { slug: string; onAdded: (item: Item) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [selfPurchased, setSelfPurchased] = useState(false);
  const [sbpPhone, setSbpPhone] = useState("");
  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - имеет смысл только
  // вместе с selfPurchased, см. backend/src/routes/wishlists.ts.
  const [split, setSplit] = useState(false);
  const [maxContributors, setMaxContributors] = useState("2");
  // Сбор по ссылке банка (ТЗ блок 4) - для ещё не купленного подарка.
  const [fundraiserUrl, setFundraiserUrl] = useState("");
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
    const invalid = validationError(url, price, selfPurchased, sbpPhone, split, maxContributors, fundraiserUrl);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const item = await api.addItem(slug, {
        url,
        title: title || undefined,
        price: price ? Math.round(Number(price) * 100) : undefined,
        selfPurchased: selfPurchased || undefined,
        sbpPhone: selfPurchased ? sbpPhone.trim() : undefined,
        maxContributors: split ? Number(maxContributors) : undefined,
        fundraiserUrl: split && !selfPurchased ? fundraiserUrl.trim() : undefined,
      });
      onAdded(item);
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

        {!selfPurchased && !split && Number(price) >= FUNDRAISER_HINT_RUB && (
          <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "10px 12px", borderRadius: 12, background: "var(--accent-soft)" }}>
            Дорогой подарок? Создайте сбор в приложении банка и включите «Можно скинуться нескольким» - друзья скинутся вместе.
          </div>
        )}

        {(
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
              checked={split}
              onChange={(e) => setSplit(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
            />
            <span>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>
                Можно скинуться нескольким
              </span>
              <span style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                {selfPurchased
                  ? "Каждый переведёт свою часть по тому же номеру и отметит перевод отдельно"
                  : "Друзья скинутся через сбор в вашем банке, каждый отметит своё участие"}
              </span>
            </span>
          </label>
        )}

        {split && !selfPurchased && (
          <>
            <Field
              label="Ссылка на сбор в банке"
              value={fundraiserUrl}
              onChange={setFundraiserUrl}
              placeholder="https://..."
              type="url"
            />
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -10 }}>
              Создайте сбор в приложении своего банка (обычно раздел «Платежи» или «Накопления» → «Сбор денег»), скопируйте ссылку на него и вставьте сюда. Ссылку увидят только те, кто присоединится.
            </div>
          </>
        )}

        {split && (
          <Field
            label={`Сколько человек может скинуться (2-${MAX_CONTRIBUTORS_CAP})`}
            value={maxContributors}
            onChange={setMaxContributors}
            type="number"
            min="2"
          />
        )}
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        {saving && (
          // QA-5: подгрузка фото/названия (особенно Wildberries через
          // Apify) может идти до ~30 с - без пояснения кажется зависанием.
          <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", marginBottom: 8 }}>
            Подтягиваем фото и название из магазина - это может занять до 30 секунд
          </div>
        )}
        <PrimaryButton onClick={submit} disabled={!url || saving} style={{ width: "100%" }}>
          {saving ? "Добавляем…" : "Добавить в вишлист"}
        </PrimaryButton>
      </div>
    </>
  );
}
