import type { GiftShare, Item, User } from "@prisma/client";
import { db } from "../db.js";
import { giftShareDeadline, resolveExpiredReservation } from "./reservation.js";
import { detectStore } from "./linkPreview.js";

type GiftShareWithUser = GiftShare & { user: User };
type ItemWithReservedBy = Item & { reservedBy: User | null };

// Единая точка чтения позиции, учитывающая оба режима брони:
// - обычный (один даритель на позицию, Item.reservedByUserId + TTL - см.
//   services/reservation.ts, не тронуто);
// - "скинуться на подарок" (Item.maxContributors > 1, CLAUDE.md,
//   2026-10-02) - несколько отдельных долей в GiftShare; с 2026-10-07 у
//   неоплаченной доли тот же TTL, что у брони (см. reservation.ts,
//   resolveExpiredGiftShares).
//
// reservedBy/giftShares.user подгружаются всегда (а не только когда
// реально кто-то раскрылся) - дешёвый join, а serializeItemView сам
// решает, кому и когда отдавать имя (см. "Дарить неанонимно" там же).
export async function resolveItem(
  itemId: string,
): Promise<ItemWithReservedBy & { giftShares: GiftShareWithUser[] }> {
  // resolveExpiredReservation сама различает режимы: classic-бронь
  // снимается по reservationTtl, в "скинуться" - просроченные
  // неоплаченные доли (reservationTtl там всегда null).
  await resolveExpiredReservation(itemId);

  const item = await db.item.findUniqueOrThrow({
    where: { id: itemId },
    include: { reservedBy: true },
  });
  const giftShares =
    item.maxContributors > 1
      ? await db.giftShare.findMany({ where: { itemId }, include: { user: true } })
      : [];
  return { ...item, giftShares };
}

function giverLabel(user: User): string {
  return user.username ? `${user.firstName} (@${user.username})` : user.firstName;
}

// Находка Н-1 полного QA-прогона (2026-10-01): номер отдаётся строго
// держателю брони - для "скинуться" это означает каждому из долевых
// дарителей по отдельности, не только первому. С аудита 2026-10-08 (А-5)
// реквизиты (номер, банк, ссылка на сбор) живут на самом подарке
// (Item.sbpPhone/sbpBank/fundraiserUrl), видят их держатель брони/доли и
// владелец (ему - для формы правки).
export function serializeItemView(
  item: ItemWithReservedBy,
  giftShares: GiftShareWithUser[],
  viewerUserId: string | null,
  // "Дарить неанонимно" (CLAUDE.md, 2026-10-02) - выбор дарителя, не
  // получателя, но раскрывается имя только самому получателю (владельцу
  // вишлиста), не всем подряд, кто открыл ссылку - иначе это была бы
  // публичная доска, а не подарок конкретному человеку.
  isOwnerViewer = false,
) {
  const isSplit = item.maxContributors > 1;

  let reservedByMe: boolean;
  let paidByMe: boolean;
  let contributorsCount: number;
  let giverNames: string[];
  // Когда снимется бронь/доля зрителя, если он не отметит покупку/перевод
  // - только самому держателю, остальным null.
  let reservationExpiresAt: Date | null = null;

  if (isSplit) {
    contributorsCount = giftShares.length;
    const mine = viewerUserId ? giftShares.find((s) => s.userId === viewerUserId) : undefined;
    reservedByMe = Boolean(mine);
    paidByMe = Boolean(mine?.paid);
    if (mine && !mine.paid && item.status !== "bought") reservationExpiresAt = giftShareDeadline(mine.createdAt);
    giverNames = isOwnerViewer
      ? giftShares.filter((s) => s.visible).map((s) => giverLabel(s.user))
      : [];
  } else {
    contributorsCount = item.reservedByUserId ? 1 : 0;
    reservedByMe = Boolean(viewerUserId && item.reservedByUserId === viewerUserId);
    paidByMe = reservedByMe && item.status === "bought";
    if (reservedByMe && item.status === "reserved") reservationExpiresAt = item.reservationTtl;
    giverNames =
      isOwnerViewer && item.reservedByVisible && item.reservedBy ? [giverLabel(item.reservedBy)] : [];
  }

  // QA-11: в "скинуться" позиция остаётся "available" в БД, пока не
  // оплатили все - но когда все доли уже разобраны, для зрителя она занята,
  // а не "Свободно".
  const status = isSplit && item.status !== "bought" && contributorsCount >= item.maxContributors ? "reserved" : item.status;
  const canSeeDetails = reservedByMe || isOwnerViewer;

  return {
    id: item.id,
    url: item.url,
    title: item.title,
    price: item.price,
    imageUrl: item.imageUrl,
    status,
    // QA-10: владелец, попавший на экран своей позиции по прямой ссылке, не
    // должен видеть "Забронировать". Только булево - не раскрывает ничего
    // сверх того, что зритель и так знает о себе.
    viewerIsOwner: isOwnerViewer,
    selfPurchased: item.selfPurchased,
    // А-5: способ получить деньги виден всем (дарителю нужно знать, что
    // это подарок деньгами), реквизиты - только держателю брони/доли и
    // владельцу.
    payoutMethod: item.payoutMethod,
    sbpPhone: item.payoutMethod === "sbp" && canSeeDetails ? item.sbpPhone : null,
    sbpBank: item.payoutMethod === "sbp" && canSeeDetails ? item.sbpBank : null,
    hasFundraiser: item.payoutMethod === "fundraiser",
    fundraiserUrl: item.payoutMethod === "fundraiser" && canSeeDetails ? item.fundraiserUrl : null,
    reservedByMe,
    priority: item.priority,
    store: detectStore(item.url),
    maxContributors: item.maxContributors,
    contributorsCount,
    paidByMe,
    reservationExpiresAt,
    giverNames,
    // reservedByUserId/giftShares.userId сознательно не отдаются наружу
    // в сыром виде - п.2 спеки: анонимность по умолчанию. giverNames -
    // единственная контролируемая лазейка, и то только когда даритель
    // сам её открыл (reservedByVisible/GiftShare.visible) и смотрит
    // именно владелец вишлиста (см. isOwnerViewer выше).
  };
}
