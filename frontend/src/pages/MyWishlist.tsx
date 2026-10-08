import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, apiError, formatOccasionDate, formatRub, trackEvent, type Item, type MyWishlistSummary, type WishlistResponse, type UiError } from "../api";
import {
  AddBar,
  BottomSheet,
  ErrorBanner,
  Header,
  Loading,
  PriorityStar,
  ProgressCard,
  Screen,
  StatusBadge,
  StoreBadge,
  PayoutLabel,
  Thumbnail,
} from "../components/UI";
import { AddItemForm } from "../components/AddItemForm";
import { EditItemForm } from "../components/EditItemForm";
import { SwipeToDelete } from "../components/SwipeToDelete";
import { CalendarSheet } from "../components/CalendarSheet";
import { WishlistNameSheet } from "../components/WishlistNameSheet";

const WISHLIST_LIMIT = 3;

// Спека итерации 1, п.1 + п.7: вишлист получателя со списком позиций и
// отдельным пустым состоянием. В макете это два артборда (Main/Empty) -
// здесь один компонент с условным рендером, это один и тот же URL для
// реального пользователя.

export const MY_SLUG_KEY = "wishlistbot_my_slug";

export function MyWishlist() {
  const navigate = useNavigate();
  const [wishlist, setWishlist] = useState<WishlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  // Отдельно от error (срыв начальной загрузки - на весь экран) - ошибка
  // точечного действия (удаление) не должна заменять собой весь список.
  const [actionError, setActionError] = useState<UiError | null>(null);
  // FAB "+" и свайв-удаление вместо отдельной страницы/крестик-кнопки
  // (редизайн "Электрик", CLAUDE.md 2026-10-01) - состояние sheet'ов живёт
  // прямо здесь, а не в отдельном роуте.
  const [addOpen, setAddOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  // Повод + личная подписка на календарь (CLAUDE.md, 2026-10-02) - см.
  // components/CalendarSheet.tsx.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // До 3 вишлистов на человека (CLAUDE.md, 2026-10-02, "сделай 3 и
  // названия для них") - переключатель вверху экрана, nameSheet
  // обслуживает и создание нового, и переименование текущего (тап по
  // уже активной вкладке - см. switchTo ниже).
  const [myWishlists, setMyWishlists] = useState<MyWishlistSummary[]>([]);
  const [nameSheet, setNameSheet] = useState<"create" | "rename" | null>(null);

  useEffect(() => {
    trackEvent("screen_viewed", { screen: "my_wishlist" });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        // Беклог Н-2 переехал сюда (раньше решался на бэкенде, одним
        // вишлистом на пользователя): сначала смотрим, что уже есть у
        // этого человека на сервере, и только если нет вообще ничего -
        // создаём первый список. Так переустановка/автоочистка WebView
        // не плодит лишний новый список поверх уже существующих.
        const mine = await api.getMyWishlists();
        let slug = localStorage.getItem(MY_SLUG_KEY);
        if (!slug || !mine.wishlists.some((w) => w.slug === slug)) {
          slug = mine.wishlists[0]?.slug;
        }
        if (!slug) {
          // QA-1: onlyIfNone - если параллельный запуск (двойной эффект
          // React, два открытия подряд) уже успел создать список, бэкенд
          // вернёт его же, а не создаст второй.
          const created = await api.createWishlist(undefined, true);
          slug = created.slug;
          if (!mine.wishlists.some((w) => w.slug === created.slug)) {
            mine.wishlists.push({ slug: created.slug, title: created.title, itemCount: 0 });
          }
        }
        localStorage.setItem(MY_SLUG_KEY, slug);
        setMyWishlists(mine.wishlists);
        const data = await api.getWishlist(slug);
        setWishlist(data);
      } catch (err) {
        setError(apiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const switchTo = async (slug: string) => {
    trackEvent("wishlist_switched");
    localStorage.setItem(MY_SLUG_KEY, slug);
    try {
      const data = await api.getWishlist(slug);
      setWishlist(data);
    } catch (err) {
      setActionError(apiError(err));
    }
  };

  // А-29: скелетон вместо пустого экрана.
  if (loading) return <Loading />;
  if (error) {
    return (
      <Screen>
        <Header title="Мой вишлист" />
        <div style={{ padding: 20 }}>
          <ErrorBanner {...error} screen="my_wishlist" />
        </div>
      </Screen>
    );
  }
  if (!wishlist) return <Loading />;

  // QA-6: счётчик позиций во вкладке обновляется вместе со списком, а не
  // только после перезагрузки.
  const bumpItemCount = (slug: string, delta: number) =>
    setMyWishlists((list) => list.map((w) => (w.slug === slug ? { ...w, itemCount: Math.max(0, w.itemCount + delta) } : w)));

  const boughtCount = wishlist.items.filter((i) => i.status === "bought").length;
  // Приоритет позиции ("хочу больше всего") - приоритетные позиции
  // поднимаются наверх, стандартный паттерн вишлистов (CLAUDE.md,
  // 2026-10-01). Array.prototype.sort стабилен - порядок внутри каждой
  // группы (по дате создания, как отдаёт бэкенд) не меняется.
  const sortedItems = [...wishlist.items].sort((a, b) => Number(b.priority) - Number(a.priority));

  // Беклог Н-4: бэкенд умел удалять позиции ещё с фикса Б-2, но во
  // фронтенде не было вообще никакого способа это вызвать.
  const deleteItem = async (item: Item) => {
    if (!window.confirm(deleteConfirmText(item))) return;
    const itemId = item.id;
    setActionError(null);
    try {
      await api.deleteItem(itemId);
      setWishlist((w) => (w ? { ...w, items: w.items.filter((i) => i.id !== itemId) } : w));
      bumpItemCount(wishlist.slug, -1);
    } catch (err) {
      setActionError(apiError(err));
    }
  };

  const togglePriority = async (itemId: string) => {
    setActionError(null);
    try {
      const { priority } = await api.toggleItemPriority(itemId);
      setWishlist((w) =>
        w ? { ...w, items: w.items.map((i) => (i.id === itemId ? { ...i, priority } : i)) } : w,
      );
    } catch (err) {
      setActionError(apiError(err));
    }
  };

  return (
    <Screen>
      <Header title={wishlist.title} />

      {/* Переключатель вишлистов (CLAUDE.md, 2026-10-02, "сделай 3 и
          названия для них") - тап по уже активной вкладке открывает
          переименование, а не повторную загрузку того же списка. */}
      <div style={{ display: "flex", gap: 12, overflowX: "auto", padding: "6px 16px 12px", margin: "-6px 0 0" }}>
        {myWishlists.map((w) => {
          const active = w.slug === wishlist.slug;
          return (
            <button
              key={w.slug}
              onClick={() => (active ? setNameSheet("rename") : switchTo(w.slug))}
              className="hit44"
              style={{
                flexShrink: 0,
                height: 34,
                padding: "0 14px",
                borderRadius: 999,
                border: active ? "none" : "1px solid var(--border)",
                background: active ? "var(--accent)" : "var(--surface)",
                color: active ? "var(--on-accent)" : "var(--text-secondary)",
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {w.title}
              {w.itemCount > 0 && ` · ${w.itemCount}`}
            </button>
          );
        })}
        {myWishlists.length < WISHLIST_LIMIT && (
          <button
            onClick={() => setNameSheet("create")}
            aria-label="Новый вишлист"
            className="hit44"
            style={{
              flexShrink: 0,
              height: 34,
              width: 34,
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--accent-text)",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            +
          </button>
        )}
      </div>

      {wishlist.occasionTitle && wishlist.occasionDate && (
        <button
          onClick={() => setCalendarOpen(true)}
          style={{
            margin: "0 16px 12px",
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--accent-soft)",
            border: "none",
            color: "var(--accent-text)",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "left",
          }}
        >
          🎉 {wishlist.occasionTitle} ·{" "}
          {formatOccasionDate(wishlist.occasionDate)}
        </button>
      )}

      {actionError && (
        <div style={{ padding: "0 16px 12px" }}>
          <ErrorBanner {...actionError} screen="my_wishlist" />
        </div>
      )}

      {wishlist.items.length === 0 && <ActionRow slug={wishlist.slug} onCalendar={() => {
            trackEvent("form_opened", { form: "calendar" });
            setCalendarOpen(true);
          }} />}

      {wishlist.items.length === 0 ? (
        <div
          style={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
            gap: 16,
            textAlign: "center",
          }}
        >
          <div className="font-display" style={{ fontSize: 18, fontWeight: 700 }}>Пока пусто</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 260 }}>
            Добавьте ссылку на первый подарок - и друзья увидят, что вам подарить
          </div>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              marginTop: 8,
              height: 48,
              padding: "0 24px",
              borderRadius: 14,
              background: "var(--accent)",
              color: "var(--on-accent)",
              fontSize: 15,
              fontWeight: 600,
              border: "none",
            }}
          >
            Добавить позицию
          </button>
        </div>
      ) : (
        <>
          <ProgressCard total={wishlist.items.length} done={boughtCount} />
          <ActionRow slug={wishlist.slug} onCalendar={() => {
            trackEvent("form_opened", { form: "calendar" });
            setCalendarOpen(true);
          }} />
          <div
            style={{
              flexGrow: 1,
              overflowY: "auto",
              padding: "0 12px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {sortedItems.map((item) => (
              <SwipeToDelete key={item.id} onDelete={() => deleteItem(item)}>
                {/* Аудит 2026-10-08, А-21: тап по карточке открывает экран
                    позиции (фото, "Посмотреть в магазине", статус) - раньше
                    у владельца карточка не открывалась вовсе. Звёздочка и
                    карандаш гасят всплытие клика. */}
                <div
                  role="link"
                  tabIndex={0}
                  aria-label={`Открыть: ${item.title ?? item.url}`}
                  onClick={() => navigate(`/item/${item.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate(`/item/${item.id}`);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: 12,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    opacity: item.status === "bought" ? 0.6 : 1,
                  }}
                >
                  <Thumbnail src={item.imageUrl} store={item.store} />
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      {item.title ?? item.url}
                    </div>
                    {/* QA-7: бейдж статуса - в строке с ценой, а не отдельной
                        колонкой справа: колонка съедала ширину, и название
                        ломалось по слову в строку, а цена - пополам. */}
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {item.price && (
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {formatRub(item.price)}
                        </span>
                      )}
                      <StoreBadge store={item.store} />
                      <StatusBadge status={item.status} />
                    </div>
                    <PayoutLabel item={item} />
                    {item.giverNames.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--accent-text)" }}>
                        {item.giverNames.length > 1 ? "Дарят: " : "Дарит: "}
                        {item.giverNames.join(", ")}
                      </div>
                    )}
                  </div>
                  {/* А-27: звёздочка и карандаш - по 44x44, вплотную друг к
                      другу и к краю карточки, чтобы название не сжималось. */}
                  <div style={{ display: "flex", flexShrink: 0, margin: "-6px -8px -6px -6px" }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <PriorityStar active={item.priority} editable onClick={() => togglePriority(item.id)} />
                  <button
                    onClick={() => {
                      trackEvent("form_opened", { form: "edit_item" });
                      setEditingItem(item);
                    }}
                    aria-label="Редактировать позицию"
                    style={{
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      borderRadius: 8,
                      background: "transparent",
                      border: "none",
                      color: "var(--text-secondary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  </div>
                </div>
              </SwipeToDelete>
            ))}
          </div>
        </>
      )}

      {wishlist.items.length > 0 && (
        <AddBar
          label="Добавить подарок"
          onClick={() => {
            trackEvent("form_opened", { form: "add_item" });
            setAddOpen(true);
          }}
        />
      )}

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Новая позиция" confirmClose>
        <AddItemForm
          slug={wishlist.slug}
          onAdded={(item) => {
            setWishlist((w) => (w ? { ...w, items: [...w.items, item] } : w));
            bumpItemCount(wishlist.slug, 1);
            setAddOpen(false);
          }}
        />
      </BottomSheet>

      <BottomSheet open={Boolean(editingItem)} onClose={() => setEditingItem(null)} title="Редактировать позицию" confirmClose>
        {editingItem && (
          <EditItemForm
            key={editingItem.id}
            item={editingItem}
            onSaved={(updated) => {
              setWishlist((w) =>
                w ? { ...w, items: w.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)) } : w,
              );
              setEditingItem(null);
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={calendarOpen} onClose={() => setCalendarOpen(false)} title="Календарь">
        <CalendarSheet
          slug={wishlist.slug}
          occasionTitle={wishlist.occasionTitle}
          occasionDate={wishlist.occasionDate}
          onSaved={(occasionTitle, occasionDate) =>
            setWishlist((w) => (w ? { ...w, occasionTitle, occasionDate } : w))
          }
        />
      </BottomSheet>

      <BottomSheet
        open={nameSheet !== null}
        onClose={() => setNameSheet(null)}
        title={nameSheet === "create" ? "Новый вишлист" : "Переименовать вишлист"}
      >
        {nameSheet && (
          <WishlistNameSheet
            initialTitle={nameSheet === "rename" ? wishlist.title : ""}
            submitLabel={nameSheet === "create" ? "Создать" : "Сохранить"}
            onSubmit={async (title) => {
              if (nameSheet === "create") {
                const created = await api.createWishlist(title);
                setMyWishlists((list) => [...list, { slug: created.slug, title: created.title, itemCount: 0 }]);
                localStorage.setItem(MY_SLUG_KEY, created.slug);
                const data = await api.getWishlist(created.slug);
                setWishlist(data);
              } else {
                await api.renameWishlist(wishlist.slug, title);
                setWishlist((w) => (w ? { ...w, title } : w));
                setMyWishlists((list) => list.map((w) => (w.slug === wishlist.slug ? { ...w, title } : w)));
              }
              setNameSheet(null);
            }}
          />
        )}
      </BottomSheet>

      {/* Кнопка "Собрать деньгами на подарок" убрана из итерации 1 -
          сузили скоуп 2026-09-29, деньги переехали в итерацию 2 (см.
          Продукт/роадмап-5-итераций.md). Роут /p/new и весь бэкенд под
          сбор в коде остались нетронутыми. */}
    </Screen>
  );
}

// Аудит 2026-10-08, А-13: подарок с дарителями удалять можно, но с
// предупреждением, сколько человек участвует, - бэкенд сообщит каждому из
// них (без имён других). Складчина до заполнения в API - "available",
// поэтому смотрим на contributorsCount, а не только на статус.
function peopleWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "человека" : "человек";
}

export function deleteConfirmText(item: Item): string {
  if (item.status === "bought") return "Этот подарок уже подарили - убрать его из списка? Дарителям писать не будем.";
  const n = item.contributorsCount;
  if (n === 0) return "Удалить этот подарок из вишлиста?";
  if (item.maxContributors > 1) {
    return `В складчине на этот подарок уже ${n === 1 ? "участвует" : "участвуют"} ${n} ${peopleWord(n)} - удалить? Мы сообщим им, что подарок удалён.`;
  }
  return "Этот подарок уже забронировал 1 человек - удалить? Мы сообщим ему, что подарок удалён и бронь снята.";
}

// ТЗ блок 4, п.5.2: "Поделиться" и "Повод" - крупными кнопками в зоне
// большого пальца, а не иконками в правом верхнем углу (там в полноэкранном
// режиме Telegram рисует свои "⌄ •••").
function ActionRow({ slug, onCalendar }: { slug: string; onCalendar: () => void }) {
  const base = {
    flex: 1,
    height: 46,
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
  } as const;
  return (
    <div style={{ display: "flex", gap: 10, padding: "0 16px 12px" }}>
      <Link to={`/w/${slug}/share`} style={{ ...base, background: "var(--accent)", color: "var(--on-accent)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M12 16V4M12 4l-4 4M12 4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Поделиться
      </Link>
      <button
        onClick={onCalendar}
        style={{ ...base, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent-text)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Повод и календарь
      </button>
    </div>
  );
}
