import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, ago, useNotes, MOD, type Note } from "../api";
import { COLORS, COLOR_NAMES, nextColor } from "../colors";
import { editorExtensions } from "../editor";
import { ArchiveIcon, CloseIcon, PaletteIcon, PinIcon, TrashIcon } from "../components/icons";

const UNDO_SECONDS = 10;
const SAVE_DELAY = 350;

export function NoteWindow({ id }: { id: string }) {
  const win = getCurrentWindow();
  const notes = useNotes();
  const note = notes?.find((n) => n.id === id);

  const [deleted, setDeleted] = useState<Note | null>(null);
  const [countdown, setCountdown] = useState(UNDO_SECONDS);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  const saveTimer = useRef<number>();
  const lastSaved = useRef<string | null>(null);
  const deletedRef = useRef(false);
  const closing = useRef(false);

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    onUpdate: () => {
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => flush(), SAVE_DELAY);
    },
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (link && (event.ctrlKey || event.metaKey)) {
          openUrl(link.href);
          return true;
        }
        return false;
      },
    },
  });

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    if (!editor || deletedRef.current) return;
    const html = editor.getHTML();
    if (html === lastSaved.current) return;
    lastSaved.current = html;
    await api.updateNote(id, { html, text: editor.getText({ blockSeparator: "\n" }) });
  }, [editor, id]);

  // Load the note into the editor once, then show the window.
  useEffect(() => {
    if (!editor || !note || lastSaved.current !== null) return;
    editor.commands.setContent(note.html || "", false);
    lastSaved.current = editor.getHTML();
    win.show().then(() => win.setFocus());
    editor.commands.focus("end");
  }, [editor, note]);

  // Apply changes made elsewhere (e.g. an import) unless the user is typing here.
  useEffect(() => {
    if (!editor || !note || lastSaved.current === null) return;
    if (note.html !== lastSaved.current && !editor.isFocused) {
      editor.commands.setContent(note.html || "", false);
      lastSaved.current = editor.getHTML();
    }
  }, [note?.html]);

  // Deleted from another window: nothing left to show here.
  useEffect(() => {
    if (notes && !note && !deletedRef.current) win.destroy();
  }, [notes, note]);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    if (!deletedRef.current && editor) {
      if (editor.getText().trim() === "" && !editor.getHTML().includes("<img")) {
        await api.deleteNote(id); // empty notes don't linger
      } else {
        await flush();
      }
    }
    await win.destroy();
  }, [editor, flush, id]);

  const remove = useCallback(async () => {
    await flush();
    deletedRef.current = true;
    const removed = await api.deleteNote(id);
    editor?.setEditable(false);
    setCountdown(UNDO_SECONDS);
    setDeleted(removed);
  }, [editor, flush, id]);

  const undo = useCallback(async () => {
    if (!deleted) return;
    await api.restoreNote(deleted);
    deletedRef.current = false;
    setDeleted(null);
    editor?.setEditable(true);
    editor?.commands.focus();
  }, [deleted, editor]);

  // Countdown runs only while a delete can still be undone.
  useEffect(() => {
    if (!deleted) return;
    if (countdown <= 0) {
      win.destroy();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [deleted, countdown]);

  const setColor = (color: Note["color"]) => {
    setPaletteOpen(false);
    api.updateNote(id, { color });
  };

  const openLinkBar = () => {
    if (!editor) return;
    setLinkValue(editor.getAttributes("link").href ?? "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    if (!editor) return;
    const href = linkValue.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run();
    else chain.unsetLink().run();
    setLinkOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (deleted) {
        if (mod && e.key.toLowerCase() === "z") {
          e.preventDefault();
          undo();
        } else if (e.key === "Escape") {
          win.destroy();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (linkOpen) setLinkOpen(false);
        else if (paletteOpen) setPaletteOpen(false);
        else close();
      } else if (mod && e.key === "." && note) {
        e.preventDefault();
        api.updateNote(id, { color: nextColor(note.color) });
      } else if (mod && e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openLinkBar();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deleted, linkOpen, paletteOpen, note, undo, close, remove]);

  // Save if the window is closed some other way.
  useEffect(() => {
    const unlisten = win.onCloseRequested(async (e) => {
      e.preventDefault();
      await close();
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, [close]);

  const color = note?.color ?? deleted?.color ?? "butter";

  return (
    <div className="note" data-color={color}>
      <header className="note-bar" data-tauri-drag-region>
        <div className="note-bar-actions">
          <button
            className={`icon-btn${note?.pinned ? " active" : ""}`}
            title={note?.pinned ? "Unpin" : "Pin to the top of the deck"}
            onClick={() => note && api.updateNote(id, { pinned: !note.pinned })}
            disabled={!note}
          >
            <PinIcon />
          </button>
          <div className="palette-wrap">
            <button className="icon-btn" title={`Colour (${MOD}+.)`} onClick={() => setPaletteOpen((o) => !o)} disabled={!note}>
              <PaletteIcon />
            </button>
            {paletteOpen && (
              <div className="palette" role="listbox" aria-label="Note colour">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`swatch${c === color ? " selected" : ""}`}
                    data-color={c}
                    title={COLOR_NAMES[c]}
                    aria-label={COLOR_NAMES[c]}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title="Archive"
            disabled={!note}
            onClick={async () => {
              await flush();
              await api.updateNote(id, { archived: true });
              win.destroy();
            }}
          >
            <ArchiveIcon />
          </button>
          <button className="icon-btn" title={`Delete (${MOD}+Backspace)`} onClick={remove} disabled={!note}>
            <TrashIcon />
          </button>
        </div>
        <span className="note-bar-spacer" data-tauri-drag-region />
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          <CloseIcon />
        </button>
      </header>

      <EditorContent editor={editor} className="note-editor" />

      {linkOpen && (
        <form
          className="link-bar"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            placeholder="Paste a link, or leave empty to remove"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
          />
          <button type="submit">Apply</button>
        </form>
      )}

      {note && !linkOpen && <footer className="note-foot">Edited {ago(note.updated)}</footer>}

      {deleted && (
        <div className="undo-overlay" role="alert">
          <span>Deleted. {countdown}s to undo.</span>
          <button onClick={undo}>Undo ({MOD}+Z)</button>
        </div>
      )}
    </div>
  );
}
