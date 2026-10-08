import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isInsideTelegram, showTelegramBackButton } from "../telegram";
import { trackEvent } from "../api";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
        boxSizing: "border-box",
      }}
    >
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
  // ТЗ блок 4, п.5.3: внутри Telegram "Назад" - нативная кнопка клиента
  // (левый верхний угол в полноэкранном режиме занят "Закрыть").
  const navigate = useNavigate();
  const nativeBack = Boolean(backTo) && isInsideTelegram();
  useEffect(() => {
    if (!backTo || !nativeBack) return;
    return showTelegramBackButton(() => navigate(backTo));
  }, [backTo, nativeBack, navigate]);

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
      {backTo && !nativeBack && (
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
export function CopyRow({ label, value, onCopied }: { label: string; value: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied?.();
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

// Редизайн "Электрик" (CLAUDE.md, 2026-10-01): FAB вместо мелкой иконки в
// шапке - крупнее, удобнее дотянуться большим пальцем на одной руке.
export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        position: "fixed",
        right: 20,
        bottom: "calc(24px + var(--safe-bottom))",
        width: 56,
        height: 56,
        borderRadius: 18,
        background: "var(--accent)",
        color: "#ffffff",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 10px 24px rgba(77, 62, 153, 0.35)",
        zIndex: 20,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// Карточка прогресса вверху списка ("3 из 7 куплено" + полоска) -
// редизайн "Электрик": лайм-акцент (--highlight) зарезервирован ровно для
// одного такого "особого" момента на экране, не для общего accent.
export function ProgressCard({ total, done }: { total: number; done: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      style={{
        margin: "0 12px 10px",
        padding: 16,
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span className="font-display" style={{ fontSize: 16, fontWeight: 700 }}>
          {done} из {total} куплено
        </span>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{pct}%</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "var(--highlight-soft)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: "var(--highlight)",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

const STORE_COLORS: Record<string, string> = {
  Ozon: "#005bff",
  Wildberries: "#cb11ab",
  "Яндекс.Маркет": "#fc3f1d",
  Авито: "#00a046",
  AliExpress: "#e62e04",
};

// Бейдж магазина на карточке позиции (CLAUDE.md, 2026-10-01) - хост уже
// известен бэкенду (item.store, см. api.ts), чисто визуальный штрих.
export function StoreBadge({ store }: { store: string | null }) {
  if (!store) return null;
  const color = STORE_COLORS[store] ?? "var(--text-secondary)";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {store}
    </div>
  );
}

// Приоритет позиции ("хочу больше всего" - CLAUDE.md, 2026-10-01).
// editable=false - просто индикатор для дарителя (SharedWishlist), не
// триггерит никакого запроса.
export function PriorityStar({
  active,
  editable,
  onClick,
}: {
  active: boolean;
  editable: boolean;
  onClick?: () => void;
}) {
  const star = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "var(--highlight)" : "none"}>
      <path
        d="M12 3l2.7 6.2 6.8.6-5.1 4.5 1.6 6.6L12 17.3 5.9 20.9l1.6-6.6-5.1-4.5 6.8-.6L12 3z"
        stroke={active ? "var(--highlight)" : "var(--text-secondary)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
  if (!editable) {
    return active ? <div style={{ flexShrink: 0 }}>{star}</div> : null;
  }
  return (
    <button
      onClick={onClick}
      aria-label={active ? "Убрать из приоритетных" : "Отметить как желанное больше всего"}
      style={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: 8,
        background: "transparent",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {star}
    </button>
  );
}

// Bottom sheet для "Добавить позицию" и СБП-карточки вместо перехода на
// отдельную страницу (CLAUDE.md, 2026-10-01) - быстрее ощущается, не
// теряешь контекст списка/подарка за собой.
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // Esc закрывает на десктопе/вне Telegram - внутри самого Telegram
  // клавиатуры в таком смысле нет, но это бесплатно и не мешает.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(10, 8, 20, 0.5)" }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 480,
          maxHeight: "calc(100vh - var(--safe-top) - 24px)",
          paddingBottom: "var(--safe-bottom)",
          overflowY: "auto",
          background: "var(--bg)",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          boxShadow: "0 -8px 30px rgba(0,0,0,0.25)",
          animation: "wishlistbot-sheet-up 0.2s ease-out",
        }}
      >
        {/* Аудит 2026-10-08, А-8: шапка (ручка, заголовок, "Закрыть") -
            липкая: раньше прокручивалась вместе с длинной формой, и было
            не видно, что это за экран и как его закрыть. Фон нужен, чтобы
            поля не просвечивали под ней. */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--bg)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }}
        >
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: "var(--border)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px" }}>
          <div className="font-display" style={{ flexGrow: 1, fontSize: 17, fontWeight: 700 }}>
            {title}
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--surface)",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  maxLength?: number;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        maxLength={maxLength}
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

export function ErrorBanner({
  message,
  code,
  screen,
  revealParent = false,
}: {
  message: string;
  code: string;
  screen: string;
  // Докрутить не только баннер, а весь его блок (баннер + кнопка отправки
  // в шторках формы) - иначе кнопку выталкивает за нижний край.
  revealParent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // ТЗ блок 4 (логи): какие ошибки реально видят пользователи. QB4-5:
  // машинный код (см. UiError в api.ts) и реальный экран/шторка, а не
  // текст сообщения и первый сегмент адреса (у шторок он всегда "home").
  useEffect(() => {
    trackEvent("error_shown", { code, screen });
  }, [message, code, screen]);
  // QB4-2: в длинной прокрученной шторке ошибка могла оказаться за краем
  // экрана - пользователь жал кнопку и не видел реакции. Докручиваем до
  // баннера, если его не видно ("nearest" не дёргает видимый).
  useEffect(() => {
    const target = revealParent ? ref.current?.parentElement : ref.current;
    target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [message, revealParent]);
  return (
    <div
      ref={ref}
      role="alert"
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
