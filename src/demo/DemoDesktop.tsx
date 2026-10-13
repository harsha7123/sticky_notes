import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, useSettings } from "../api";
import { WinProvider, type WinHandle } from "../win";
import { Deck } from "../views/Deck";
import { NoteWindow } from "../views/NoteWindow";
import { AllNotes } from "../views/AllNotes";
import { SettingsView } from "../views/SettingsView";
import {
  deckStore,
  destroyWin,
  focusWin,
  moveWin,
  openAllDemo,
  resetDemo,
  setWinVisible,
  TASKBAR_H,
  winStore,
  type DemoWin,
} from "./mock";

const noop = async () => {};

const deckHandle: WinHandle = {
  label: "deck",
  show: noop,
  setFocus: noop,
  destroy: noop,
  close: noop,
  minimize: noop,
  onCloseRequested: async () => () => {},
  onKey: () => () => {},
};

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

function Frame({ win }: { win: DemoWin }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeHandlers = useRef(new Set<(e: { preventDefault(): void }) => void | Promise<void>>());

  const handle = useMemo<WinHandle>(
    () => ({
      label: win.label,
      show: async () => setWinVisible(win.label, true),
      setFocus: async () => focusWin(win.label),
      destroy: async () => destroyWin(win.label),
      minimize: async () => setWinVisible(win.label, false),
      close: async () => {
        let prevented = false;
        for (const h of closeHandlers.current) {
          await h({ preventDefault: () => (prevented = true) });
        }
        if (!prevented) destroyWin(win.label);
      },
      onCloseRequested: async (cb) => {
        closeHandlers.current.add(cb);
        return () => closeHandlers.current.delete(cb);
      },
      onKey: (fn, capture = false) => {
        const el = ref.current;
        if (!el) return () => {};
        el.addEventListener("keydown", fn, capture);
        return () => el.removeEventListener("keydown", fn, capture);
      },
    }),
    [win.label],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    focusWin(win.label);
    const target = e.target as HTMLElement;
    if (!target.closest("[data-tauri-drag-region]") || target.closest("button")) return;
    e.preventDefault();
    const startX = e.clientX - win.x;
    const startY = e.clientY - win.y;
    const move = (ev: PointerEvent) =>
      moveWin(
        win.label,
        Math.min(window.innerWidth - 60, Math.max(-win.w + 60, ev.clientX - startX)),
        Math.min(window.innerHeight - TASKBAR_H - 30, Math.max(0, ev.clientY - startY)),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      className="demo-frame"
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        visibility: win.visible ? "visible" : "hidden",
      }}
      onPointerDown={onPointerDown}
    >
      <WinProvider handle={handle}>
        {win.kind === "note" && win.noteId && <NoteWindow id={win.noteId} />}
        {win.kind === "all" && <AllNotes />}
        {win.kind === "settings" && <SettingsView />}
      </WinProvider>
    </div>
  );
}

function Tray() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", off);
    return () => window.removeEventListener("pointerdown", off);
  }, [open]);

  const item = (label: string, keys: string, run: () => void) => (
    <button
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </button>
  );

  return (
    <div className="demo-tray" ref={ref}>
      <button className="demo-tray-icon" title="EdgeNotes (right-click in the real app)" onClick={() => setOpen((o) => !o)}>
        <img src="/app-icon.svg" alt="" width={20} height={20} />
      </button>
      {open && (
        <div className="demo-tray-menu" role="menu">
          {item("New note", "Ctrl+Alt+N", () => api.createNote())}
          {item("All notes", "Ctrl+Alt+A", () => openAllDemo("notes"))}
          {item("Archive", "Ctrl+Alt+L", () => openAllDemo("archive"))}
          <hr />
          {item("Settings…", "", () => api.openSettings())}
          <hr />
          {item("Reset demo", "", () => resetDemo())}
        </div>
      )}
    </div>
  );
}

export function DemoDesktop() {
  const wins = useSyncExternalStore(winStore.subscribe, winStore.get);
  const deck = useSyncExternalStore(deckStore.subscribe, deckStore.get);
  const settings = useSettings();
  const { h: vh } = useViewport();
  const [introOpen, setIntroOpen] = useState(true);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Simulated global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") api.createNote();
      else if (k === "a") openAllDemo("notes");
      else if (k === "l") openAllDemo("archive");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const areaH = vh - TASKBAR_H;
  const deckW = deck.expanded ? 300 : 14;
  const deckH = Math.min(Math.max(deck.height, 80), areaH * 0.85);
  const edge = settings?.edge ?? "right";

  return (
    <div className="demo-desktop">
      {introOpen && (
        <section className={`demo-intro edge-${edge}`}>
          <h1>EdgeNotes</h1>
          <p>
            A live demo of the desktop app, running in your browser. The real app looks the same, but lives on your actual
            screen edge with no taskbar button.
          </p>
          <ol>
            <li>
              Hover the slim handle on the <b>{edge}</b> edge to open the deck.
            </li>
            <li>Hover a tab to peek, click it to open, drag it to reorder.</li>
            <li>
              <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> for a new note. Type <code>- </code>, <code>1. </code> or{" "}
              <code>[ ] </code> to start a list.
            </li>
            <li>
              In a note: <kbd>Ctrl</kbd>+<kbd>.</kbd> colour, <kbd>Ctrl</kbd>+<kbd>⌫</kbd> delete (then <kbd>Ctrl</kbd>+
              <kbd>Z</kbd>), <kbd>Esc</kbd> close.
            </li>
            <li>
              <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> for All notes, or use the tray icon at the bottom right.
            </li>
          </ol>
          <div className="demo-intro-foot">
            <a href="https://github.com/harsha7123/sticky_notes" target="_blank" rel="noopener">
              Source on GitHub
            </a>
            <button onClick={() => setIntroOpen(false)}>Got it</button>
          </div>
        </section>
      )}

      <div
        className="demo-deck"
        style={{
          width: deckW,
          height: deckH,
          top: (areaH - deckH) / 2,
          [edge]: 0,
        }}
      >
        <WinProvider handle={deckHandle}>
          <Deck />
        </WinProvider>
      </div>

      {wins.map((w) => (
        <Frame key={w.label} win={w} />
      ))}

      <footer className="demo-taskbar" style={{ height: TASKBAR_H }}>
        <span className="demo-taskbar-note">No EdgeNotes button here: it stays out of your taskbar.</span>
        <Tray />
        <span className="demo-clock">{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </footer>
    </div>
  );
}
