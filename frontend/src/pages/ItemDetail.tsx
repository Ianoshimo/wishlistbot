import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, describeError, type Item } from "../api";
import { CopyRow, ErrorBanner, Header, PrimaryButton, Screen } from "../components/UI";

// Спека итерации 1, п.2-3: полный жизненный цикл брони в одном экране,
// как в дизайн-макете (артборд ItemDetail) - available → reserved → bought.

export function ItemDetail() {
  const { itemId = "" } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.getItem(itemId).then(setItem);
  useEffect(() => {
    void reload();
  }, [itemId]);

  if (!item) return null;

  const reserve = async () => {
    setError(null);
    try {
      await api.reserveItem(itemId);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  };
  const markBought = async () => {
    setError(null);
    try {
      await api.markBought(itemId);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Screen>
      <Header title="Подарок" backTo="/" />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flexGrow: 1 }}>
        {error && <ErrorBanner message={error} />}
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 14, background: "var(--border)" }}
          />
        )}
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{item.title ?? item.url}</div>
          {item.price && (
            <div style={{ fontSize: 16, color: "var(--text-secondary)", marginTop: 4 }}>
              {(item.price / 100).toFixed(0)} ₽
            </div>
          )}
        </div>

        {item.status === "available" && (
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              fontSize: 14,
              color: "var(--text-secondary)",
            }}
          >
            {item.selfPurchased
              ? "Получатель уже купил(а) этот подарок сам(а) - идти в магазин не нужно, после брони вы получите номер телефона для перевода."
              : "Позиция ещё свободна. Никто не увидит, что именно вы дарите."}
          </div>
        )}

        {item.status === "reserved" && (
          <>
            {/* Беклог В-6: раньше писали "вами" безусловно - получатель
                на своей же позиции тоже это видел. Текст нейтральный для
                всех, кроме реального держателя брони. */}
            <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13 }}>
              {item.reservedByMe
                ? `Забронировано вами · снимется через 5 дней, если не отметить ${item.selfPurchased ? "перевод" : "покупку"}`
                : "Уже забронировано"}
            </div>

            {item.selfPurchased ? (
              <SbpPaymentCard item={item} />
            ) : (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 50,
                  borderRadius: 14,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                Перейти в магазин
              </a>
            )}
          </>
        )}

        {item.status === "bought" && (
          <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success)", fontSize: 13 }}>
            {item.selfPurchased ? "Спасибо! Отмечено, что перевод отправлен." : "Спасибо! Отмечено как купленное."}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px 20px", borderTop: "1px solid var(--border)" }}>
        {item.status === "available" && (
          <PrimaryButton onClick={reserve} style={{ width: "100%" }}>
            {item.selfPurchased ? "Перевести деньгами" : "Забронировать"}
          </PrimaryButton>
        )}
        {item.status === "reserved" && item.reservedByMe && (
          <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
            {item.selfPurchased ? "Деньги отправлены" : "Отметить купленным"}
          </PrimaryButton>
        )}
      </div>
    </Screen>
  );
}

// "Уже купил(а) сам(а)" (решение 2026-10-02, по просьбе пользователя) -
// вместо похода в магазин даритель переводит деньги напрямую получателю по
// СБП. Номер телефона отдаётся бэкендом только после брони - см.
// backend/src/routes/items.ts.
function SbpPaymentCard({ item }: { item: Item }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {item.sbpPhone ? <CopyRow label="Номер телефона для перевода по СБП" value={item.sbpPhone} /> : null}
      {item.price && <CopyRow label="Сумма" value={`${(item.price / 100).toFixed(0)} ₽`} />}
      <CopyRow label="Комментарий к переводу" value={item.title ?? "Подарок"} />

      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
        <li>Откройте приложение банка</li>
        <li>Выберите перевод по номеру телефона (СБП)</li>
        <li>Вставьте номер телефона</li>
        <li>Добавьте комментарий с названием подарка</li>
        <li>Укажите сумму и отправьте перевод</li>
      </ol>
    </div>
  );
}
