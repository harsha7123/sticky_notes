import { useEffect, useRef, useState } from "react";

type Drag = { id: string; from: number; to: number; dy: number; height: number };

/**
 * Pointer-based vertical reordering. Press and move past a few pixels to
 * start dragging; the item follows the pointer and the others make room.
 * A plain click (no movement) still reaches the item's onClick.
 */
export function useReorder(ids: string[], onCommit: (ids: string[]) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [override, setOverride] = useState<string[] | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const justDragged = useRef(false);
  const key = ids.join(",");

  // Once the backend echoes the new order, drop the optimistic copy.
  useEffect(() => setOverride(null), [key]);

  const order = override ?? ids;

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    const from = order.indexOf(id);
    const rects = order.map((i) => refs.current.get(i)?.getBoundingClientRect());
    const self = rects[from];
    if (!self || rects.some((r) => !r)) return;
    const startY = e.clientY;
    let active = false;
    let to = from;

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!active && Math.abs(dy) < 5) return;
      active = true;
      const mid = self.top + self.height / 2 + dy;
      to = rects.filter((r, i) => i !== from && r!.top + r!.height / 2 < mid).length;
      setDrag({ id, from, to, dy, height: self.height + 6 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      if (to !== from) {
        const next = [...order];
        next.splice(from, 1);
        next.splice(to, 0, id);
        setOverride(next);
        onCommit(next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Inline style that moves an item while a drag is in progress. */
  const styleFor = (id: string): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    if (id === drag.id) {
      return { transform: `translateY(${drag.dy}px)`, zIndex: 5, transition: "none" };
    }
    const i = order.indexOf(id);
    if (drag.from < drag.to && i > drag.from && i <= drag.to) {
      return { transform: `translateY(${-drag.height}px)` };
    }
    if (drag.from > drag.to && i >= drag.to && i < drag.from) {
      return { transform: `translateY(${drag.height}px)` };
    }
    return undefined;
  };

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  return {
    order,
    draggingId: drag?.id ?? null,
    onPointerDown,
    styleFor,
    register,
    wasDragged: () => justDragged.current,
  };
}
