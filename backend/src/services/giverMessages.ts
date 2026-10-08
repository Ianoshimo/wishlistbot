// Сообщения бота ДАРИТЕЛЮ (аудит 2026-10-08): напоминание о брони (А-14),
// спасибо за отметку покупки/перевода (А-14), подарок удалён (А-13).
// Чистые функции - тексты покрыты юнит-тестами (giverMessages.test.ts).
//
// Анонимность (п.2 спеки): одному дарителю никогда не называем других
// дарителей - только число участников складчины. Имя владельца списка
// дарителю и так известно (он пришёл по его ссылке).

import { quote } from "./purchaseNotice.js";

export type GiverPayout = "sbp" | "fundraiser" | null;

export interface GiftContext {
  itemTitle: string | null;
  wishlistTitle: string;
  // Имя владельца списка (User.firstName) - может быть пустым.
  ownerName: string;
}

function gift(c: GiftContext): string {
  return c.itemTitle?.trim() ? quote(c.itemTitle) : "без названия";
}

function list(c: GiftContext): string {
  const owner = c.ownerName.trim();
  return `из списка ${quote(c.wishlistTitle)}${owner ? ` (${owner})` : ""}`;
}

export function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

export function peopleWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "человека";
  return "человек";
}

// Целых суток до снятия брони, округление вверх (как "снимется через N
// дней" на экране подарка).
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
}

function whenText(days: number): string {
  return days <= 1 ? "меньше чем через сутки" : `через ${days} ${daysWord(days)}`;
}

function markWhat(payout: GiverPayout): string {
  return payout ? "перевод" : "покупку";
}

export interface ReminderInput extends GiftContext {
  payoutMethod: GiverPayout;
  split: boolean;
  days: number;
}

export function reminderText(i: ReminderInput): string {
  const what = i.split ? "Вы участвуете в складчине на подарок" : "Вы забронировали подарок";
  const action =
    i.payoutMethod === "sbp"
      ? i.split
        ? "Переведите свою часть по СБП и нажмите «Деньги отправлены»"
        : "Переведите деньги по СБП и нажмите «Деньги отправлены»"
      : i.payoutMethod === "fundraiser"
        ? "Переведите деньги в сбор и отметьте это в мини-аппе"
        : "Купите подарок и нажмите «Отметить купленным»";
  const place = i.split ? "Место" : "Бронь";
  return (
    `⏰ ${what} ${gift(i)} ${list(i)}.\n\n` +
    `${action}. ${place} снимется ${whenText(i.days)}, если не отметить ${markWhat(i.payoutMethod)}.`
  );
}

export function giverThanksText(i: GiftContext & { payoutMethod: GiverPayout }): string {
  return i.payoutMethod
    ? `🎉 Перевод за подарок ${gift(i)} ${list(i)} отмечен - спасибо! Получатель узнает, что деньги отправлены (но не узнает, от кого, если вы не открылись).`
    : `🎉 Подарок ${gift(i)} ${list(i)} отмечен купленным - спасибо! Получатель узнает, что подарок куплен (но не узнает, кем, если вы не открылись).`;
}

export function shareThanksText(i: GiftContext & { paid: number; total: number }): string {
  return `🙌 Ваша часть на подарок ${gift(i)} ${list(i)} отмечена - спасибо! Ждём остальных: отметили ${i.paid} из ${i.total}.`;
}

export function giftCompletedText(i: GiftContext): string {
  return `🎉 Подарок ${gift(i)} ${list(i)} собран - все участники отметили свою часть. Спасибо!`;
}

export function itemDeletedText(i: GiftContext & { split: boolean; paidByGiver: boolean }): string {
  const what = i.split ? "ваше место в складчине снято" : "ваша бронь снята";
  const money = i.paidByGiver
    ? "\n\nВы отметили, что уже перевели деньги, - если их нужно вернуть, напишите получателю напрямую."
    : "";
  return `😔 Получатель удалил подарок ${gift(i)} ${list(i)} - ${what}.${money}`;
}
