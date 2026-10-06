import { useEffect, useState } from "react";
import { absoluteApiUrl, api, describeError } from "../api";
import { CopyRow, ErrorBanner, Field, PrimaryButton } from "./UI";

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
  const [error, setError] = useState<string | null>(null);

  const [calendarToken, setCalendarToken] = useState<string | null>(null);
  useEffect(() => {
    api
      .getMe()
      .then((me) => setCalendarToken(me.calendarToken))
      .catch(() => {
        // Нет настоящего Telegram-входа (dev-режим) - просто не
        // показываем ссылку подписки, это ожидаемо.
      });
  }, []);

  const save = async () => {
    if (!title.trim() || !date) {
      setError("Укажите название и дату повода");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const iso = new Date(`${date}T00:00:00`).toISOString();
      const result = await api.setOccasion(slug, title.trim(), iso);
      onSaved(result.occasionTitle, result.occasionDate);
      setEditing(false);
    } catch (err) {
      setError(describeError(err));
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
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  // webcal:// вместо https:// - так ссылка сама открывается в приложении
  // календаря при тапе, а не просто скачивает файл один раз; HTTPS-копия
  // рядом - на случай календаря, который webcal не понимает.
  const httpsUrl = calendarToken ? absoluteApiUrl(`/api/calendar/${calendarToken}.ics`) : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https?:/, "webcal:") : null;

  return (
    <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      {error && <ErrorBanner message={error} />}

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
                {new Date(occasionDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
              </div>
            </div>
            <button
              onClick={() => setEditing(true)}
              style={{ height: 36, padding: "0 12px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", border: "none", fontSize: 13, fontWeight: 600 }}
            >
              Изменить
            </button>
            <button
              onClick={remove}
              aria-label="Убрать повод"
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
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Одна ссылка-подписка собирает поводы всех вишлистов, где вы дарили - подпишитесь один раз, новые поводы
          будут появляться в вашем календаре сами, каждый год заново.
        </div>
        {webcalUrl && httpsUrl ? (
          <>
            <a
              href={webcalUrl}
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
            <CopyRow label="Ссылка (если подписка выше не открылась сама)" value={httpsUrl} />
          </>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Загружаем ссылку…</div>
        )}
      </div>
    </div>
  );
}
