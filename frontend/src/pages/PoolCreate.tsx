import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Header, Screen } from "../components/UI";

export function PoolCreate() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "/";
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [occasionDate, setOccasionDate] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [duration, setDuration] = useState<7 | 14 | 30>(14);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const pool = await api.createPool({
        title,
        occasionDate: occasionDate ? new Date(occasionDate).toISOString() : undefined,
        targetAmount: targetAmount ? Math.round(Number(targetAmount) * 100) : undefined,
        durationDays: duration,
      });
      navigate(`/p/${pool.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title="Новый сбор" backTo={`/w/${from}`} />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20, flexGrow: 1 }}>
        <Field label="Повод" value={title} onChange={setTitle} placeholder="Например: день рождения Кати" />
        <Field label="Дата повода (необязательно)" value={occasionDate} onChange={setOccasionDate} type="date" />
        <Field label="Целевая сумма, ₽ (необязательно)" value={targetAmount} onChange={setTargetAmount} type="number" placeholder="25000" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Срок сбора</span>
          <div style={{ display: "flex", gap: 8 }}>
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                style={{
                  flexGrow: 1,
                  height: 44,
                  borderRadius: 12,
                  border: `1px solid ${d === duration ? "var(--accent)" : "var(--border)"}`,
                  background: d === duration ? "var(--accent-soft)" : "var(--surface)",
                  color: d === duration ? "var(--accent)" : "var(--text-primary)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {d} дней
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 13, color: "var(--text-secondary)" }}>
          Если к сроку сумма не наберётся - всем дарителям автоматически вернутся их взносы.
        </div>
      </div>
      <div style={{ padding: "12px 16px 20px" }}>
        <button
          onClick={submit}
          disabled={!title || saving}
          style={{
            width: "100%",
            height: 50,
            borderRadius: 14,
            background: "var(--accent)",
            color: "#ffffff",
            fontSize: 15,
            fontWeight: 600,
            border: "none",
          }}
        >
          {saving ? "Запускаем…" : "Запустить сбор"}
        </button>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
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
