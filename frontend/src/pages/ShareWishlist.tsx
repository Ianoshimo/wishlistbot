import { trackEvent } from "../api";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Header, Screen } from "../components/UI";

// Задачи-итерация-1.md, Ф8. Бот зарегистрирован в @BotFather 2026-10-01.
const BOT_USERNAME = "wishhdesk_bot";

export function ShareWishlist() {
  const { slug = "" } = useParams();
  const [copied, setCopied] = useState(false);
  const link = `https://t.me/${BOT_USERNAME}?startapp=w_${slug}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    trackEvent("share_link_copied");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen>
      <Header title="Поделиться" backTo={`/w/${slug}`} />
      <div style={{ padding: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className="font-display" style={{ fontSize: 18, fontWeight: 700 }}>Вишлист готов</div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", textAlign: "center", maxWidth: 280 }}>
          Отправьте ссылку друзьям - они увидят список и смогут забронировать подарок
        </div>
        <div style={{ width: "100%", padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flexGrow: 1, fontSize: 13, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {link}
          </div>
          <button
            onClick={copy}
            style={{ height: 32, padding: "0 10px", borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", border: "none", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
          >
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      </div>
    </Screen>
  );
}
