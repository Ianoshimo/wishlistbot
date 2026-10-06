// Тонкая обвязка над window.Telegram.WebApp. Реализует Ф6 из
// Продукт/задачи-итерация-1.md: тема подхватывается от Telegram
// автоматически, ручного тумблера (как в дизайн-макете) в реальном
// приложении нет.

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    start_param?: string;
    user?: { id: number; first_name: string; username?: string };
  };
  colorScheme: "light" | "dark";
  onEvent: (event: string, cb: () => void) => void;
  ready: () => void;
  expand: () => void;
  openLink?: (url: string) => void;
  MainButton: {
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

const webApp = window.Telegram?.WebApp;

// Беклог Н-7 (полный QA-прогон 2026-10-01): скрипт telegram-web-app.js
// безусловно создаёт window.Telegram.WebApp даже вне настоящего Telegram
// (заглушка) - поэтому проверка "есть ли webApp" сама по себе не отличает
// реальный клиент от обычного браузера. initData у заглушки всегда
// пустая строка, у настоящего Telegram - всегда непустая (см. тот же
// принцип уже в getTelegramId/getInitData ниже).
const isRealTelegram = Boolean(webApp?.initData);

export function initTelegram() {
  if (!webApp || !isRealTelegram) {
    // Локальная разработка вне Телеграма - используем системную тему как
    // приближение, чтобы вёрстка была видна без реального клиента.
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    return;
  }

  webApp.ready();
  webApp.expand();
  document.documentElement.setAttribute("data-theme", webApp.colorScheme);
  webApp.onEvent("themeChanged", () => {
    document.documentElement.setAttribute("data-theme", webApp.colorScheme);
  });
}

const DEV_ID_KEY = "wishlistbot_dev_telegram_id";

// Вне Телеграма (обычный браузер, локальная разработка) настоящего
// telegramId нет - держим один случайный id на вкладку браузера, чтобы
// можно было реально пройти флоу без запуска внутри Telegram. В проде
// (внутри Telegram) webApp всегда даёт настоящий id, эта ветка не
// используется.
export function getTelegramId(): string | null {
  // Реальный window.Telegram.WebApp существует и вне Телеграма (скрипт
  // telegram-web-app.js отдаёт заглушку-объект в обычном браузере), но
  // initDataUnsafe.user там пуст - поэтому проверяем именно наличие id,
  // а не сам факт существования webApp.
  const id = webApp?.initDataUnsafe.user?.id;
  if (id) return String(id);

  let devId = localStorage.getItem(DEV_ID_KEY);
  if (!devId) {
    devId = String(900000000 + Math.floor(Math.random() * 99999999));
    localStorage.setItem(DEV_ID_KEY, devId);
  }
  return devId;
}

// Привязка логина через Telegram (2026-10-02): сырая подписанная строка
// initData уходит на бэкенд заголовком на каждый запрос - там проверяется
// HMAC-подпись (см. backend/src/auth/telegramAuth.ts), а не просто
// телеграмовский user.id, которому раньше доверяли без проверки. Вне
// настоящего Telegram строка пустая - бэкенд в дев-режиме падает обратно
// на telegramId из тела запроса (см. getTelegramId выше).
export function getInitData(): string {
  return webApp?.initData ?? "";
}

// startapp=w_<slug> -> вишлист, startapp=p_<poolId> -> сбор.
// См. комментарий в backend/src/bot/bot.ts про механизм start_param.
export function getStartParam(): string | null {
  return webApp?.initDataUnsafe.start_param ?? null;
}

export function getMainButton() {
  return webApp?.MainButton ?? null;
}

// Внутри WebView Telegram (особенно Android) обычный <a href> на внешний
// файл/календарь часто просто ничего не делает - внешние ссылки нужно
// открывать через WebApp.openLink (только http/https). Вне Telegram -
// обычная навигация.
export function openExternalLink(url: string, httpFallback?: string) {
  const insideTelegram = Boolean(webApp?.initData && webApp.openLink);
  if (insideTelegram) {
    const target = /^https?:/i.test(url) ? url : httpFallback;
    if (target) {
      webApp!.openLink!(target);
      return;
    }
  }
  window.location.href = url;
}
