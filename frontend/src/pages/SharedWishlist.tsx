import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { absoluteApiUrl, api, describeError, type WishlistResponse } from "../api";
import { ErrorBanner, Header, PriorityStar, Screen, StatusBadge, StoreBadge, Thumbnail } from "../components/UI";

// Спека итерации 1, п.9 + флоу-итерация-1.md: первый переход по ссылке
// показывает приглашение, повторный - сразу список. Метка "видел ли уже"
// хранится локально у клиента - для MVP этого достаточно, точный учёт на
// бэкенде (по пользователю, не по устройству) можно добавить позже.

function seenKey(slug: string) {
  return `wishlistbot_seen_w_${slug}`;
}

export function SharedWishlist() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [wishlist, setWishlist] = useState<WishlistResponse | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setShowInvite(!localStorage.getItem(seenKey(slug)));
    api
      .getWishlist(slug)
      .then(setWishlist)
      .catch((err) => setError(describeError(err)));
  }, [slug]);

  // Беклог В-10: получатель, открывший свою же ссылку "Поделиться" (из
  // любопытства - проверить, как выглядит у друзей), видел экран
  // приглашения "чужого" человека - редиректим на свой редактируемый
  // вишлист вместо read-only чужого вида.
  useEffect(() => {
    if (wishlist?.isOwner) {
      navigate("/", { replace: true });
    }
  }, [wishlist, navigate]);

  const openList = () => {
    localStorage.setItem(seenKey(slug), "1");
    setShowInvite(false);
  };

  if (showInvite) {
    return (
      <Screen>
        <div
          style={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 14,
            textAlign: "center",
          }}
        >
          <div className="font-display" style={{ fontSize: 18, fontWeight: 700 }}>Вас пригласили</div>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", maxWidth: 280 }}>
            Можно посмотреть вишлист и забронировать подарок, чтобы не задвоить с другими
          </div>
        </div>
        <div style={{ padding: "12px 16px 20px" }}>
          <button
            onClick={openList}
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
            Открыть вишлист
          </button>
        </div>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <Header title="Вишлист" />
        <div style={{ padding: 20 }}>
          <ErrorBanner message={error} />
        </div>
      </Screen>
    );
  }

  if (!wishlist || wishlist.isOwner) return null;

  return (
    <Screen>
      <Header title={wishlist.title} />

      {/* Повод + "Добавить в календарь" (CLAUDE.md, 2026-10-02) - разовое
          скачивание .ics, без авторизации и подписки - см.
          components/CalendarSheet.tsx для версии владельца с личной
          подпиской. Роуты /calendar/giver и /calendar/organizer остаются
          в коде под итерацию 2 (завязаны на Pool - деньги). */}
      {wishlist.occasionTitle && wishlist.occasionDate && (
        <div
          style={{
            margin: "0 16px 12px",
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flexGrow: 1, fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
            🎉 {wishlist.occasionTitle} ·{" "}
            {new Date(wishlist.occasionDate).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
          </div>
          <a
            href={absoluteApiUrl(`/api/wishlists/${slug}/occasion.ics`)}
            style={{
              flexShrink: 0,
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              background: "var(--accent)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            В календарь
          </a>
        </div>
      )}

      <div style={{ flexGrow: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {[...wishlist.items].sort((a, b) => Number(b.priority) - Number(a.priority)).map((item) => (
          <Link
            key={item.id}
            to={`/item/${item.id}`}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
            }}
          >
            <Thumbnail src={item.imageUrl} />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{item.title ?? item.url}</div>
              <StoreBadge store={item.store} />
              {item.selfPurchased && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Уже куплено · перевод по СБП
                  {item.maxContributors > 1 && ` · скинулись ${item.contributorsCount} из ${item.maxContributors}`}
                </div>
              )}
            </div>
            <PriorityStar active={item.priority} editable={false} />
            <StatusBadge status={item.status} />
          </Link>
        ))}
      </div>
      {/* Кнопка "Собрать деньгами на подарок" убрана из итерации 1 - см.
          MyWishlist.tsx для того же примечания. */}
    </Screen>
  );
}
