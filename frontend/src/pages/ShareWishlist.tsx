import { api, trackEvent } from "../api";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Header, PrimaryButton, Screen } from "../components/UI";
import { openTelegramLink } from "../telegram";

// Задачи-итерация-1.md, Ф8. Бот зарегистрирован в @BotFather 2026-10-01.
const BOT_USERNAME = "wishhdesk_bot";

// Аудит 2026-10-08, А-16: главный способ поделиться - "Отправить в
// Telegram" (выбор чата с готовым текстом через t.me/share/url), а не
// "скопировать → выйти → найти чат → вставить". Копирование осталось рядом.
export function shareUrl(link: string, title: string | null): string {
  const text = title
    ? `Мой вишлист «${title}» - посмотрите и забронируйте подарок, чтобы не совпасть с другими 🎁`
    : "Мой вишлист - посмотрите и забронируйте подарок, чтобы не совпасть с другими 🎁";
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

export function ShareWishlist() {
  const { slug = "" } = useParams();
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const link = `https://t.me/${BOT_USERNAME}?startapp=w_${slug}`;

  useEffect(() => {
    // Название списка - только для текста приглашения; без него текст общий.
    api
      .getWishlist(slug)
      .then((w) => setTitle(w.title))
      .catch(() => {});
  }, [slug]);

  const send = () => {
    trackEvent("share_sent");
    openTelegramLink(shareUrl(link, title));
  };

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
        <PrimaryButton onClick={send} style={{ width: "100%" }}>
          Отправить в Telegram
        </PrimaryButton>
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
