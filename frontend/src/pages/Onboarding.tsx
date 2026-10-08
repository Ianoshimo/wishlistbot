import { trackEvent } from "../api";
import { APP_NAME } from "../brand";
// Спека итерации 1, п.6: первый запуск без своего вишлиста и без чужой
// ссылки. Отдельный от MyWishlist компонент - в отличие от пустого
// вишлиста (0 позиций, но вишлист уже создан), здесь ещё нет даже своего
// вишлиста.
export function Onboarding({ onStart }: { onStart: () => void }) {
  const points = [
    "Собирайте вишлист — добавляйте ссылки на подарки с любых магазинов",
    "Бронируйте без задвоений — друзья сразу видят, что уже занято",
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
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
        <div className="font-display" style={{ fontSize: 20, fontWeight: 700 }}>{APP_NAME}</div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Дарите не гадая</div>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 12, textAlign: "left" }}>
          {points.map((text) => (
            <div
              key={text}
              style={{ padding: 14, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, fontSize: 14, lineHeight: 1.4 }}
            >
              {text}
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 16px 20px" }}>
        <button
          onClick={() => {
            trackEvent("onboarding_create_clicked");
            onStart();
          }}
          style={{ width: "100%", height: 50, borderRadius: 14, background: "var(--accent)", color: "var(--on-accent)", fontSize: 15, fontWeight: 600, border: "none" }}
        >
          Создать свой вишлист
        </button>
      </div>
    </div>
  );
}
