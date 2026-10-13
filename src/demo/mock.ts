// In-browser stand-in for the Rust backend, used by the web demo.
// Same command names and events as src-tauri/src/lib.rs.
import type { Note, NotePatch, Settings } from "../api";
import { COLORS, type ColorId } from "../colors";

const KEY = "edgenotes-demo-v1";
export const TASKBAR_H = 48;
const DECK_EXPANDED_W = 300;
const NOTE_W = 340;
const NOTE_H = 360;

// ---------- events ----------
type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

export function mockListen<T>(event: string, cb: (payload: T) => void): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(cb as Listener);
  listeners.set(event, set);
  return () => set.delete(cb as Listener);
}

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((l) => l(payload));
}

// ---------- tiny external stores ----------
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      subs.forEach((f) => f());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export type DemoWin = {
  label: string;
  kind: "note" | "all" | "settings";
  noteId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  visible: boolean;
};

export const winStore = store<DemoWin[]>([]);
export const deckStore = store({ expanded: false, height: 168 });
let zTop = 10;

export function focusWin(label: string) {
  zTop += 1;
  winStore.set(winStore.get().map((w) => (w.label === label ? { ...w, z: zTop } : w)));
}
export function setWinVisible(label: string, visible: boolean) {
  winStore.set(winStore.get().map((w) => (w.label === label ? { ...w, visible } : w)));
}
export function destroyWin(label: string) {
  winStore.set(winStore.get().filter((w) => w.label !== label));
}
export function moveWin(label: string, x: number, y: number) {
  winStore.set(winStore.get().map((w) => (w.label === label ? { ...w, x, y } : w)));
}

function openWin(label: string, kind: DemoWin["kind"], noteId?: string) {
  const existing = winStore.get().find((w) => w.label === label);
  if (existing) {
    setWinVisible(label, true);
    focusWin(label);
    return;
  }
  const W = window.innerWidth;
  const H = window.innerHeight - TASKBAR_H;
  let w = NOTE_W;
  let h = NOTE_H;
  let x: number;
  let y: number;
  if (kind === "note") {
    const step = (winStore.get().filter((v) => v.kind === "note").length % 8) * 28;
    x = settings.edge === "left" ? DECK_EXPANDED_W + 24 + step : W - DECK_EXPANDED_W - NOTE_W - 24 - step;
    y = 96 + step;
  } else {
    w = kind === "all" ? Math.min(780, W - 80) : 480;
    h = kind === "all" ? Math.min(620, H - 60) : Math.min(640, H - 40);
    x = (W - w) / 2;
    y = Math.max(20, (H - h) / 2);
  }
  zTop += 1;
  winStore.set([...winStore.get(), { label, kind, noteId, x: Math.max(8, x), y, w, h, z: zTop, visible: false }]);
}

// ---------- data ----------
function seed(): Note[] {
  const t = Date.now();
  const mk = (color: ColorId, html: string, text: string, order: number, ageMin: number, pinned = false): Note => ({
    id: crypto.randomUUID(),
    html,
    text,
    color,
    pinned,
    archived: false,
    order,
    created: t - ageMin * 60000,
    updated: t - ageMin * 60000,
  });
  return [
    mk("rose", "<p>Call mom</p><p>sunday, after 6</p>", "Call mom\nsunday, after 6", 0, 40, true),
    mk(
      "butter",
      '<p><strong>Groceries</strong></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Oat milk</p></li><li data-type="taskItem" data-checked="false"><p>Eggs</p></li><li data-type="taskItem" data-checked="false"><p>Basil</p></li><li data-type="taskItem" data-checked="false"><p>Coffee beans</p></li></ul>',
      "Groceries\nOat milk\nEggs\nBasil\nCoffee beans",
      1,
      2,
    ),
    mk(
      "sky",
      "<p><strong>Standup</strong></p><ul><li><p>Shipped the deck reorder</p></li><li><p>Today: fullscreen detection</p></li><li><p>Blocked: nothing</p></li></ul>",
      "Standup\nShipped the deck reorder\nToday: fullscreen detection\nBlocked: nothing",
      2,
      180,
    ),
    mk(
      "mint",
      '<p><strong>Ideas</strong></p><ol><li><p>Notes linked to an app</p></li><li><p>Screenshot to note</p></li><li><p>Encrypted sync</p></li></ol><p>More at <a href="https://github.com/harsha7123/sticky_notes">the repo</a></p>',
      "Ideas\nNotes linked to an app\nScreenshot to note\nEncrypted sync\nMore at the repo",
      3,
      60 * 24 * 3,
    ),
    { ...mk("stone", "<p>Old trip checklist</p><p>passport, adapter, charger</p>", "Old trip checklist\npassport, adapter, charger", 4, 60 * 24 * 30), archived: true },
  ];
}

const DEFAULT_SETTINGS: Settings = { edge: "right", theme: "system", hideInFullscreen: true };

function load(): { notes: Note[]; settings: Settings } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.notes)) return { notes: parsed.notes, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
    }
  } catch {
    /* storage unavailable: start fresh */
  }
  return { notes: seed(), settings: DEFAULT_SETTINGS };
}

let { notes, settings } = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ notes, settings }));
  } catch {
    /* demo still works without storage */
  }
}

function notesChanged() {
  persist();
  emit("notes-changed", notes.map((n) => ({ ...n })));
}

export function resetDemo() {
  notes = seed();
  settings = DEFAULT_SETTINGS;
  winStore.set([]);
  notesChanged();
  emit("settings-changed", settings);
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function newNote(): Note {
  const top = Math.min(0, ...notes.map((n) => n.order));
  const t = Date.now();
  const note: Note = {
    id: crypto.randomUUID(),
    html: "",
    text: "",
    color: "butter",
    pinned: false,
    archived: false,
    order: top - 1,
    created: t,
    updated: t,
  };
  notes = [...notes, note];
  notesChanged();
  openWin(`note-${note.id}`, "note", note.id);
  return note;
}

export function openAllDemo(tab: "notes" | "archive") {
  window.__INITIAL_TAB__ = tab;
  const exists = winStore.get().some((w) => w.label === "all");
  openWin("all", "all");
  if (exists) emit("all-tab", tab);
}

type Args = Record<string, any>;

export async function mockInvoke<T>(cmd: string, args: Args = {}): Promise<T> {
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "get_notes":
      return r(notes.map((n) => ({ ...n })));
    case "create_note":
      return r(newNote());
    case "update_note": {
      const patch = args.patch as NotePatch;
      let updated: Note | undefined;
      notes = notes.map((n) => {
        if (n.id !== args.id) return n;
        const next = { ...n, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Note;
        if (!COLORS.includes(next.color)) next.color = n.color;
        if (patch.html !== undefined && patch.html !== n.html) next.updated = Date.now();
        updated = next;
        return next;
      });
      if (!updated) throw "note not found";
      notesChanged();
      return r(updated);
    }
    case "delete_note": {
      const found = notes.find((n) => n.id === args.id) ?? null;
      notes = notes.filter((n) => n.id !== args.id);
      notesChanged();
      return r(found);
    }
    case "restore_note":
      if (!notes.some((n) => n.id === args.note.id)) notes = [...notes, args.note];
      notesChanged();
      return r(undefined);
    case "reorder_notes":
      (args.ids as string[]).forEach((id, i) => {
        notes = notes.map((n) => (n.id === id ? { ...n, order: i } : n));
      });
      notesChanged();
      return r(undefined);
    case "open_note":
      openWin(`note-${args.id}`, "note", args.id);
      return r(undefined);
    case "open_all":
      openAllDemo(args.tab === "archive" ? "archive" : "notes");
      return r(undefined);
    case "open_settings":
      openWin("settings", "settings");
      return r(undefined);
    case "get_settings":
      return r({ ...settings });
    case "set_settings":
      settings = { ...args.settings };
      persist();
      emit("settings-changed", { ...settings });
      return r(undefined);
    case "set_deck_state":
      deckStore.set({ expanded: args.expanded, height: args.height });
      return r(undefined);
    case "deck_ready":
    case "reveal_data":
    case "quit_app":
      return r(undefined);
    case "data_info":
      return r({ path: "Browser storage (web demo)", portable: false });
    case "export_notes": {
      const stamp = new Date().toISOString().slice(0, 10);
      if (args.format === "md") {
        download(`edgenotes-${stamp}.md`, notes.map((n) => n.text.trim()).filter(Boolean).join("\n\n---\n\n"), "text/markdown");
      } else {
        download(`edgenotes-${stamp}.json`, JSON.stringify({ version: 1, notes }, null, 2), "application/json");
      }
      return r(notes.length);
    }
    case "import_notes":
      throw "Import is available in the desktop app.";
    default:
      throw `Unknown command: ${cmd}`;
  }
}
