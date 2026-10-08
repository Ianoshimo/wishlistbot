import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { isInsideTelegram, setClosingConfirmation, showTelegramBackButton } from "../telegram";
import { formatRub, trackEvent } from "../api";

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
            // А-27: зона нажатия 44x44, отрицательный отступ сохраняет вёрстку.
            width: 44,
            height: 44,
            margin: "-6px -6px -6px -10px",
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
        color: "var(--on-accent)",
        fontSize: 15,
        fontWeight: 600,
        border: "none",
        ...props.style,
      }}
    />
  );
}

// Аудит 2026-10-08, А-30: свои брони и доли в чужом списке - отдельным
// бейджем ("Вы бронируете", "Вы участвуете"...), а не общим "Занято" -
// иначе свои брони приходится искать, открывая каждую карточку.
export type MineStatus = "reserved" | "joined" | "paid" | "gave";

export function mineStatus(item: {
  reservedByMe: boolean;
  paidByMe: boolean;
  status: "available" | "reserved" | "bought";
  maxContributors: number;
}): MineStatus | null {
  if (!item.reservedByMe) return null;
  if (item.status === "bought") return "gave";
  if (item.maxContributors > 1) return item.paidByMe ? "paid" : "joined";
  return "reserved";
}

export function StatusBadge({ status, mine = null }: { status: "available" | "reserved" | "bought"; mine?: MineStatus | null }) {
  const map = {
    available: { label: "Свободно", bg: "var(--accent-soft)", color: "var(--accent-text)" },
    reserved: { label: "Занято", bg: "var(--warning-soft)", color: "var(--warning-text)" },
    bought: { label: "Куплено", bg: "var(--success-soft)", color: "var(--success-text)" },
  } as const;
  const mineMap = {
    reserved: { label: "Вы бронируете", bg: "var(--highlight-soft)", color: "var(--text-primary)" },
    joined: { label: "Вы участвуете", bg: "var(--highlight-soft)", color: "var(--text-primary)" },
    paid: { label: "Вы перевели", bg: "var(--highlight-soft)", color: "var(--text-primary)" },
    gave: { label: "Вы подарили", bg: "var(--success-soft)", color: "var(--success-text)" },
  } as const;
  const s = mine ? mineMap[mine] : map[status];
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
        // Своё - с обводкой, чтобы отличалось от чужих броней не только цветом.
        boxShadow: mine ? "inset 0 0 0 1px var(--highlight)" : undefined,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </div>
  );
}

// Фото подтягивается автоматически по ссылке на товар (без ручной
// загрузки - решение 2026-10-02, см. backend/src/services/linkPreview.ts).
// Не у каждой ссылки получится (антибот Ozon/Авито/Маркета). Аудит
// 2026-10-08, А-9: вместо пустоты - заглушка в цветах бренда того же
// размера (карточки одной ширины): буква магазина или значок подарка.
// Битая ссылка на картинку тоже даёт заглушку.
const STORE_LETTER: Record<string, string> = {
  Ozon: "O",
  Wildberries: "W",
  "Яндекс.Маркет": "Я",
  Авито: "А",
  AliExpress: "A",
};

export function Thumbnail({ src, size = 48, store = null }: { src: string | null; size?: number; store?: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        style={{
          width: size,
          height: size,
          borderRadius: size >= 64 ? 14 : 10,
          objectFit: "cover",
          flexShrink: 0,
          background: "var(--border)",
        }}
      />
    );
  }
  const letter = store ? STORE_LETTER[store] : undefined;
  return (
    <div
      aria-hidden="true"
      data-placeholder="thumbnail"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 64 ? 14 : 10,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, var(--accent-soft), var(--highlight-soft))",
        color: "var(--accent-text)",
      }}
    >
      {letter ? (
        <span className="font-display" style={{ fontSize: Math.round(size * 0.42), fontWeight: 700, lineHeight: 1 }}>
          {letter}
        </span>
      ) : (
        <svg width={Math.round(size * 0.46)} height={Math.round(size * 0.46)} viewBox="0 0 24 24" fill="none">
          <rect x="3" y="8" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 12h18M12 8v13" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 8c-1.5-3-5-3.5-5.5-1.5S9 8 12 8zm0 0c1.5-3 5-3.5 5.5-1.5S15 8 12 8z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

// Для перевода по СБП получателю нужно скопировать номер телефона и
// комментарий (название подарка) - см. ItemDetail.tsx. navigator.clipboard
// недоступен в части старых WebView, поэтому молча деградируем вместо
// падения - текст всё равно виден и выделяем вручную.
export function CopyRow({
  label,
  value,
  display,
  onCopied,
}: {
  label: string;
  value: string;
  // Как показать значение (например, номер "+7 900 123-45-67"), если
  // копировать нужно другое (+79001234567) - А-18.
  display?: string;
  onCopied?: () => void;
}) {
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
        <div style={{ flexGrow: 1, fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{display ?? value}</div>
        <button
          onClick={copy}
          className="hit44"
          style={{
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent-text)",
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

// Редизайн "Электрик" (CLAUDE.md, 2026-10-01): крупная кнопка "+" в зоне
// большого пальца вместо мелкой иконки в шапке. Аудит 2026-10-08, А-24:
// плавающий FAB в правом нижнем углу лежал поверх звёздочки и карандаша
// нижней видимой карточки. Теперь это нижняя панель на всю ширину,
// прилипающая к низу экрана (sticky) с непрозрачным фоном: карточки
// уходят ПОД неё при прокрутке, а в конце списка - целиком над ней. Ни в
// одном положении прокрутки действия карточки не перекрываются кнопкой.
export function AddBar({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        marginTop: "auto",
        padding: "10px 16px calc(12px + var(--safe-bottom))",
        background: "var(--bg)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <button
        onClick={onClick}
        style={{
          width: "100%",
          height: 50,
          borderRadius: 14,
          background: "var(--accent)",
          color: "var(--on-accent)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          fontSize: 15,
          fontWeight: 600,
          boxShadow: "0 8px 20px rgba(77, 62, 153, 0.25)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        {label}
      </button>
    </div>
  );
}

// Аудит 2026-10-08, А-29: вместо пустого фона во время загрузки -
// скелетон шапки и карточек (пульсирует, при reduced-motion - статичный).
export function Loading({ cards = 4 }: { cards?: number }) {
  return (
    <Screen>
      <div role="status" aria-live="polite" aria-label="Загрузка" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="skeleton" style={{ height: 22, width: "55%", borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 72, borderRadius: 16 }} />
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }} />
            <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="skeleton" style={{ height: 14, width: `${70 - i * 8}%`, borderRadius: 6 }} />
              <div className="skeleton" style={{ height: 12, width: "35%", borderRadius: 6 }} />
            </div>
          </div>
        ))}
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Загружаем…</span>
      </div>
    </Screen>
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
        // А-27: зона нажатия 44x44 (была 32).
        width: 44,
        height: 44,
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
  confirmClose = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // А-34: шторка с формой - пока открыта, Telegram переспрашивает перед
  // закрытием мини-аппа, чтобы введённое не потерялось от случайного жеста.
  confirmClose?: boolean;
}) {
  useEffect(() => {
    if (!open || !confirmClose) return;
    setClosingConfirmation(true);
    return () => setClosingConfirmation(false);
  }, [open, confirmClose]);

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
          {/* А-27: кнопка 44x44, видимый кружок прежний - 32x32. */}
          <button
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              width: 44,
              height: 44,
              margin: "-6px -6px -6px 0",
              padding: 0,
              background: "transparent",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: "var(--surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
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
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: string;
  maxLength?: number;
  // id <datalist> с подсказками (банк для СБП, А-5).
  list?: string;
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
        list={list}
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

// Строка-переключатель с подписью (формы добавления и правки подарка).
export function ToggleRow({
  checked,
  onChange,
  disabled,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title: string;
  hint: ReactNode;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: 14,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
      />
      <span>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>{hint}</span>
      </span>
    </label>
  );
}

// Аудит 2026-10-08, А-5: подпись способа получить деньги в списках -
// "Подарок деньгами · СБП" / "Сбор в банке" (+ складчина), "уже купил сам" -
// пометкой "в магазин не нужно" (не словом "куплено", А-7).
// А-25: у складчины с ценой - доля "по ~1 375 ₽ с человека" прямо в списке.
// А-20: владельцу - сколько уже перевели и примерно сколько собрано
// (paidCount приходит только владельцу, без имён); дарителю - общий
// прогресс "участвуют X из N".
export function PayoutLabel({
  item,
}: {
  item: {
    payoutMethod: "sbp" | "fundraiser" | null;
    selfPurchased: boolean;
    maxContributors: number;
    contributorsCount: number;
    price?: number | null;
    paidCount?: number | null;
    status?: "available" | "reserved" | "bought";
  };
}) {
  if (!item.payoutMethod) return null;
  const parts = [item.payoutMethod === "sbp" ? "Подарок деньгами · СБП" : "Сбор в банке"];
  if (item.selfPurchased) parts.push("в магазин не нужно");
  const split = item.maxContributors > 1;
  const share = split && item.price ? Math.round(item.price / item.maxContributors) : null;
  let progress: string | null = null;
  if (split && item.status !== "bought") {
    if (item.paidCount !== null && item.paidCount !== undefined) {
      const waiting = item.contributorsCount - item.paidCount;
      progress = `перевели ${item.paidCount}\u00a0из\u00a0${item.maxContributors}`;
      if (waiting > 0) progress += ` · ещё\u00a0${waiting}\u00a0${waiting === 1 ? "участвует" : "участвуют"}`;
      if (share && item.paidCount > 0) progress += ` · собрано ≈\u00a0${formatRub(share * item.paidCount)}`;
    } else {
      progress = `участвуют ${item.contributorsCount}\u00a0из\u00a0${item.maxContributors}`;
    }
  }
  return (
    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
      {parts.join(" · ")}
      {share && (
        <>
          {" · "}
          <span style={{ whiteSpace: "nowrap" }}>по ~{formatRub(share)} с человека</span>
        </>
      )}
      {progress && <div>{progress}</div>}
    </div>
  );
}
