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
  openTelegramLink?: (url: string) => void;
  requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
  platform?: string;
  version?: string;
  isFullscreen?: boolean;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
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

// Аудит 2026-10-08, А-1/А-3: start_param живёт всю сессию мини-аппа, а
// Home разбирал его при КАЖДОМ монтировании "/". Владелец по своей ссылке
// уходил в петлю /w/<slug> -> "/" -> /w/<slug> (сотни запросов в секунду),
// даритель не мог попасть в свой список - "/" снова кидал на чужой.
// Теперь переход по start_param - один раз за сессию: флаг в
// sessionStorage (на случай перезагрузки страницы) плюс модульная
// переменная (если sessionStorage недоступен). Флаг хранит сам параметр -
// новый запуск с другой ссылкой в том же WebView обработается заново.
const START_HANDLED_KEY = "wishlistbot_start_param_handled";
let startHandledInMemory: string | null = null;

function startParamHandled(param: string): boolean {
  if (startHandledInMemory === param) return true;
  try {
    return sessionStorage.getItem(START_HANDLED_KEY) === param;
  } catch {
    return false;
  }
}

// Куда перейти по start_param при открытии "/" - или null, если перехода
// нет или он уже был в этой сессии. Чистая функция, без побочных эффектов
// (её можно звать в рендере); отметку ставит markStartParamHandled.
// p_<poolId> (сборы итерации 2) не обрабатывается, пока итерация 2
// выключена (А-2).
export function pendingStartRedirect(): string | null {
  const param = getStartParam();
  if (!param || startParamHandled(param)) return null;
  if (param.startsWith("w_") && param.length > 2) return `/w/${param.slice(2)}`;
  return null;
}

export function markStartParamHandled(): void {
  const param = getStartParam();
  if (!param) return;
  startHandledInMemory = param;
  try {
    sessionStorage.setItem(START_HANDLED_KEY, param);
  } catch {
    // приватный режим/запрет хранилища - хватит модульной переменной
  }
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

// Аудит 2026-10-08, А-16: ссылка t.me (например, t.me/share/url - выбор
// чата для отправки) внутри Telegram открывается нативно, без выхода из
// мини-аппа; вне Telegram - в новой вкладке.
export function openTelegramLink(url: string) {
  if (isRealTelegram && webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

// Аудит 2026-10-08, А-14: бот может написать человеку, только если тот
// запускал бота или разрешил сообщения. Даритель часто приходит сразу по
// ссылке на вишлист, минуя /start - после брони просим разрешение, чтобы
// дошли напоминания и "спасибо". Telegram сам не спрашивает повторно,
// если доступ уже есть. Тихо ничего не делает вне Telegram и на старых
// клиентах (Bot API < 6.9).
export function requestBotMessages(): void {
  if (!isRealTelegram || !webApp?.requestWriteAccess) return;
  if (webApp.isVersionAtLeast && !webApp.isVersionAtLeast("6.9")) return;
  try {
    webApp.requestWriteAccess();
  } catch {
    // старый клиент - напоминания просто не дойдут, бронь работает
  }
}

export function isInsideTelegram(): boolean {
  return isRealTelegram;
}

// ТЗ блок 4, п.5.3: в полноэкранном режиме левый верхний угол занимает
// "Закрыть" Telegram - "Назад" внутри Telegram показываем нативной кнопкой
// клиента, а не стрелкой в шапке. Возвращает функцию снятия обработчика.
export function showTelegramBackButton(onBack: () => void): () => void {
  const bb = isRealTelegram ? webApp?.BackButton : undefined;
  if (!bb) return () => {};
  bb.onClick(onBack);
  bb.show();
  return () => {
    bb.offClick(onBack);
    bb.hide();
  };
}

// Свойства события "приложение открыто" (ТЗ блок 4, логи) - без
// идентичности пользователя, только окружение.
export function appOpenedProps(): Record<string, string | number | boolean> {
  const start = getStartParam();
  return {
    insideTelegram: isRealTelegram,
    platform: webApp?.platform ?? "web",
    tgVersion: webApp?.version ?? "",
    startKind: start?.startsWith("w_") ? "wishlist" : start?.startsWith("p_") ? "pool" : start ? "other" : "none",
    colorScheme: webApp?.colorScheme ?? "",
    fullscreen: Boolean(webApp?.isFullscreen),
  };
}
