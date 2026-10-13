import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { ColorId } from "./colors";
import { isTauri } from "./win";
import { mockInvoke, mockListen } from "./demo/mock";

const invoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  isTauri ? tauriInvoke<T>(cmd, args) : mockInvoke<T>(cmd, args);

/** Listen to a backend broadcast (Tauri event, or the demo's emitter). */
export function listenEvent<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  return isTauri ? tauriListen<T>(event, (e) => cb(e.payload)) : Promise.resolve(mockListen<T>(event, cb));
}

export type Note = {
  id: string;
  html: string;
  text: string;
  color: ColorId;
  pinned: boolean;
  archived: boolean;
  order: number;
  created: number;
  updated: number;
};

export type NotePatch = Partial<Pick<Note, "html" | "text" | "color" | "pinned" | "archived">>;

export type Settings = {
  edge: "left" | "right";
  theme: "system" | "light" | "dark";
  hideInFullscreen: boolean;
};

export const api = {
  getNotes: () => invoke<Note[]>("get_notes"),
  createNote: () => invoke<Note>("create_note"),
  updateNote: (id: string, patch: NotePatch) => invoke<Note>("update_note", { id, patch }),
  deleteNote: (id: string) => invoke<Note | null>("delete_note", { id }),
  restoreNote: (note: Note) => invoke<void>("restore_note", { note }),
  reorder: (ids: string[]) => invoke<void>("reorder_notes", { ids }),
  openNote: (id: string) => invoke<void>("open_note", { id }),
  openAll: (tab: "notes" | "archive" = "notes") => invoke<void>("open_all", { tab }),
  openSettings: () => invoke<void>("open_settings"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<void>("set_settings", { settings }),
  setDeckState: (expanded: boolean, height: number) =>
    invoke<void>("set_deck_state", { expanded, height }),
  deckReady: () => invoke<void>("deck_ready"),
  dataInfo: () => invoke<{ path: string; portable: boolean }>("data_info"),
  revealData: () => invoke<void>("reveal_data"),
  exportNotes: (path: string, format: "json" | "md") =>
    invoke<number>("export_notes", { path, format }),
  importNotes: (path: string) => invoke<number>("import_notes", { path }),
  quit: () => invoke<void>("quit_app"),
};

/** Subscribe to a value the backend broadcasts whenever it changes. */
function useBroadcast<T>(load: () => Promise<T>, event: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listenEvent<T>(event, setValue).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    load().then((v) => !cancelled && setValue(v));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);
  return value;
}

export const useNotes = () => useBroadcast(api.getNotes, "notes-changed");
export const useSettings = () => useBroadcast(api.getSettings, "settings-changed");

/** Pinned first, then the user's own order. */
export function inUserOrder(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
}

export function titleOf(note: Note): string {
  const line = note.text.split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 80) : "Empty note";
}

export function snippetOf(note: Note): string {
  const lines = note.text.split("\n").filter((l) => l.trim());
  return lines.slice(1).join(" · ").slice(0, 220);
}

export function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const isMac = navigator.userAgent.includes("Mac");
export const MOD = isMac ? "⌘" : "Ctrl";
export const GLOBAL_MODS = isMac ? ["⌃", "⌥"] : ["Ctrl", "Alt"];
