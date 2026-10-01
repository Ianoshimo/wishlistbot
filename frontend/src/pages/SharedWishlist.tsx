import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, describeError, type WishlistResponse } from "../api";
import { ErrorBanner, Header, Screen, StatusBadge, Thumbnail } from "../components/UI";

// Спека итерации 1, п.9 + флоу-итерация-1.md: первый переход по ссылке
// показывает приглашение, повторный - сразу список. Метка "видел ли уже"
// хранится локально у клиента - для MVP этого достаточно, точный учёт на
// бэкенде (по пользователю, не по устройству) можно добавить позже.

function seenKey(slug: string) {
  return `wishlistbot_seen_w_${slug}`;
}

export function SharedWishlist() {
  const { slug = "" } = useParams();
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
          <div style={{ fontSize: 18, fontWeight: 700 }}>Вас пригласили</div>
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

  if (!wishlist) return null;

  return (
    <Screen>
      {/* Иконка календаря дарителя убрана из итерации 1 - см.
          Продукт/роадмап-5-итераций.md, роут /calendar/giver остаётся в
          коде под итерацию 2. */}
      <Header title="Вишлист" />
      <div style={{ flexGrow: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {wishlist.items.map((item) => (
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
              {item.selfPurchased && (
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Уже куплено · перевод по СБП</div>
              )}
            </div>
            <StatusBadge status={item.status} />
          </Link>
        ))}
      </div>
      {/* Кнопка "Собрать деньгами на подарок" убрана из итерации 1 - см.
          MyWishlist.tsx для того же примечания. */}
    </Screen>
  );
}
