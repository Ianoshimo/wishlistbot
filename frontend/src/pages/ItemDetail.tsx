import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, describeError, type Item } from "../api";
import { BottomSheet, CopyRow, ErrorBanner, Header, PrimaryButton, Screen, StoreBadge } from "../components/UI";

// Спека итерации 1, п.2-3: полный жизненный цикл брони в одном экране,
// как в дизайн-макете (артборд ItemDetail) - available → reserved → bought.

export function ItemDetail() {
  const { itemId = "" } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  // СБП-карточка - bottom sheet вместо отдельной страницы (CLAUDE.md,
  // 2026-10-01) - открывается сама сразу после брони, и повторно по кнопке.
  const [sbpSheetOpen, setSbpSheetOpen] = useState(false);
  // "Дарить неанонимно" (CLAUDE.md, 2026-10-02) - выбор дарителя в
  // момент брони, по умолчанию анонимно (как раньше). Нельзя передумать
  // после брони - решение фиксируется один раз, см. reserve() ниже.
  const [revealIdentity, setRevealIdentity] = useState(false);

  const reload = () => api.getItem(itemId).then(setItem);
  useEffect(() => {
    void reload();
  }, [itemId]);

  if (!item) return null;

  // "Скинуться на подарок" (CLAUDE.md, 2026-10-02) - несколько дарителей
  // делят один selfPurchased-перевод вместо брони одним человеком. Та же
  // пара ручек (reserve/markBought), бэкенд сам различает режим по
  // item.maxContributors - см. backend/src/routes/items.ts.
  const isSplit = item.maxContributors > 1;
  const full = item.contributorsCount >= item.maxContributors;
  const canReserve = isSplit
    ? !item.reservedByMe && !full && item.status !== "bought"
    : item.status === "available";

  const reserve = async () => {
    setError(null);
    try {
      await api.reserveItem(itemId, revealIdentity);
      await reload();
      if (item.selfPurchased) setSbpSheetOpen(true);
    } catch (err) {
      setError(describeError(err));
    }
  };
  const markBought = async () => {
    setError(null);
    try {
      await api.markBought(itemId);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Screen>
      <Header title="Подарок" backTo="/" />
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flexGrow: 1 }}>
        {error && <ErrorBanner message={error} />}
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
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{item.title ?? item.url}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            {item.price && (
              <span style={{ fontSize: 16, color: "var(--text-secondary)" }}>
                {(item.price / 100).toFixed(0)} ₽
              </span>
            )}
            <StoreBadge store={item.store} />
          </div>
        </div>

        {isSplit ? (
          <SplitStatus item={item} full={full} onShowSbp={() => setSbpSheetOpen(true)} />
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
                {item.selfPurchased
                  ? "Получатель уже купил(а) этот подарок сам(а) - идти в магазин не нужно, после брони вы получите номер телефона для перевода."
                  : "Позиция ещё свободна. Никто не увидит, что именно вы дарите."}
              </div>
            )}

            {item.status === "reserved" && (
              <>
                {/* Беклог В-6: раньше писали "вами" безусловно - получатель
                    на своей же позиции тоже это видел. Текст нейтральный для
                    всех, кроме реального держателя брони. */}
                <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13 }}>
                  {item.reservedByMe
                    ? `Забронировано вами · снимется через 5 дней, если не отметить ${item.selfPurchased ? "перевод" : "покупку"}`
                    : "Уже забронировано"}
                </div>

                {/* Находки Н-1 (sbpPhone уходил кому угодно) и Н-5 ("Перейти
                    в магазин" было кликабельно даже для чужой брони, позволяя
                    задвоить покупку) полного QA-прогона - обе карточки
                    показываем строго держателю брони. */}
                {item.reservedByMe &&
                  (item.selfPurchased ? (
                    <button
                      onClick={() => setSbpSheetOpen(true)}
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
                      Показать реквизиты для перевода
                    </button>
                  ) : (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
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
                      Перейти в магазин
                    </a>
                  ))}
              </>
            )}

            {item.status === "bought" && (
              <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success)", fontSize: 13 }}>
                {item.selfPurchased ? "Спасибо! Отмечено, что перевод отправлен." : "Спасибо! Отмечено как купленное."}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: "12px 16px 20px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
        {canReserve && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={revealIdentity}
              onChange={(e) => setRevealIdentity(e.target.checked)}
              style={{ width: 18, height: 18, flexShrink: 0 }}
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
                Перевести свою часть
              </PrimaryButton>
            )}
            {item.reservedByMe && !item.paidByMe && item.status !== "bought" && (
              <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
                Деньги отправлены
              </PrimaryButton>
            )}
          </>
        ) : (
          <>
            {canReserve && (
              <PrimaryButton onClick={reserve} style={{ width: "100%" }}>
                {item.selfPurchased ? "Перевести деньгами" : "Забронировать"}
              </PrimaryButton>
            )}
            {item.status === "reserved" && item.reservedByMe && (
              <PrimaryButton onClick={markBought} style={{ width: "100%" }}>
                {item.selfPurchased ? "Деньги отправлены" : "Отметить купленным"}
              </PrimaryButton>
            )}
          </>
        )}
      </div>

      {item.selfPurchased && item.reservedByMe && (
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
function SplitStatus({ item, full, onShowSbp }: { item: Item; full: boolean; onShowSbp: () => void }) {
  const progress = `${item.contributorsCount} из ${item.maxContributors} уже скинулись`;

  if (item.status === "bought") {
    return (
      <div style={{ padding: 14, borderRadius: 14, background: "var(--success-soft)", color: "var(--success)", fontSize: 13 }}>
        Спасибо! Все перевели свою часть ({item.maxContributors} из {item.maxContributors}).
      </div>
    );
  }

  if (item.reservedByMe) {
    return (
      <>
        <div style={{ padding: 14, borderRadius: 14, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13 }}>
          {item.paidByMe
            ? `Вы перевели свою часть - ждём остальных (${progress})`
            : `Вы присоединились (${progress}) - переведите свою часть`}
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
          Показать реквизиты для перевода
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
      Получатель уже купил(а) этот подарок сам(а) и разрешил(а) скинуться - {progress}. Присоединяйтесь и переведите свою часть по номеру телефона.
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
      {item.sbpPhone ? <CopyRow label="Номер телефона для перевода по СБП" value={item.sbpPhone} /> : null}
      {amount && (
        <CopyRow
          label={isSplit ? `Сумма (ваша часть из ${item.maxContributors})` : "Сумма"}
          value={`${(amount / 100).toFixed(0)} ₽`}
        />
      )}
      <CopyRow label="Комментарий к переводу" value={item.title ?? "Подарок"} />

      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
        <li>Откройте приложение банка</li>
        <li>Выберите перевод по номеру телефона (СБП)</li>
        <li>Вставьте номер телефона</li>
        <li>Добавьте комментарий с названием подарка</li>
        <li>Укажите сумму и отправьте перевод</li>
      </ol>
    </div>
  );
}
