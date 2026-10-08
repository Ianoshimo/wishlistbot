import { useEffect, useState } from "react";
import { absoluteApiUrl, api, apiError, formatOccasionDate, trackEvent, uiError, type UiError } from "../api";
import { BottomSheet, CopyRow, ErrorBanner, Field, PrimaryButton } from "./UI";
import { isInsideTelegram, openExternalLink } from "../telegram";

// Содержимое bottom sheet "Календарь" (CLAUDE.md, 2026-10-02, "продумай
// бизнесово как пользователю будет удобно синхронизировать календари") -
// два независимых сценария под одной кнопкой в шапке MyWishlist:
//
// 1. Повод этого вишлиста - владелец задаёт название + дату (например,
//    "День рождения" + 15 марта). Отсюда дарители на SharedWishlist
//    получают кнопку "Добавить в календарь" (разовое скачивание .ics,
//    без всякой авторизации - см. ShareWishlist-аналог там).
// 2. Личная подписка - постоянная webcal-ссылка (использует уже
//    существующий User.calendarToken), которая сама собирает поводы
//    ВСЕХ вишлистов, где этот человек дарил - подписался один раз,
//    дальше новые поводы появляются сами.

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function CalendarSheet({
  slug,
  occasionTitle,
  occasionDate,
  onSaved,
}: {
  slug: string;
  occasionTitle: string | null;
  occasionDate: string | null;
  onSaved: (title: string | null, date: string | null) => void;
}) {
  const [editing, setEditing] = useState(!occasionTitle);
  const [title, setTitle] = useState(occasionTitle ?? "");
  const [date, setDate] = useState(toDateInputValue(occasionDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  const save = async () => {
    if (!title.trim() || !date) {
      setError(uiError("occasion_required", "Укажите название и дату повода"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // QA-14: повод - календарный день. Шлём UTC-полночь выбранной даты,
      // а не местную полночь (она в UTC уезжала на предыдущий день).
      const iso = `${date}T00:00:00.000Z`;
      const result = await api.setOccasion(slug, title.trim(), iso);
      onSaved(result.occasionTitle, result.occasionDate);
      setEditing(false);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Убрать повод у этого вишлиста?")) return;
    setSaving(true);
    setError(null);
    try {
      await api.setOccasion(slug, null, null);
      onSaved(null, null);
      setTitle("");
      setDate("");
      setEditing(true);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      {error && <ErrorBanner {...error} screen="calendar" />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Повод этого вишлиста</div>

        {!editing && occasionTitle && occasionDate ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 14,
              borderRadius: 14,
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{occasionTitle}</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                {formatOccasionDate(occasionDate)}
              </div>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="hit44"
              style={{ height: 36, padding: "0 12px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent-text)", border: "none", fontSize: 13, fontWeight: 600 }}
            >
              Изменить
            </button>
            <button
              onClick={remove}
              aria-label="Убрать повод"
              className="hit44"
              style={{ height: 36, padding: "0 12px", borderRadius: 10, background: "transparent", color: "var(--danger)", border: "none", fontSize: 13, fontWeight: 600 }}
            >
              Убрать
            </button>
          </div>
        ) : (
          <>
            <Field label="Название" value={title} onChange={setTitle} placeholder="Например: День рождения" />
            <Field label="Дата" value={date} onChange={setDate} type="date" />
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Сохраняем…" : "Сохранить повод"}
            </PrimaryButton>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Дарители увидят повод на странице вишлиста и смогут добавить дату себе в календарь одним тапом.
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Мой календарь</div>
        <CalendarSubscribe from="owner_sheet" />
      </div>
    </div>
  );
}

// Личная подписка на поводы (webcal) - общий блок для шторки владельца
// ("Повод и календарь") и для дарителя (аудит 2026-10-08, А-49: подписка
// полезнее всего тому, кто дарит, а раньше её было видно только в шторке
// своего вишлиста). Содержимое фида не меняется: только поводы вишлистов,
// где этот человек сам бронировал подарок или участвует в складчине.
export function CalendarSubscribe({ from }: { from: "owner_sheet" | "shared_wishlist" | "item" }) {
  const [calendarToken, setCalendarToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api
      .getMe()
      .then((me) => setCalendarToken(me.calendarToken))
      .catch(() => setFailed(true));
  }, []);

  // webcal:// вместо https:// - так ссылка сама открывается в приложении
  // календаря при тапе, а не просто скачивает файл один раз; HTTPS-копия
  // рядом - на случай календаря, который webcal не понимает.
  const httpsUrl = calendarToken ? absoluteApiUrl(`/api/calendar/${calendarToken}.ics`) : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:/, "webcal:") : null;
  // А-22: промежуточная страница оформления подписки (backend routes/calendar.ts).
  const subscribePageUrl = calendarToken ? absoluteApiUrl(`/api/calendar/${calendarToken}/subscribe`) : null;

  return (
    <>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Одна ссылка-подписка собирает поводы всех вишлистов, где вы дарите, — подпишитесь один раз, и новые
        поводы будут появляться в вашем календаре сами, каждый год, с напоминанием за 3 дня.
      </div>
      {webcalUrl && httpsUrl ? (
        <>
          <a
            href={webcalUrl}
            onClick={(e) => {
              e.preventDefault();
              trackEvent("calendar_subscribe_clicked", { from });
              // Аудит 2026-10-08, А-22: webcal:// Telegram открыть не умеет,
              // а https-ссылка на .ics открывалась как файл - разовый импорт
              // вместо подписки. Внутри Telegram открываем страницу
              // подписки (во внешнем браузере), с неё кнопка ведёт на
              // webcal:// (iPhone/Mac) или в Google Календарь (Android).
              if (isInsideTelegram() && subscribePageUrl) openExternalLink(subscribePageUrl);
              else openExternalLink(webcalUrl, subscribePageUrl ?? httpsUrl);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 48,
              borderRadius: 14,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            Подписаться на календарь
          </a>
          {isInsideTelegram() && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -4 }}>
              Откроется страница в браузере: на iPhone нажмите «Подписаться в Календаре», на Android — «Google Календарь».
            </div>
          )}
          <CopyRow label="Ссылка (если подписка выше не открылась сама)" value={httpsUrl} />
        </>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {failed ? "Подписка доступна, когда вишлист открыт из Telegram." : "Загружаем ссылку…"}
        </div>
      )}
    </>
  );
}

// А-49: подсказка дарителю - после брони (экран подарка) и в чужом списке,
// где у него есть бронь или доля. Открывает шторку с подпиской.
export function GiverCalendarPrompt({ from }: { from: "shared_wishlist" | "item" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          trackEvent("form_opened", { form: "giver_calendar" });
          setOpen(true);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: "12px 14px",
          borderRadius: 14,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          textAlign: "left",
          color: "var(--text-primary)",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--accent-text)" }}>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ flexGrow: 1 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Напоминать о поводах друзей</span>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
            Дни рождения тех, кому вы дарите, появятся в вашем календаре
          </span>
        </span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Поводы друзей">
        <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          <CalendarSubscribe from={from} />
        </div>
      </BottomSheet>
    </>
  );
}
