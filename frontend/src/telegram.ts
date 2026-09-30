// Тонкая обвязка над window.Telegram.WebApp. Реализует Ф6 из
// Продукт/задачи-итерация-1.md: тема подхватывается от Telegram
// автоматически, ручного тумблера (как в дизайн-макете) в реальном
// приложении нет.

interface TelegramWebApp {
  initDataUnsafe: {
    start_param?: string;
    user?: { id: number; first_name: string; username?: string };
  };
  colorScheme: "light" | "dark";
  onEvent: (event: string, cb: () => void) => void;
  ready: () => void;
  expand: () => void;
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

export function initTelegram() {
  if (!webApp) {
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

// startapp=w_<slug> -> вишлист, startapp=p_<poolId> -> сбор.
// См. комментарий в backend/src/bot/bot.ts про механизм start_param.
export function getStartParam(): string | null {
  return webApp?.initDataUnsafe.start_param ?? null;
}

export function getMainButton() {
  return webApp?.MainButton ?? null;
}
