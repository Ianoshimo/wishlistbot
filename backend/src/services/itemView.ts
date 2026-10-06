import type { GiftShare, Item, User } from "@prisma/client";
import { db } from "../db.js";
import { resolveExpiredReservation } from "./reservation.js";
import { detectStore } from "./linkPreview.js";

type GiftShareWithUser = GiftShare & { user: User };
type ItemWithReservedBy = Item & { reservedBy: User | null };

// Единая точка чтения позиции, учитывающая оба режима брони:
// - обычный (один даритель на позицию, Item.reservedByUserId + TTL - см.
//   services/reservation.ts, не тронуто);
// - "скинуться на подарок" (Item.maxContributors > 1, CLAUDE.md,
//   2026-10-02) - несколько отдельных долей в GiftShare, без TTL в v1
//   (см. комментарий у GiftShare в schema.prisma).
//
// reservedBy/giftShares.user подгружаются всегда (а не только когда
// реально кто-то раскрылся) - дешёвый join, а serializeItemView сам
// решает, кому и когда отдавать имя (см. "Дарить неанонимно" там же).
export async function resolveItem(
  itemId: string,
): Promise<ItemWithReservedBy & { giftShares: GiftShareWithUser[] }> {
  // resolveExpiredReservation трогает только classic-бронь
  // (reservationTtl == null для позиций со "скинуться" - условие там
  // просто не сработает), поэтому безопасно вызывать для обоих режимов.
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

// sbpPhone передаётся отдельно (не берётся из item) - это реквизит
// владельца вишлиста, а не самой позиции, см. User.sbpPhone.
//
// Находка Н-1 полного QA-прогона (2026-10-01): номер отдаётся строго
// держателю брони - для "скинуться" это означает каждому из долевых
// дарителей по отдельности, не только первому.
export function serializeItemView(
  item: ItemWithReservedBy,
  giftShares: GiftShareWithUser[],
  ownerSbpPhone: string | null,
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

  if (isSplit) {
    contributorsCount = giftShares.length;
    const mine = viewerUserId ? giftShares.find((s) => s.userId === viewerUserId) : undefined;
    reservedByMe = Boolean(mine);
    paidByMe = Boolean(mine?.paid);
    giverNames = isOwnerViewer
      ? giftShares.filter((s) => s.visible).map((s) => giverLabel(s.user))
      : [];
  } else {
    contributorsCount = item.reservedByUserId ? 1 : 0;
    reservedByMe = Boolean(viewerUserId && item.reservedByUserId === viewerUserId);
    paidByMe = reservedByMe && item.status === "bought";
    giverNames =
      isOwnerViewer && item.reservedByVisible && item.reservedBy ? [giverLabel(item.reservedBy)] : [];
  }

  return {
    id: item.id,
    url: item.url,
    title: item.title,
    price: item.price,
    imageUrl: item.imageUrl,
    status: item.status,
    selfPurchased: item.selfPurchased,
    sbpPhone: item.selfPurchased && reservedByMe ? ownerSbpPhone : null,
    reservedByMe,
    priority: item.priority,
    store: detectStore(item.url),
    maxContributors: item.maxContributors,
    contributorsCount,
    paidByMe,
    giverNames,
    // reservedByUserId/giftShares.userId сознательно не отдаются наружу
    // в сыром виде - п.2 спеки: анонимность по умолчанию. giverNames -
    // единственная контролируемая лазейка, и то только когда даритель
    // сам её открыл (reservedByVisible/GiftShare.visible) и смотрит
    // именно владелец вишлиста (см. isOwnerViewer выше).
  };
}
