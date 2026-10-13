# EdgeNotes

Sticky notes that live at the edge of your screen. Local-first, light on resources, cross-platform (Windows, macOS, Linux; mobile planned).

## Develop

Prerequisites: Node 20+, Rust (stable), and on Windows the MSVC C++ build tools.

```bash
npm install
npm run tauri dev
```

### Live web demo

The same UI also runs in a plain browser as a simulated desktop (deck on the screen edge, draggable note windows, tray menu), backed by browser storage instead of the Rust core:

```bash
npm run dev
```

Then open http://localhost:1420. Use the tray icon's **Reset demo** to restore the sample notes. Import, start-at-login and fullscreen hiding only work in the desktop app.

Release build (installers land in `src-tauri/target/release/bundle/`):

```bash
npm run tauri build
```

## What's in phase 1

- **Deck** – a slim handle on the left or right edge; hover to expand, hover a tab to peek, click to open, drag to reorder.
- **One window per note** – rich text with lists that start themselves (`- `, `1. `, `[ ] `), bold/italic, links (Ctrl+K, Ctrl+click to open).
- **Eight colours** (Ctrl+.), pin, archive, delete with 10 s undo (Ctrl+Backspace, then Ctrl+Z).
- **All notes** – search, sort (manual / edited / created / colour), drag to reorder, archive tab, import (JSON/MD/TXT) and export (JSON/Markdown).
- **Global shortcuts** – Ctrl+Alt+N new note, Ctrl+Alt+A all notes, Ctrl+Alt+L archive. Skipped silently if another app owns them.
- **Out of the way** – no taskbar button or Alt+Tab entry, tray menu, start at login, hides while a fullscreen app covers the main display (Windows, event-driven, no polling).
- **Local only** – `Documents/EdgeNotes/notes.json`, atomic writes, `.bak` copy, corrupt files kept aside rather than overwritten. Put a file named `portable` next to the executable to store notes beside the app.

## Layout

```
src/                React UI (one bundle; the window label picks the view)
  views/            Deck, NoteWindow, AllNotes, SettingsView
  api.ts            typed commands + live note/settings subscriptions
  editor.ts         TipTap extensions
src-tauri/src/
  lib.rs            windows, tray, shortcuts, commands
  store.rs          notes/settings persistence
  platform.rs       Win32 tool-window style + fullscreen detection
```

## Roadmap

2. Markdown blocks (code, tables, images), tags, reminders with OS notifications, clipboard/screenshot capture, app-linked notes.
3. Optional end-to-end encrypted sync.
4. Linux polish, iOS/Android companion.
5. Signing, auto-update, store packaging, licensing.
