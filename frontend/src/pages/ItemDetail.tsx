import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, describeError, type Item } from "../api";
import { ErrorBanner, Header, PrimaryButton, Screen } from "../components/UI";

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
            Позиция ещё свободна. Никто не увидит, что именно вы дарите.
          </div>
        )}

        {item.status === "reserved" && (
          <>
            <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13 }}>
              Забронировано вами · снимется через 5 дней, если не отметить покупку
            </div>
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
          </>
        )}

        {item.status === "bought" && (
          <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success)", fontSize: 13 }}>
            Спасибо! Отмечено как купленное.
          </div>
        )}
      </div>

      <div style={{ padding: "12px 16px 20px", borderTop: "1px solid var(--border)" }}>
        {item.status === "available" && (
          <PrimaryButton onClick={reserve} style={{ width: "100%" }}>
            Забронировать
          </PrimaryButton>
        )}
        {item.status === "reserved" && (
          <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
            Отметить купленным
          </PrimaryButton>
        )}
      </div>
    </Screen>
  );
}
