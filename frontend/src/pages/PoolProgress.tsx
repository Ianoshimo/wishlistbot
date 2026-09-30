import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type PoolResponse } from "../api";
import { Header, Screen } from "../components/UI";

export function PoolProgress() {
  const { id = "" } = useParams();
  const [pool, setPool] = useState<PoolResponse | null>(null);

  const reload = () => api.getPool(id).then(setPool);
  useEffect(() => {
    void reload();
  }, [id]);

  if (!pool) return null;

  if (pool.status === "expired") {
    return (
      <Screen>
        <Header title={pool.title} backTo="/" />
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ padding: 16, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 14 }}>
            Сумма не набралась - взносы возвращены автоматически всем дарителям.
          </div>
        </div>
      </Screen>
    );
  }

  const pct = pool.targetAmount
    ? Math.min(100, Math.round((pool.collected / pool.targetAmount) * 100))
    : null;

  const extend = async () => {
    await api.extendPool(id);
    await reload();
  };

  return (
    <Screen>
      <Header
        title={pool.title}
        backTo="/"
        action={
          pool.viewerIsOrganizer ? (
            <Link
              to="/calendar/organizer"
              aria-label="Мои сборы"
              style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
          ) : undefined
        }
      />

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18, flexGrow: 1 }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 26, fontWeight: 800 }}>{(pool.collected / 100).toFixed(0)} ₽</div>
            {pool.targetAmount && (
              <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                из {(pool.targetAmount / 100).toFixed(0)} ₽
              </div>
            )}
          </div>
          {pct !== null && (
            <div style={{ height: 10, borderRadius: 999, background: "var(--border)", marginTop: 10, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "var(--accent)" }} />
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
            Срок до {new Date(pool.deadline).toLocaleDateString("ru-RU")} · {pool.contributions.length} дарителей
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Кто скинулся</div>
          {pool.contributions.map((c, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14 }}
            >
              <div style={{ flexGrow: 1, fontSize: 14, fontWeight: 600 }}>Участник сбора</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{(c.amount / 100).toFixed(0)} ₽</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 16px 20px", borderTop: "1px solid var(--border)" }}>
        {pool.viewerIsOrganizer ? (
          <button
            onClick={extend}
            style={{ width: "100%", height: 50, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)", fontSize: 15, fontWeight: 600 }}
          >
            Продлить срок на 7 дней
          </button>
        ) : (
          <Link
            to={`/p/${id}/contribute`}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 50, borderRadius: 14, background: "var(--accent)", color: "#ffffff", fontSize: 15, fontWeight: 600 }}
          >
            Скинуться
          </Link>
        )}
      </div>
    </Screen>
  );
}
