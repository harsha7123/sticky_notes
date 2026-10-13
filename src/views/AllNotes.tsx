import { useEffect, useMemo, useRef, useState } from "react";
import { api, ago, inUserOrder, listenEvent, snippetOf, titleOf, useNotes, MOD, type Note } from "../api";
import { pickOpenPath, pickSavePath } from "../platform";
import { isTauri, useWin } from "../win";
import { COLORS, nextColor } from "../colors";
import { useReorder } from "../useReorder";
import { TitleBar } from "../components/TitleBar";
import {
  ArchiveIcon,
  GripIcon,
  PaletteIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UnarchiveIcon,
} from "../components/icons";

type Tab = "notes" | "archive";
type Sort = "manual" | "edited" | "created" | "colour";

declare global {
  interface Window {
    __INITIAL_TAB__?: Tab;
  }
}

function loadSort(): Sort {
  try {
    return (localStorage.getItem("sort") as Sort) || "manual";
  } catch {
    return "manual";
  }
}

const sorters: Record<Exclude<Sort, "manual">, (a: Note, b: Note) => number> = {
  edited: (a, b) => b.updated - a.updated,
  created: (a, b) => b.created - a.created,
  colour: (a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.order - b.order,
};

export function AllNotes() {
  const win = useWin();
  const notes = useNotes();
  const [tab, setTab] = useState<Tab>(window.__INITIAL_TAB__ ?? "notes");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(loadSort);
  const [toast, setToast] = useState<{ text: string; undo?: Note } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (notes && !shown.current) {
      shown.current = true;
      win.show().then(() => win.setFocus());
      searchRef.current?.focus();
    }
  }, [notes]);

  useEffect(() => {
    const un = listenEvent<Tab>("all-tab", setTab);
    return () => {
      un.then((u) => u());
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sort", sort);
    } catch {
      /* per-window preference only */
    }
  }, [sort]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? 10000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const all = notes ?? [];
    return { notes: all.filter((n) => !n.archived).length, archive: all.filter((n) => n.archived).length };
  }, [notes]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inTab = (notes ?? []).filter((n) => n.archived === (tab === "archive"));
    const matched = q ? inTab.filter((n) => n.text.toLowerCase().includes(q)) : inTab;
    return sort === "manual" ? inUserOrder(matched) : [...matched].sort(sorters[sort]);
  }, [notes, tab, query, sort]);

  const canDrag = sort === "manual" && !query && tab === "notes";
  const byId = useMemo(() => new Map(list.map((n) => [n.id, n])), [list]);
  const reorder = useReorder(
    list.map((n) => n.id),
    (ids) => {
      // Keep archived notes' positions stable by appending them after.
      const rest = (notes ?? []).filter((n) => !ids.includes(n.id)).map((n) => n.id);
      api.reorder([...ids, ...rest]);
    },
  );

  const remove = async (id: string) => {
    const removed = await api.deleteNote(id);
    if (removed) setToast({ text: "Deleted.", undo: removed });
  };

  const undo = async () => {
    if (toast?.undo) await api.restoreNote(toast.undo);
    setToast(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        api.createNote();
      } else if (mod && e.key.toLowerCase() === "z" && toast?.undo && document.activeElement !== searchRef.current) {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        if (query) setQuery("");
        else win.close();
      }
    };
    return win.onKey(onKey);
  }, [query, toast]);

  const doExport = async (format: "json" | "md") => {
    const stamp = new Date().toISOString().slice(0, 10);
    const path = isTauri
      ? await pickSavePath(`edgenotes-${stamp}.${format}`, format === "json" ? "JSON" : "Markdown", format)
      : "download";
    if (!path) return;
    try {
      const n = await api.exportNotes(path, format);
      setToast({ text: `Exported ${n} notes.` });
    } catch (e) {
      setToast({ text: `Export failed: ${e}` });
    }
  };

  const doImport = async () => {
    if (!isTauri) {
      setToast({ text: "Import is available in the desktop app." });
      return;
    }
    const path = await pickOpenPath();
    if (!path) return;
    try {
      const n = await api.importNotes(path);
      setToast({ text: `Imported ${n} ${n === 1 ? "note" : "notes"}.` });
    } catch (e) {
      setToast({ text: `Import failed: ${e}` });
    }
  };

  return (
    <div className="window all">
      <TitleBar title="All notes" />

      <div className="all-toolbar">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>
            Notes <span className="count">{counts.notes}</span>
          </button>
          <button role="tab" aria-selected={tab === "archive"} onClick={() => setTab("archive")}>
            Archive <span className="count">{counts.archive}</span>
          </button>
        </div>
        <label className="search">
          <SearchIcon />
          <input
            ref={searchRef}
            placeholder={`Search  (${MOD}+F)`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="manual">My order</option>
          <option value="edited">Recently edited</option>
          <option value="created">Newest first</option>
          <option value="colour">By colour</option>
        </select>
        <button className="btn primary" onClick={() => api.createNote()} title={`New note (${MOD}+N)`}>
          <PlusIcon /> New
        </button>
      </div>

      <ul className="all-list">
        {list.length === 0 && (
          <li className="all-empty">
            {query
              ? `Nothing matches “${query}”.`
              : tab === "archive"
                ? "Archived notes show up here. Archive a note to clear it from the deck without losing it."
                : "No notes yet. Press New to write one."}
          </li>
        )}
        {(canDrag ? reorder.order : list.map((n) => n.id)).map((id) => {
          const n = byId.get(id);
          if (!n) return null;
          return (
            <li
              key={id}
              ref={reorder.register(id)}
              className={`all-item${reorder.draggingId === id ? " dragging" : ""}`}
              data-color={n.color}
              style={canDrag ? reorder.styleFor(id) : undefined}
              onClick={() => !reorder.wasDragged() && api.openNote(id)}
            >
              <span className="all-chip" />
              <div className="all-body">
                <div className="all-title">
                  {n.pinned && <PinIcon width={12} height={12} />}
                  {titleOf(n)}
                </div>
                {snippetOf(n) && <div className="all-snippet">{snippetOf(n)}</div>}
              </div>
              <span className="all-meta">{ago(n.updated)}</span>
              <div className="all-actions" onClick={(e) => e.stopPropagation()}>
                {!n.archived && (
                  <button className={`icon-btn${n.pinned ? " active" : ""}`} title={n.pinned ? "Unpin" : "Pin"} onClick={() => api.updateNote(id, { pinned: !n.pinned })}>
                    <PinIcon />
                  </button>
                )}
                <button className="icon-btn" title="Next colour" onClick={() => api.updateNote(id, { color: nextColor(n.color) })}>
                  <PaletteIcon />
                </button>
                {n.archived ? (
                  <button className="icon-btn" title="Restore to the deck" onClick={() => api.updateNote(id, { archived: false })}>
                    <UnarchiveIcon />
                  </button>
                ) : (
                  <button className="icon-btn" title="Archive" onClick={() => api.updateNote(id, { archived: true })}>
                    <ArchiveIcon />
                  </button>
                )}
                <button className="icon-btn" title="Delete" onClick={() => remove(id)}>
                  <TrashIcon />
                </button>
                {canDrag && (
                  <span
                    className="grip"
                    title="Drag to reorder"
                    onPointerDown={(e) => reorder.onPointerDown(e, id)}
                  >
                    <GripIcon />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="all-foot">
        <button className="btn" onClick={doImport}>Import…</button>
        <button className="btn" onClick={() => doExport("json")}>Export JSON</button>
        <button className="btn" onClick={() => doExport("md")}>Export Markdown</button>
        <span className="spacer" />
        {toast && (
          <div className="toast" role="status">
            {toast.text}
            {toast.undo && <button onClick={undo}>Undo</button>}
          </div>
        )}
      </footer>
    </div>
  );
}
