import { useRef, useState, type PointerEvent, type ReactNode } from "react";

// Свайп-удаление вместо отдельной крестик-кнопки (CLAUDE.md, 2026-10-01) -
// привычный жест из самого Telegram. Pointer events вместо отдельных
// touch/mouse обработчиков - единая логика для реального телефона и для
// разработки мышью в обычном браузере (см. README "Запуск локально").

const ACTION_WIDTH = 76;
const DRAG_THRESHOLD = 6; // отличаем свайп от обычного тапа/клика по карточке

export function SwipeToDelete({
  children,
  onDelete,
  deleteLabel = "Удалить",
}: {
  children: ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
}) {
  const [offset, setOffset] = useState(0);
  const dragState = useRef<{ startX: number; startOffset: number; dragging: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Pointer capture нарочно НЕ ставится здесь (на каждом pointerdown) -
    // это перехватывало клики по кнопкам внутри карточки (звёздочка
    // приоритета, редактирование) ещё до того, как понятно, свайп это или
    // обычный тап. Захватываем указатель только когда жест действительно
    // стал свайпом - см. onPointerMove.
    dragState.current = { startX: e.clientX, startOffset: offset, dragging: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const state = dragState.current;
    if (!state) return;
    const delta = e.clientX - state.startX;
    if (!state.dragging && Math.abs(delta) > DRAG_THRESHOLD) {
      state.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!state.dragging) return;
    const next = Math.min(0, Math.max(-ACTION_WIDTH, state.startOffset + delta));
    setOffset(next);
  };

  const endDrag = () => {
    const state = dragState.current;
    dragState.current = null;
    if (!state?.dragging) return;
    setOffset(offset < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 14 }}>
      <button
        onClick={() => {
          setOffset(0);
          onDelete();
        }}
        aria-label={deleteLabel}
        style={{
          position: "absolute",
          inset: 0,
          marginLeft: "auto",
          width: ACTION_WIDTH,
          border: "none",
          background: "var(--danger)",
          color: "#ffffff",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {deleteLabel}
      </button>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragState.current ? "none" : "transform 0.2s ease",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
