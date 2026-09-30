import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { Header, Screen } from "../components/UI";

// ЮKassa ещё не подключена (см. открытые вопросы спеки - юрлицо, тип чека
// под 54-ФЗ) - честно показываем это состояние, не изображаем фейковый
// успех оплаты, как это допустимо в дизайн-макете, но не в рабочем коде.
export function Contribute() {
  const { id = "" } = useParams();
  const [amount, setAmount] = useState("1000");
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    await api.contribute(id, Math.round(Number(amount) * 100));
    setSubmitted(true);
  };

  return (
    <Screen>
      <Header title="Взнос в сбор" backTo={`/p/${id}`} />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18, flexGrow: 1 }}>
        {submitted ? (
          <div style={{ padding: 16, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 14, lineHeight: 1.5 }}>
            Взнос зафиксирован, но приём платежей через ЮKassa ещё не подключён -
            деньги не списаны. См. открытые вопросы в Продукт/спека-итерация-1.md.
          </div>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Сумма, ₽</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ height: 48, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)", padding: "0 14px", fontSize: 16 }}
              />
            </label>
            <div style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text-secondary)" }}>
              Оплата через СБП. Если сбор не наберёт нужную сумму к сроку, взнос вернётся автоматически.
            </div>
          </>
        )}
      </div>
      {!submitted && (
        <div style={{ padding: "12px 16px 20px" }}>
          <button
            onClick={submit}
            style={{ width: "100%", height: 50, borderRadius: 14, background: "var(--accent)", color: "#ffffff", fontSize: 15, fontWeight: 600, border: "none" }}
          >
            Оплатить через СБП
          </button>
        </div>
      )}
    </Screen>
  );
}
