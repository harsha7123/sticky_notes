import { useEffect, useMemo, useRef, useState } from "react";
import { api, inUserOrder, snippetOf, titleOf, useNotes, useSettings, GLOBAL_MODS } from "../api";
import { useReorder } from "../useReorder";
import { GearIcon, GridIcon, PinIcon, PlusIcon } from "../components/icons";

const HEADER_H = 52;
const TAB_H = 44;
const PEEK_H = 96; // room kept below the list so a hovered tab can open its preview
const COLLAPSED_H = 168;
const COLLAPSE_DELAY = 280;
const PEEK_DELAY = 350;

export function Deck() {
  const notes = useNotes();
  const settings = useSettings();
  const [expanded, setExpanded] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const leaveTimer = useRef<number>();
  const peekTimer = useRef<number>();

  const visible = useMemo(() => inUserOrder((notes ?? []).filter((n) => !n.archived)), [notes]);
  const byId = useMemo(() => new Map(visible.map((n) => [n.id, n])), [visible]);
  const reorder = useReorder(
    visible.map((n) => n.id),
    (ids) => api.reorder(ids),
  );

  const edge = settings?.edge ?? "right";
  const height = expanded
    ? HEADER_H + Math.max(visible.length, 1) * TAB_H + PEEK_H + 24
    : COLLAPSED_H;

  useEffect(() => {
    api.setDeckState(expanded, height);
  }, [expanded, height, edge]);

  useEffect(() => {
    requestAnimationFrame(() => api.deckReady());
  }, []);

  // If the pointer leaves the whole window (not just the panel), collapse too.
  useEffect(() => {
    if (!expanded) return;
    const onLeave = () => leave();
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => document.documentElement.removeEventListener("mouseleave", onLeave);
  }, [expanded]);

  const enter = () => {
    clearTimeout(leaveTimer.current);
    setExpanded(true);
  };
  const leave = () => {
    clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      if (reorder.draggingId) return;
      setExpanded(false);
      setPeekId(null);
    }, COLLAPSE_DELAY);
  };

  const startPeek = (id: string) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeekId(id), PEEK_DELAY);
  };
  const stopPeek = () => {
    clearTimeout(peekTimer.current);
    setPeekId(null);
  };

  if (!expanded) {
    return (
      <div className={`deck-handle edge-${edge}`} onMouseEnter={enter}>
        <div className="handle-pill">
          {visible.slice(0, 10).map((n) => (
            <span key={n.id} className="handle-tick" data-color={n.color} />
          ))}
          {visible.length === 0 && <span className="handle-tick empty" />}
        </div>
      </div>
    );
  }

  return (
    <div className={`deck edge-${edge}`}>
      <div className="deck-panel" onMouseEnter={enter} onMouseLeave={leave}>
        <div className="deck-header">
          <span className="deck-count">
            {visible.length} {visible.length === 1 ? "note" : "notes"}
          </span>
          <div className="deck-actions">
            <button className="icon-btn" title={`New note (${GLOBAL_MODS.join("+")}+N)`} onClick={() => api.createNote()}>
              <PlusIcon />
            </button>
            <button className="icon-btn" title={`All notes (${GLOBAL_MODS.join("+")}+A)`} onClick={() => api.openAll()}>
              <GridIcon />
            </button>
            <button className="icon-btn" title="Settings" onClick={() => api.openSettings()}>
              <GearIcon />
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <button className="deck-empty" onClick={() => api.createNote()}>
            No notes yet.
            <span>Click here or press {GLOBAL_MODS.join("+")}+N</span>
          </button>
        ) : (
          <ul className="deck-tabs">
            {reorder.order.map((id) => {
              const n = byId.get(id);
              if (!n) return null;
              const peeking = peekId === id && !reorder.draggingId;
              const snippet = snippetOf(n);
              return (
                <li
                  key={id}
                  ref={reorder.register(id)}
                  className={`deck-tab${reorder.draggingId === id ? " dragging" : ""}${peeking ? " peeking" : ""}`}
                  data-color={n.color}
                  style={reorder.styleFor(id)}
                  onPointerDown={(e) => reorder.onPointerDown(e, id)}
                  onMouseEnter={() => startPeek(id)}
                  onMouseLeave={stopPeek}
                  onClick={() => !reorder.wasDragged() && api.openNote(id)}
                >
                  <div className="deck-tab-row">
                    <span className="deck-tab-title">{titleOf(n)}</span>
                    {n.pinned && <PinIcon className="deck-tab-pin" width={12} height={12} />}
                  </div>
                  {peeking && <p className="deck-peek">{snippet || "Nothing else in this note."}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
