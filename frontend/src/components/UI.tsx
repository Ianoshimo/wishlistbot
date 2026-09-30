import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {children}
    </div>
  );
}

export function Header({
  title,
  backTo,
  action,
}: {
  title: string;
  backTo?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {backTo && (
        <Link
          to={backTo}
          aria-label="Назад"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      )}
      <div style={{ flexGrow: 1, fontSize: 17, fontWeight: 700 }}>{title}</div>
      {action}
    </div>
  );
}

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button
      {...props}
      style={{
        height: 50,
        borderRadius: 14,
        background: "var(--accent)",
        color: "#ffffff",
        fontSize: 15,
        fontWeight: 600,
        border: "none",
        ...props.style,
      }}
    />
  );
}

export function StatusBadge({ status }: { status: "available" | "reserved" | "bought" }) {
  const map = {
    available: { label: "Свободно", bg: "var(--accent-soft)", color: "var(--accent)" },
    reserved: { label: "Занято", bg: "var(--warning-soft)", color: "var(--warning)" },
    bought: { label: "Куплено", bg: "var(--success-soft)", color: "var(--success)" },
  } as const;
  const s = map[status];
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "5px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
      }}
    >
      {s.label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: "var(--danger-soft)",
        color: "var(--danger)",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

// Заглушка для экранов, которые ещё не реализованы предметно (см.
// Продукт/задачи-итерация-1.md) - навигация уже работает, содержимое нет.
export function Placeholder({ title, backTo }: { title: string; backTo: string }) {
  return (
    <Screen>
      <Header title={title} backTo={backTo} />
      <div style={{ padding: 20, color: "var(--text-secondary)", fontSize: 14 }}>
        Экран в разработке - см. соответствующий пункт в Продукт/задачи-итерация-1.md
        и артборд в дизайн-макете.
      </div>
    </Screen>
  );
}
