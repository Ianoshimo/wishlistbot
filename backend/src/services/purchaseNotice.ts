// Аудит 2026-10-08, А-12: уведомление получателю "подарок куплен" раньше
// было безличным ("Один из подарков ... отмечен как купленный") - при
// нескольких покупках и кнопках "Поблагодарить" было непонятно, о каком
// подарке речь, а для "уже купил сам" это вообще перевод денег, а не
// покупка. Теперь в тексте название подарка и списка, текст зависит от
// способа подарить. Личность дарителя по-прежнему НЕ раскрывается (п.2
// спеки) - в тексте нет ни имени, ни числа конкретных людей поимённо.

const MAX_TITLE = 80;

export function quote(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return `«${t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1).trimEnd() + "…" : t}»`;
}

export interface PurchaseNoticeInput {
  itemTitle: string | null;
  wishlistTitle: string;
  // А-5: текст зависит от способа получить деньги, а не от "уже купил сам".
  payoutMethod: "sbp" | "fundraiser" | null;
  split: boolean;
}

export function purchaseNoticeText(i: PurchaseNoticeInput): string {
  const gift = i.itemTitle?.trim() ? quote(i.itemTitle) : "без названия";
  const giftPart = i.itemTitle?.trim() ? `за ${gift}` : "за подарок без названия";
  const list = `из списка ${quote(i.wishlistTitle)}`;
  if (i.payoutMethod === "fundraiser") {
    return i.split
      ? `💸 Все участники скинулись ${giftPart} ${list} через сбор в банке - проверьте сбор в приложении банка.`
      : `💸 Вам перевели деньги ${giftPart} ${list} через сбор в банке - проверьте сбор в приложении банка.`;
  }
  if (i.payoutMethod === "sbp") {
    return i.split
      ? `💸 Все участники складчины перевели деньги ${giftPart} ${list} - проверьте поступления в банке.`
      : `💸 Вам перевели деньги ${giftPart} ${list} - проверьте поступление в банке.`;
  }
  const name = i.itemTitle?.trim() ? `Подарок ${gift}` : "Подарок без названия";
  return `🎁 ${name} ${list} отмечен как купленный.`;
}
