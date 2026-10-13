mod platform;
mod store;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use store::{Note, NotePatch, Settings, Store};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Wry,
};

const DECK_COLLAPSED_W: f64 = 14.0;
const DECK_EXPANDED_W: f64 = 300.0;
const NOTE_W: f64 = 340.0;
const NOTE_H: f64 = 360.0;

struct DeckState {
    expanded: Mutex<bool>,
    height: Mutex<f64>,
    ready: AtomicBool,
    fullscreen_hidden: AtomicBool,
}

impl Default for DeckState {
    fn default() -> Self {
        DeckState {
            expanded: Mutex::new(false),
            height: Mutex::new(160.0),
            ready: AtomicBool::new(false),
            fullscreen_hidden: AtomicBool::new(false),
        }
    }
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Apply a change to the notes, persist, and broadcast to every window.
fn mutate<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Vec<Note>) -> CmdResult<T>,
) -> CmdResult<T> {
    let store = app.state::<Store>();
    let (out, snapshot) = {
        let mut notes = store.notes.lock().unwrap();
        let out = f(&mut notes)?;
        (out, notes.clone())
    };
    store.save_notes(&snapshot).map_err(err)?;
    let _ = app.emit("notes-changed", &snapshot);
    Ok(out)
}

// ---------- windows ----------

fn window_builder<'a>(app: &'a AppHandle, label: &str) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .decorations(false)
        .skip_taskbar(true)
        .visible(false) // the page shows itself once rendered, so there is no white flash
        .disable_drag_drop_handler()
}

fn focus(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn create_deck(app: &AppHandle) -> tauri::Result<()> {
    let deck = WebviewWindowBuilder::new(app, "deck", WebviewUrl::App("index.html".into()))
        .title("EdgeNotes")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .visible_on_all_workspaces(true)
        .disable_drag_drop_handler()
        .inner_size(DECK_COLLAPSED_W, 160.0)
        .build()?;
    platform::hide_from_alt_tab(&deck);
    layout_deck(app);
    Ok(())
}

/// Snap the deck to the chosen edge of the primary monitor's work area.
fn layout_deck(app: &AppHandle) {
    let Some(deck) = app.get_webview_window("deck") else {
        return;
    };
    let state = app.state::<DeckState>();
    let expanded = *state.expanded.lock().unwrap();
    let height = *state.height.lock().unwrap();
    let edge = app.state::<Store>().settings.lock().unwrap().edge.clone();

    let Some(monitor) = deck
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| deck.current_monitor().ok().flatten())
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let width = if expanded { DECK_EXPANDED_W } else { DECK_COLLAPSED_W };
    let w = (width * scale).round() as i32;
    let max_h = (area.size.height as f64 * 0.85) as i32;
    let h = ((height * scale).round() as i32).clamp((80.0 * scale) as i32, max_h.max(1));
    let x = if edge == "left" {
        area.position.x
    } else {
        area.position.x + area.size.width as i32 - w
    };
    let y = area.position.y + (area.size.height as i32 - h) / 2;
    let _ = deck.set_size(PhysicalSize::new(w as u32, h as u32));
    let _ = deck.set_position(PhysicalPosition::new(x, y));
}

pub(crate) fn set_fullscreen_hidden(app: &AppHandle, fullscreen: bool) {
    let enabled = app.state::<Store>().settings.lock().unwrap().hide_in_fullscreen;
    let hide = enabled && fullscreen;
    let state = app.state::<DeckState>();
    if state.fullscreen_hidden.swap(hide, Ordering::SeqCst) == hide {
        return;
    }
    if !state.ready.load(Ordering::SeqCst) {
        return;
    }
    if let Some(deck) = app.get_webview_window("deck") {
        if hide {
            let _ = deck.hide();
        } else {
            platform::show_no_activate(&deck);
        }
    }
}

/// Place new notes beside the deck, cascading so they don't stack exactly.
fn note_position(app: &AppHandle) -> (f64, f64) {
    let open = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("note-"))
        .count() as f64;
    let edge = app.state::<Store>().settings.lock().unwrap().edge.clone();
    let monitor = app.primary_monitor().ok().flatten();
    let Some(m) = monitor else {
        return (100.0 + open * 28.0, 100.0 + open * 28.0);
    };
    let scale = m.scale_factor();
    let area = m.work_area();
    let left = area.position.x as f64 / scale;
    let top = area.position.y as f64 / scale;
    let right = left + area.size.width as f64 / scale;
    let step = (open % 8.0) * 28.0;
    let x = if edge == "left" {
        left + DECK_EXPANDED_W + 24.0 + step
    } else {
        right - DECK_EXPANDED_W - NOTE_W - 24.0 - step
    };
    (x, top + 96.0 + step)
}

fn open_note_window(app: &AppHandle, id: &str) -> tauri::Result<()> {
    let label = format!("note-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        focus(&w);
        return Ok(());
    }
    let (x, y) = note_position(app);
    let w = window_builder(app, &label)
        .title("Note")
        .inner_size(NOTE_W, NOTE_H)
        .min_inner_size(240.0, 180.0)
        .position(x, y)
        .build()?;
    platform::hide_from_alt_tab(&w);
    Ok(())
}

fn open_all_window(app: &AppHandle, tab: &str) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("all") {
        let _ = w.emit("all-tab", tab);
        focus(&w);
        return Ok(());
    }
    let tab = if tab == "archive" { "archive" } else { "notes" };
    let w = window_builder(app, "all")
        .title("All notes")
        .initialization_script(&format!("window.__INITIAL_TAB__ = '{tab}';"))
        .inner_size(780.0, 620.0)
        .min_inner_size(480.0, 360.0)
        .center()
        .build()?;
    platform::hide_from_alt_tab(&w);
    Ok(())
}

fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("settings") {
        focus(&w);
        return Ok(());
    }
    let w = window_builder(app, "settings")
        .title("Settings")
        .inner_size(480.0, 640.0)
        .min_inner_size(400.0, 420.0)
        .center()
        .build()?;
    platform::hide_from_alt_tab(&w);
    Ok(())
}

fn new_note(app: &AppHandle) -> CmdResult<Note> {
    let note = mutate(app, |notes| {
        let top = notes.iter().map(|n| n.order).fold(0.0, f64::min);
        let note = Note::new("butter".into(), top - 1.0);
        notes.push(note.clone());
        Ok(note)
    })?;
    open_note_window(app, &note.id).map_err(err)?;
    Ok(note)
}

// ---------- commands ----------

#[tauri::command]
fn get_notes(store: State<Store>) -> Vec<Note> {
    store.notes.lock().unwrap().clone()
}

#[tauri::command]
fn create_note(app: AppHandle) -> CmdResult<Note> {
    new_note(&app)
}

#[tauri::command]
fn update_note(app: AppHandle, id: String, patch: NotePatch) -> CmdResult<Note> {
    mutate(&app, |notes| {
        let note = notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or("note not found")?;
        let mut edited = false;
        if let Some(html) = patch.html {
            edited |= note.html != html;
            note.html = html;
        }
        if let Some(text) = patch.text {
            note.text = text;
        }
        if let Some(color) = patch.color {
            if store::COLORS.contains(&color.as_str()) {
                note.color = color;
            }
        }
        if let Some(pinned) = patch.pinned {
            note.pinned = pinned;
        }
        if let Some(archived) = patch.archived {
            note.archived = archived;
        }
        if edited {
            note.updated = store::now();
        }
        Ok(note.clone())
    })
}

/// Removes the note and hands it back so the caller can offer an undo.
#[tauri::command]
fn delete_note(app: AppHandle, id: String) -> CmdResult<Option<Note>> {
    mutate(&app, |notes| {
        let pos = notes.iter().position(|n| n.id == id);
        Ok(pos.map(|i| notes.remove(i)))
    })
}

#[tauri::command]
fn restore_note(app: AppHandle, note: Note) -> CmdResult<()> {
    mutate(&app, |notes| {
        if !notes.iter().any(|n| n.id == note.id) {
            notes.push(note.sanitize());
        }
        Ok(())
    })
}

#[tauri::command]
fn reorder_notes(app: AppHandle, ids: Vec<String>) -> CmdResult<()> {
    mutate(&app, |notes| {
        for (i, id) in ids.iter().enumerate() {
            if let Some(n) = notes.iter_mut().find(|n| &n.id == id) {
                n.order = i as f64;
            }
        }
        Ok(())
    })
}

#[tauri::command]
fn open_note(app: AppHandle, id: String) -> CmdResult<()> {
    open_note_window(&app, &id).map_err(err)
}

#[tauri::command]
fn open_all(app: AppHandle, tab: Option<String>) -> CmdResult<()> {
    open_all_window(&app, tab.as_deref().unwrap_or("notes")).map_err(err)
}

#[tauri::command]
fn open_settings(app: AppHandle) -> CmdResult<()> {
    open_settings_window(&app).map_err(err)
}

#[tauri::command]
fn get_settings(store: State<Store>) -> Settings {
    store.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> CmdResult<()> {
    let store = app.state::<Store>();
    store.save_settings(&settings).map_err(err)?;
    *store.settings.lock().unwrap() = settings.clone();
    let _ = app.emit("settings-changed", &settings);
    layout_deck(&app);
    #[cfg(windows)]
    platform::fullscreen::recheck();
    #[cfg(not(windows))]
    set_fullscreen_hidden(&app, false);
    Ok(())
}

#[tauri::command]
fn set_deck_state(app: AppHandle, expanded: bool, height: f64) {
    let state = app.state::<DeckState>();
    *state.expanded.lock().unwrap() = expanded;
    *state.height.lock().unwrap() = height;
    layout_deck(&app);
}

/// Called by the deck page once it has painted.
#[tauri::command]
fn deck_ready(app: AppHandle) {
    let state = app.state::<DeckState>();
    state.ready.store(true, Ordering::SeqCst);
    if !state.fullscreen_hidden.load(Ordering::SeqCst) {
        if let Some(deck) = app.get_webview_window("deck") {
            layout_deck(&app);
            platform::show_no_activate(&deck);
        }
    }
}

#[derive(serde::Serialize)]
struct DataInfo {
    path: String,
    portable: bool,
}

#[tauri::command]
fn data_info(store: State<Store>) -> DataInfo {
    DataInfo {
        path: store.dir.join("notes.json").to_string_lossy().into_owned(),
        portable: store.portable,
    }
}

#[tauri::command]
fn reveal_data(app: AppHandle) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let path = app.state::<Store>().dir.join("notes.json");
    app.opener().reveal_item_in_dir(path).map_err(err)
}

#[tauri::command]
fn export_notes(store: State<Store>, path: String, format: String) -> CmdResult<usize> {
    let notes = store.notes.lock().unwrap().clone();
    let data = if format == "md" {
        store::to_markdown(&notes)
    } else {
        serde_json::to_string_pretty(&serde_json::json!({ "version": 1, "notes": notes }))
            .map_err(err)?
    };
    std::fs::write(&path, data).map_err(err)?;
    Ok(notes.len())
}

#[tauri::command]
fn import_notes(app: AppHandle, path: String) -> CmdResult<usize> {
    let raw = std::fs::read_to_string(&path).map_err(err)?;
    let is_json = path.to_lowercase().ends_with(".json");
    let incoming: Vec<Note> = if is_json {
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(err)?;
        store::parse_notes(value)
    } else {
        let mut note = Note::new("butter".into(), 0.0);
        note.text = raw.clone();
        note.html = store::text_to_html(&raw);
        vec![note]
    };
    mutate(&app, |notes| {
        let mut top = notes.iter().map(|n| n.order).fold(0.0, f64::min);
        let count = incoming.len();
        for mut note in incoming {
            if notes.iter().any(|n| n.id == note.id) {
                note.id = uuid::Uuid::new_v4().to_string();
            }
            top -= 1.0;
            note.order = top;
            notes.push(note);
        }
        Ok(count)
    })
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------- tray & shortcuts ----------

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "new", "New note", true, Some("Ctrl+Alt+N"))?,
            &MenuItem::with_id(app, "all", "All notes", true, Some("Ctrl+Alt+A"))?,
            &MenuItem::with_id(app, "archive", "Archive", true, Some("Ctrl+Alt+L"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Quit EdgeNotes", true, None::<&str>)?,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("EdgeNotes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "new" => {
                let _ = new_note(app);
            }
            "all" => {
                let _ = open_all_window(app, "notes");
            }
            "archive" => {
                let _ = open_all_window(app, "archive");
            }
            "settings" => {
                let _ = open_settings_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = open_all_window(tray.app_handle(), "notes");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(desktop)]
fn register_shortcuts(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };
    let mods = Some(Modifiers::CONTROL | Modifiers::ALT);
    let new = Shortcut::new(mods, Code::KeyN);
    let all = Shortcut::new(mods, Code::KeyA);
    let archive = Shortcut::new(mods, Code::KeyL);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if shortcut == &new {
                    let _ = new_note(app);
                } else if shortcut == &all {
                    let _ = open_all_window(app, "notes");
                } else if shortcut == &archive {
                    let _ = open_all_window(app, "archive");
                }
            })
            .build(),
    )?;
    // If another app already owns a shortcut, quietly do without it.
    for shortcut in [new, all, archive] {
        let _ = app.global_shortcut().register(shortcut);
    }
    Ok(())
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                let _ = open_all_window(app, "notes");
            }))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--autostart"]),
            ));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DeckState::default())
        .setup(|app| {
            app.manage(Store::load()?);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle();
            create_deck(handle)?;
            create_tray(handle)?;
            #[cfg(desktop)]
            register_shortcuts(handle)?;
            #[cfg(windows)]
            platform::fullscreen::install(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "deck" {
                if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                    layout_deck(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_notes,
            create_note,
            update_note,
            delete_note,
            restore_note,
            reorder_notes,
            open_note,
            open_all,
            open_settings,
            get_settings,
            set_settings,
            set_deck_state,
            deck_ready,
            data_info,
            reveal_data,
            export_notes,
            import_notes,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start EdgeNotes")
        .run(|_app, event| {
            // Closing every note window must not quit: the app lives in the tray.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
