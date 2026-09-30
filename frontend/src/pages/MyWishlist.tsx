import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, describeError, type WishlistResponse } from "../api";
import { ErrorBanner, Header, Screen, StatusBadge } from "../components/UI";

// Спека итерации 1, п.1 + п.7: вишлист получателя со списком позиций и
// отдельным пустым состоянием. В макете это два артборда (Main/Empty) -
// здесь один компонент с условным рендером, это один и тот же URL для
// реального пользователя.

export const MY_SLUG_KEY = "wishlistbot_my_slug";

export function MyWishlist() {
  const [wishlist, setWishlist] = useState<WishlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      try {
        let slug = localStorage.getItem(MY_SLUG_KEY);
        if (!slug) {
          const created = await api.createWishlist();
          slug = created.slug;
          localStorage.setItem(MY_SLUG_KEY, slug);
        }
        const data = await api.getWishlist(slug);
        setWishlist(data);
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return null;
  if (error) {
    return (
      <Screen>
        <Header title="Мой вишлист" />
        <div style={{ padding: 20 }}>
          <ErrorBanner message={error} />
        </div>
      </Screen>
    );
  }
  if (!wishlist) return null;

  const boughtCount = wishlist.items.filter((i) => i.status === "bought").length;

  return (
    <Screen>
      <Header
        title="Мой вишлист"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {/* Иконка календаря убрана из итерации 1 вместе со сбором -
                см. Продукт/роадмап-5-итераций.md, роут /calendar остаётся
                в коде под итерацию 2. */}
            <Link
              to={`/w/${wishlist.slug}/share`}
              aria-label="Поделиться"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 16V4M12 4l-4 4M12 4l4 4M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link
              to={`/w/${wishlist.slug}/add`}
              aria-label="Добавить позицию"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Link>
          </div>
        }
      />

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
          <div style={{ fontSize: 18, fontWeight: 700 }}>Пока пусто</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 260 }}>
            Добавьте ссылку на первый подарок - и друзья увидят, что вам подарить
          </div>
          <button
            onClick={() => navigate(`/w/${wishlist.slug}/add`)}
            style={{
              marginTop: 8,
              height: 48,
              padding: "0 24px",
              borderRadius: 14,
              background: "var(--accent)",
              color: "#ffffff",
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
          <div style={{ fontSize: 13, color: "var(--text-secondary)", padding: "0 16px" }}>
            {wishlist.items.length} позиции · {boughtCount} куплено
          </div>
          <div
            style={{
              flexGrow: 1,
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {wishlist.items.map((item) => (
              <div
                key={item.id}
                style={{
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
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {item.title ?? item.url}
                  </div>
                  {item.price && (
                    <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      {(item.price / 100).toFixed(0)} ₽
                    </div>
                  )}
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Кнопка "Собрать деньгами на подарок" убрана из итерации 1 -
          сузили скоуп 2026-09-29, деньги переехали в итерацию 2 (см.
          Продукт/роадмап-5-итераций.md). Роут /p/new и весь бэкенд под
          сбор в коде остались нетронутыми. */}
    </Screen>
  );
}
