import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api, apiError, formatRub, trackEvent, type Item, type UiError } from "../api";
import { openExternalLink, requestBotMessages } from "../telegram";
import { BottomSheet, CopyRow, ErrorBanner, Header, Loading, PrimaryButton, Screen, StoreBadge, Thumbnail } from "../components/UI";
import { formatPhone, normalizePhone } from "../phone";
import { GiverCalendarPrompt } from "../components/CalendarSheet";

// Спека итерации 1, п.2-3: полный жизненный цикл брони в одном экране,
// как в дизайн-макете (артборд ItemDetail) - available → reserved → bought.

export function ItemDetail() {
  const { itemId = "" } = useParams();
  const location = useLocation();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  // СБП-карточка - bottom sheet вместо отдельной страницы (CLAUDE.md,
  // 2026-10-01) - открывается сама сразу после брони, и повторно по кнопке.
  const [sbpSheetOpen, setSbpSheetOpen] = useState(false);
  // "Дарить неанонимно" (CLAUDE.md, 2026-10-02) - выбор дарителя в
  // момент брони, по умолчанию анонимно (как раньше). Нельзя передумать
  // после брони - решение фиксируется один раз, см. reserve() ниже.
  const [revealIdentity, setRevealIdentity] = useState(false);

  // QA-17: позиция могла быть удалена владельцем (или ссылка битая) -
  // раньше экран оставался полностью пустым без навигации.
  const [loadError, setLoadError] = useState<UiError | null>(null);
  const reload = () =>
    api
      .getItem(itemId)
      .then(setItem)
      .catch((err) => setLoadError(apiError(err)));

  // QA блока 4, QB4-1: "Назад" (стрелка вне Telegram и нативная кнопка
  // внутри) раньше всегда вёл на "/" - даритель из чужого вишлиста попадал
  // в свой список или на онбординг и терял список друга. Теперь - в
  // вишлист позиции (slug из ответа API, работает и при заходе по прямой
  // ссылке без истории); владельцу - в свой список. Пока позиция не
  // загрузилась (или удалена) - туда, откуда открыли (state ссылки из
  // SharedWishlist).
  const fromState = (location.state as { from?: string } | null)?.from;
  const backTo = item
    ? item.viewerIsOwner || !item.wishlistSlug
      ? "/"
      : `/w/${item.wishlistSlug}`
    : fromState ?? "/";
  useEffect(() => {
    void reload();
    trackEvent("screen_viewed", { screen: "item" });
  }, [itemId]);

  if (loadError && !item) {
    return (
      <Screen>
        <Header title="Подарок" backTo={backTo} />
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <ErrorBanner
            code={loadError.code}
            screen="item"
            message="Подарок не найден — возможно, получатель удалил его из вишлиста."
          />
        </div>
      </Screen>
    );
  }
  // А-29: скелетон вместо пустого фона.
  if (!item) return <Loading cards={2} />;

  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - несколько дарителей
  // делят один подарок вместо брони одним человеком. Та же пара ручек
  // (reserve/markBought), бэкенд сам различает режим по
  // item.maxContributors - см. backend/src/routes/items.ts.
  const isSplit = item.maxContributors > 1;
  // Аудит 2026-10-08, А-5: способ получить деньги выбран на подарке -
  // СБП (номер + банк), сбор в банке или нет (покупка в магазине). Не
  // зависит от "уже купил сам" и от складчины.
  const method = item.payoutMethod;
  const isFundraiser = method === "fundraiser";
  const isSbp = method === "sbp";
  const openFundraiser = (url: string | null) => {
    if (!url) return;
    trackEvent("fundraiser_link_clicked");
    openExternalLink(url);
  };
  const full = item.contributorsCount >= item.maxContributors;
  // QA-10: владелец на экране своей позиции (прямая ссылка) не видит
  // "Забронировать" - бронировать своё всё равно нельзя.
  const canReserve =
    !item.viewerIsOwner &&
    (isSplit ? !item.reservedByMe && !full && item.status !== "bought" : item.status === "available");

  // Аудит 2026-10-08, А-11: товар можно посмотреть ДО брони - скрываем
  // ссылку только при чужой брони / заполненной чужой складчине (Н-5) и у
  // уже подаренного не-участнику.
  const storeVisible = item.viewerIsOwner || item.reservedByMe || item.status === "available";
  const storeLinkLabel = item.reservedByMe && !method && item.status === "reserved" ? "Перейти в магазин" : "Посмотреть в магазине";

  const reserve = async () => {
    setError(null);
    try {
      await api.reserveItem(itemId, revealIdentity);
      // А-14: чтобы дошли напоминания и "спасибо" от бота.
      requestBotMessages();
      if (isFundraiser) {
        // Ссылку на сбор бэкенд отдаёт только участнику - берём её из
        // свежего ответа после присоединения.
        const fresh = await api.getItem(itemId);
        setItem(fresh);
        openFundraiser(fresh.fundraiserUrl);
        return;
      }
      await reload();
      if (isSbp) setSbpSheetOpen(true);
    } catch (err) {
      setError(apiError(err));
      // QA-16: после конфликта ("уже забронировали") показываем актуальное
      // состояние, а не "свободно" с кнопкой, которая снова упадёт.
      await reload();
    }
  };
  const markBought = async () => {
    setError(null);
    try {
      await api.markBought(itemId);
      await reload();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <Screen>
      <Header title="Подарок" backTo={backTo} />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flexGrow: 1 }}>
        {error && <ErrorBanner {...error} screen="item" />}
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 14, background: "var(--border)" }}
          />
        )}
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {/* А-9: без фото - заглушка в цветах бренда рядом с названием. */}
          {!item.imageUrl && <Thumbnail src={null} store={item.store} size={72} />}
          <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 700, overflowWrap: "anywhere" }}>{item.title ?? item.url}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            {item.price && (
              <span style={{ fontSize: 16, color: "var(--text-secondary)" }}>
                {formatRub(item.price)}
              </span>
            )}
            <StoreBadge store={item.store} />
          </div>
          </div>
        </div>

        {isSplit ? (
          <SplitStatus
            item={item}
            full={full}
            fundraiser={isFundraiser}
            onShowSbp={() => (isFundraiser ? openFundraiser(item.fundraiserUrl) : setSbpSheetOpen(true))}
          />
        ) : (
          <>
            {item.status === "available" && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  color: "var(--text-secondary)",
                }}
              >
                {item.viewerIsOwner
                  ? "Это ваш подарок — друзья видят его свободным и могут забронировать."
                  : availableText(item)}
              </div>
            )}

            {item.status === "reserved" && (
              <>
                {/* Беклог В-6: раньше писали "вами" безусловно - получатель
                    на своей же позиции тоже это видел. Текст нейтральный для
                    всех, кроме реального держателя брони. */}
                <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning-text)", fontSize: 13 }}>
                  {item.reservedByMe
                    ? `Забронировано вами · снимется ${expiresIn(item.reservationExpiresAt)}, если не отметить ${method ? "перевод" : "покупку"}`
                    : "Уже забронировано"}
                </div>

                {/* Находки Н-1 (sbpPhone уходил кому угодно) и Н-5 ("Перейти
                    в магазин" было кликабельно даже для чужой брони, позволяя
                    задвоить покупку) полного QA-прогона - обе карточки
                    показываем строго держателю брони. */}
                {item.reservedByMe && method && (
                  <button
                    onClick={() => (isSbp ? setSbpSheetOpen(true) : openFundraiser(item.fundraiserUrl))}
                    style={secondaryButton}
                  >
                    {isSbp ? "Показать реквизиты для перевода" : "Открыть сбор в банке"}
                  </button>
                )}
              </>
            )}

            {item.status === "bought" && (
              <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success-text)", fontSize: 13 }}>
                {!item.reservedByMe
                  ? "Этот подарок уже подарили."
                  : method
                    ? "Спасибо! Отмечено, что перевод отправлен."
                    : "Спасибо! Отмечено как купленное."}
              </div>
            )}
          </>
        )}

        {storeVisible && (
          <a
            href={item.url}
            onClick={() => trackEvent("store_link_clicked", { store: item.store ?? "other", beforeReserve: !item.reservedByMe })}
            target="_blank"
            rel="noreferrer"
            style={secondaryButton}
          >
            {storeLinkLabel}
          </a>
        )}

        {/* Аудит 2026-10-08, А-49: после брони - предложить подписку на
            поводы друзей (раньше она была только в шторке своего списка). */}
        {item.reservedByMe && !item.viewerIsOwner && <GiverCalendarPrompt from="item" />}
      </div>

      <div style={{ padding: "12px 16px 20px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
        {canReserve && (
          // А-27: вся строка - зона нажатия не ниже 44 px.
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={revealIdentity}
              onChange={(e) => setRevealIdentity(e.target.checked)}
              style={{ width: 20, height: 20, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Показать получателю, что дарю я
            </span>
          </label>
        )}
        {isSplit ? (
          <>
            {canReserve && (
              <PrimaryButton onClick={reserve} style={{ width: "100%" }}>
                {isFundraiser ? "Скинуться через сбор" : "Перевести свою часть"}
              </PrimaryButton>
            )}
            {item.reservedByMe && !item.paidByMe && item.status !== "bought" && (
              <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
                {isFundraiser ? "Моя часть переведена" : "Деньги отправлены"}
              </PrimaryButton>
            )}
          </>
        ) : (
          <>
            {canReserve && (
              <PrimaryButton onClick={reserve} style={{ width: "100%" }}>
                {isSbp ? "Перевести деньгами" : isFundraiser ? "Перевести через сбор" : "Забронировать"}
              </PrimaryButton>
            )}
            {item.status === "reserved" && item.reservedByMe && (
              <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
                {isSbp ? "Деньги отправлены" : isFundraiser ? "Деньги переведены в сбор" : "Отметить купленным"}
              </PrimaryButton>
            )}
          </>
        )}
      </div>

      {isSbp && item.reservedByMe && (
        <BottomSheet open={sbpSheetOpen} onClose={() => setSbpSheetOpen(false)} title="Перевод по СБП">
          <div style={{ padding: "4px 20px 24px" }}>
            <SbpPaymentCard item={item} />
          </div>
        </BottomSheet>
      )}
    </Screen>
  );
}

// "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - статус позиции для
// режима с несколькими дарителями: прогресс "X из Y" + состояние именно
// текущего зрителя (присоединился/оплатил/нет мест).
function SplitStatus({
  item,
  full,
  fundraiser,
  onShowSbp,
}: {
  item: Item;
  full: boolean;
  fundraiser: boolean;
  onShowSbp: () => void;
}) {
  const share = item.price ? formatRub(Math.round(item.price / item.maxContributors)) : null;
  // QA-13: присоединившиеся ещё не обязательно перевели - "участвуют", а
  // не "скинулись".
  const progress = `участвуют\u00a0${item.contributorsCount}\u00a0из\u00a0${item.maxContributors}`;

  if (item.status === "bought") {
    // QA-19: "Спасибо!" - только участникам; остальным - нейтральный статус.
    return (
      <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success-text)", fontSize: 13 }}>
        {item.reservedByMe
          ? `Спасибо! Все перевели свою часть (${item.maxContributors} из ${item.maxContributors}).`
          : "Подарок уже собран — все участники перевели свою часть."}
      </div>
    );
  }

  // А-20: владельцу на экране своей складчины - сколько уже перевели (без
  // имён; раскрывшиеся дарители видны в списке), а не текст для дарителя.
  if (item.viewerIsOwner) {
    const paid = item.paidCount ?? 0;
    const waiting = item.contributorsCount - paid;
    return (
      <div style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 14, color: "var(--text-secondary)" }}>
        {`Ваша складчина: перевели ${paid} из ${item.maxContributors}`}
        {waiting > 0 ? `, ещё ${waiting} ${waiting === 1 ? "участвует" : "участвуют"} и пока не отметили перевод` : ""}
        {share ? `. Доля — примерно ${share} с человека${paid > 0 && item.price ? `, собрано около ${formatRub(Math.round(item.price / item.maxContributors) * paid)}` : ""}.` : "."}
      </div>
    );
  }

  if (item.reservedByMe) {
    return (
      <>
        <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning-text)", fontSize: 13 }}>
          {item.paidByMe
            ? `Вы перевели свою часть — ждём остальных (${progress})`
            : `Вы присоединились (${progress}) — переведите свою часть${share ? `, примерно ${share}` : ""}. Место снимется ${expiresIn(item.reservationExpiresAt)}, если не отметить ${fundraiser ? "участие" : "перевод"}`}
        </div>
        <button
          onClick={onShowSbp}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 50,
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {fundraiser ? "Открыть сбор в банке" : "Показать реквизиты для перевода"}
        </button>
      </>
    );
  }

  if (full) {
    return (
      <div style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 14, color: "var(--text-secondary)" }}>
        Все места заняты ({progress}).
      </div>
    );
  }

  return (
    <div style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 14, color: "var(--text-secondary)" }}>
      {fundraiser
        ? `Получатель открыл сбор на этот подарок — ${progress}. Присоединяйтесь и скиньтесь через банк${share ? `, на каждого примерно ${share}` : ""}.`
        : item.selfPurchased
          ? `Подарок уже куплен получателем — в магазин идти не нужно. Скидываемся — ${progress}. Присоединяйтесь и переведите свою часть по СБП${share ? `, примерно ${share}` : ""}.`
          : `Получатель собирает деньги на этот подарок — ${progress}. Присоединяйтесь и переведите свою часть по СБП${share ? `, примерно ${share}` : ""}.`}
    </div>
  );
}

// "Уже купил(а) сам(а)" (решение 2026-10-02, по просьбе пользователя) -
// вместо похода в магазин даритель переводит деньги напрямую получателю по
// СБП. Номер телефона отдаётся бэкендом только после брони - см.
// backend/src/routes/items.ts. При "скинуться на подарок"
// (Item.maxContributors > 1) переводят не полную цену, а свою долю -
// делим поровну и округляем, лишняя копейка-другая не критична для
// доверительного перевода между знакомыми.
function SbpPaymentCard({ item }: { item: Item }) {
  const isSplit = item.maxContributors > 1;
  const amount = item.price && (isSplit ? Math.round(item.price / item.maxContributors) : item.price);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 14,
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {/* А-18: номер в едином виде, копируется нормализованным. */}
      {item.sbpPhone ? (
        <CopyRow
          label="Номер телефона для перевода по СБП"
          value={normalizePhone(item.sbpPhone) ?? item.sbpPhone}
          display={formatPhone(item.sbpPhone)}
          onCopied={() => trackEvent("sbp_details_copied", { field: "phone" })}
        />
      ) : null}
      {/* А-5: банк получателя - дарителю нужно выбрать его в переводе по СБП. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Банк получателя</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{item.sbpBank ?? "Не указан — уточните у получателя"}</span>
      </div>
      {amount && (
        <CopyRow
          label={isSplit ? `Сумма (ваша часть из ${item.maxContributors})` : "Сумма"}
          onCopied={() => trackEvent("sbp_details_copied", { field: "amount" })}
          value={`${(amount / 100).toFixed(0)} ₽`}
        />
      )}
      <CopyRow label="Комментарий к переводу" value={item.title ?? "Подарок"} onCopied={() => trackEvent("sbp_details_copied", { field: "comment" })} />

      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
        <li>Откройте приложение банка</li>
        <li>Выберите перевод по номеру телефона (СБП)</li>
        <li>Вставьте номер телефона и выберите банк получателя</li>
        <li>Добавьте комментарий с названием подарка</li>
        <li>Укажите сумму и отправьте перевод</li>
      </ol>
    </div>
  );
}

const secondaryButton = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 50,
  borderRadius: 14,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 15,
  fontWeight: 600,
} as const;

// Текст свободного подарка для дарителя - по способу подарить (А-5).
function availableText(item: Item): string {
  const bought = item.selfPurchased ? "Подарок уже куплен получателем — в магазин идти не нужно. " : "";
  if (item.payoutMethod === "sbp") {
    return `${bought}${item.selfPurchased ? "" : "Получатель просит подарить деньгами и купит подарок сам. "}После брони вы получите номер телефона и банк для перевода по СБП.`;
  }
  if (item.payoutMethod === "fundraiser") {
    return `${bought}${item.selfPurchased ? "" : "Получатель открыл сбор в банке на этот подарок. "}После брони откроется ссылка на сбор.`;
  }
  // А-39: не противоречит галочке "Показать получателю, что дарю я" ниже.
  return "Подарок свободен. По умолчанию получатель не узнает, кто дарит.";
}

// Срок брони/доли (5 дней, спека п.2; для доли в "скинуться" - с
// 2026-10-07) - считаем от настоящего дедлайна с бэкенда, а не пишем
// всегда "5 дней", иначе на 4-й день текст врал бы.
function expiresIn(iso: string | null): string {
  if (!iso) return "через 5 дней";
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "сегодня";
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
  return `через ${days} ${word}`;
}
