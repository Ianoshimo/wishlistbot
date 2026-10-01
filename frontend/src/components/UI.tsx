import { useState, type ReactNode } from "react";
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
      <div className="font-display" style={{ flexGrow: 1, fontSize: 17, fontWeight: 700 }}>{title}</div>
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

// Фото подтягивается автоматически по ссылке на товар (без ручной
// загрузки - решение 2026-10-02, см. backend/src/services/linkPreview.ts).
// Не у каждой ссылки получится - тогда просто нет картинки, это ожидаемо.
export function Thumbnail({ src, size = 48 }: { src: string | null; size?: number }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        objectFit: "cover",
        flexShrink: 0,
        background: "var(--border)",
      }}
    />
  );
}

// Для перевода по СБП получателю нужно скопировать номер телефона и
// комментарий (название подарка) - см. ItemDetail.tsx. navigator.clipboard
// недоступен в части старых WebView, поэтому молча деградируем вместо
// падения - текст всё равно виден и выделяем вручную.
export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // см. комментарий выше
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 12,
          background: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ flexGrow: 1, fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{value}</div>
        <button
          onClick={copy}
          style={{
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent)",
            border: "none",
            fontSize: 12,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>
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
