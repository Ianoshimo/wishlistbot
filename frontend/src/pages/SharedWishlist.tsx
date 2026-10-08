import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { absoluteApiUrl, api, apiError, formatOccasionDate, formatRub, trackEvent, type UiError, type WishlistResponse } from "../api";
import { markStartParamHandled, openExternalLink } from "../telegram";
import { MY_SLUG_KEY } from "./MyWishlist";
import { ErrorBanner, Header, Loading, PayoutLabel, PriorityStar, Screen, StatusBadge, StoreBadge, Thumbnail, mineStatus } from "../components/UI";

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
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    trackEvent("screen_viewed", { screen: "shared_wishlist" });
    setShowInvite(!localStorage.getItem(seenKey(slug)));
    api
      .getWishlist(slug)
      .then(setWishlist)
      .catch((err) => setError(apiError(err)));
  }, [slug]);

  // Беклог В-10: получатель, открывший свою же ссылку "Поделиться" (из
  // любопытства - проверить, как выглядит у друзей), видел экран
  // приглашения "чужого" человека - редиректим на свой редактируемый
  // вишлист вместо read-only чужого вида.
  //
  // Аудит 2026-10-08, А-1: раньше "/" снова разбирал start_param и кидал
  // обратно сюда - бесконечная петля. Теперь start_param отмечен
  // обработанным, а владельцу открываем именно этот список (у него их
  // может быть до 3), а не тот, что был активен последним.
  useEffect(() => {
    if (wishlist?.isOwner) {
      markStartParamHandled();
      try {
        localStorage.setItem(MY_SLUG_KEY, wishlist.slug);
      } catch {
        // без localStorage MyWishlist сам возьмёт первый список владельца
      }
      navigate("/", { replace: true });
    }
  }, [wishlist, navigate]);

  // А-3: даритель, пришедший по ссылке, заводит свой список за один тап -
  // вирусная петля "получил ссылку -> завёл свой". "/" после этого
  // показывает свой список (start_param уже обработан, см. telegram.ts).
  const openOwnWishlist = () => {
    trackEvent("own_wishlist_cta_clicked", { from: "shared_wishlist" });
    markStartParamHandled();
    navigate("/", { state: { openOwn: true } });
  };

  const openList = () => {
    localStorage.setItem(seenKey(slug), "1");
    setShowInvite(false);
  };

  // QA-18: ошибка (несуществующий вишлист) и загрузка - раньше приглашения:
  // иначе по битой ссылке сначала звали "Открыть вишлист", а потом
  // показывали "не найден".
  if (error) {
    return (
      <Screen>
        <Header title="Вишлист" />
        <div style={{ padding: 20 }}>
          <ErrorBanner {...error} screen="shared_wishlist" />
        </div>
      </Screen>
    );
  }

  // А-29: скелетон, пока грузится (и пока владельца уводим в свой список).
  if (!wishlist || wishlist.isOwner) return <Loading />;

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
              color: "var(--on-accent)",
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
          <div style={{ flexGrow: 1, fontSize: 13, fontWeight: 600, color: "var(--accent-text)" }}>
            🎉 {wishlist.occasionTitle} ·{" "}
            {formatOccasionDate(wishlist.occasionDate)}
          </div>
          <a
            href={absoluteApiUrl(`/api/wishlists/${slug}/occasion.ics`)}
            onClick={(e) => {
              e.preventDefault();
              trackEvent("calendar_add_clicked");
              openExternalLink(absoluteApiUrl(`/api/wishlists/${slug}/occasion.ics`));
            }}
            className="hit44"
            style={{
              flexShrink: 0,
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              background: "var(--accent)",
              color: "var(--on-accent)",
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
            state={{ from: `/w/${slug}` }}
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
            <Thumbnail src={item.imageUrl} store={item.store} />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{item.title ?? item.url}</div>
              {/* QA-9: цена в списке и у дарителя - выбирать подарок под
                  бюджет, не открывая каждую карточку. */}
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {item.price && (
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {formatRub(item.price)}
                  </span>
                )}
                <StoreBadge store={item.store} />
                {/* А-30: своя бронь/доля - своим бейджем. */}
                <StatusBadge status={item.status} mine={mineStatus(item)} />
              </div>
              <PayoutLabel item={item} />
            </div>
            <PriorityStar active={item.priority} editable={false} />
          </Link>
        ))}
      </div>
      <div style={{ padding: "4px 16px 20px", flexShrink: 0 }}>
        <button
          onClick={openOwnWishlist}
          style={{
            width: "100%",
            minHeight: 50,
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--accent-text)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Хочу такой же вишлист
        </button>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "center", marginTop: 8 }}>
          Соберите свой список желаний - и друзья будут знать, что вам подарить
        </div>
      </div>
      {/* Кнопка "Собрать деньгами на подарок" убрана из итерации 1 - см.
          MyWishlist.tsx для того же примечания. */}
    </Screen>
  );
}
