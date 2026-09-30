import { getInitData, getTelegramId } from "./telegram";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

// Беклог Б-4: раньше ошибка API долетала до компонента как голый текст
// ответа и никак не обрабатывалась - пользователь не видел вообще ничего.
// Код ошибки (`error` в теле ответа бэкенда) достаём отдельно, чтобы
// показать понятную фразу, а не сырой JSON.
const ERROR_MESSAGES: Record<string, string> = {
  item_not_available: "Позицию уже забронировали - обновите список",
  item_not_reserved: "Бронь уже снята",
  not_your_reservation: "Это не ваша бронь",
  cannot_reserve_own_item: "Нельзя бронировать собственный подарок",
  not_your_wishlist: "Это не ваш вишлист",
  wishlist_not_found: "Вишлист не найден",
  not_found: "Не найдено",
  validation_error: "Проверьте введённые данные",
  unauthorized: "Не удалось подтвердить вход через Telegram - перезапустите бота",
};

export function describeError(err: unknown): string {
  const code = err instanceof Error ? err.message : "";
  return ERROR_MESSAGES[code] ?? "Что-то пошло не так, попробуйте ещё раз";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Привязка логина через Telegram (2026-10-02) - бэкенд проверяет
      // подпись, а не верит telegramId в теле (см. auth/telegramAuth.ts).
      "X-Telegram-Init-Data": getInitData(),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? String(res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type ItemStatus = "available" | "reserved" | "bought";

export interface Item {
  id: string;
  url: string;
  title: string | null;
  price: number | null;
  imageUrl: string | null;
  status: ItemStatus;
}

export interface WishlistResponse {
  slug: string;
  items: Item[];
}

export interface PoolResponse {
  id: string;
  title: string;
  targetAmount: number | null;
  collected: number;
  deadline: string;
  status: "open" | "collected" | "expired";
  viewerIsOrganizer: boolean;
  contributions: { amount: number; createdAt: string }[];
}

export const api = {
  createWishlist: () =>
    request<{ id: string; slug: string }>("/api/wishlists", {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  getWishlist: (slug: string) =>
    request<WishlistResponse>(`/api/wishlists/${slug}`),

  getItem: (itemId: string) => request<Item>(`/api/items/${itemId}`),

  addItem: (slug: string, data: { url: string; title?: string; price?: number }) =>
    request<Item>(`/api/wishlists/${slug}/items`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  reserveItem: (itemId: string) =>
    request(`/api/items/${itemId}/reserve`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  markBought: (itemId: string) =>
    request(`/api/items/${itemId}/mark-bought`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId() }),
    }),

  createPool: (data: {
    title: string;
    occasionDate?: string;
    targetAmount?: number;
    durationDays: 7 | 14 | 30;
  }) =>
    request<{ id: string }>("/api/pools", {
      method: "POST",
      body: JSON.stringify({ ...data, telegramId: getTelegramId() }),
    }),

  getPool: (id: string) => {
    const telegramId = getTelegramId();
    const qs = telegramId ? `?telegramId=${telegramId}` : "";
    return request<PoolResponse>(`/api/pools/${id}${qs}`);
  },

  extendPool: (id: string) =>
    request<{ deadline: string }>(`/api/pools/${id}/extend`, {
      method: "POST",
      body: JSON.stringify({ days: 7 }),
    }),

  contribute: (id: string, amount: number) =>
    request(`/api/pools/${id}/contribute`, {
      method: "POST",
      body: JSON.stringify({ telegramId: getTelegramId(), amount }),
    }),
};
