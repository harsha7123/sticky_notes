//! Local-only storage: notes.json and settings.json in the data folder.
//! Writes are atomic (temp file + rename) and a .bak copy of the last good
//! notes file is kept, so a crash mid-write never loses notes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

pub const COLORS: [&str; 8] = [
    "butter", "peach", "rose", "lilac", "sky", "mint", "sage", "stone",
];

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Note {
    pub id: String,
    pub html: String,
    pub text: String,
    pub color: String,
    pub pinned: bool,
    pub archived: bool,
    pub order: f64,
    pub created: i64,
    pub updated: i64,
}

impl Note {
    pub fn new(color: String, order: f64) -> Self {
        let t = now();
        Note {
            id: uuid::Uuid::new_v4().to_string(),
            color,
            order,
            created: t,
            updated: t,
            ..Default::default()
        }
    }

    /// Fill in anything missing or invalid, e.g. after an import.
    pub fn sanitize(mut self) -> Self {
        if self.id.is_empty() {
            self.id = uuid::Uuid::new_v4().to_string();
        }
        if !COLORS.contains(&self.color.as_str()) {
            self.color = "butter".into();
        }
        if self.created == 0 {
            self.created = now();
        }
        if self.updated == 0 {
            self.updated = self.created;
        }
        self
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub html: Option<String>,
    pub text: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "left" or "right"
    pub edge: String,
    /// "system", "light" or "dark"
    pub theme: String,
    pub hide_in_fullscreen: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            edge: "right".into(),
            theme: "system".into(),
            hide_in_fullscreen: true,
        }
    }
}

#[derive(Serialize)]
struct NotesFile<'a> {
    version: u32,
    notes: &'a [Note],
}

pub struct Store {
    pub dir: PathBuf,
    pub portable: bool,
    pub notes: Mutex<Vec<Note>>,
    pub settings: Mutex<Settings>,
}

impl Store {
    pub fn load() -> io::Result<Self> {
        let (dir, portable) = data_dir();
        fs::create_dir_all(&dir)?;
        let notes = load_notes(&dir);
        let settings = fs::read_to_string(dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Ok(Store {
            dir,
            portable,
            notes: Mutex::new(notes),
            settings: Mutex::new(settings),
        })
    }

    pub fn save_notes(&self, notes: &[Note]) -> io::Result<()> {
        let data = serde_json::to_vec_pretty(&NotesFile { version: 1, notes })
            .map_err(io::Error::other)?;
        write_atomic(&self.dir.join("notes.json"), &data)
    }

    pub fn save_settings(&self, settings: &Settings) -> io::Result<()> {
        let data = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
        write_atomic(&self.dir.join("settings.json"), &data)
    }
}

/// A file or folder named `portable` next to the executable switches to
/// portable mode: notes live beside the app instead of in Documents.
fn data_dir() -> (PathBuf, bool) {
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
    {
        if exe_dir.join("portable").exists() || exe_dir.join("portable.txt").exists() {
            return (exe_dir.join("EdgeNotes Data"), true);
        }
    }
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    (base.join("EdgeNotes"), false)
}

fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)
}

fn load_notes(dir: &Path) -> Vec<Note> {
    let main = dir.join("notes.json");
    let bak = dir.join("notes.json.bak");
    if !main.exists() {
        return read_notes_file(&bak).unwrap_or_default();
    }
    match read_notes_file(&main) {
        Some(notes) => {
            let _ = fs::copy(&main, &bak);
            notes
        }
        None => {
            // Keep the unreadable file aside rather than overwriting it.
            let _ = fs::copy(&main, dir.join(format!("notes.corrupt-{}.json", now())));
            read_notes_file(&bak).unwrap_or_default()
        }
    }
}

fn read_notes_file(path: &Path) -> Option<Vec<Note>> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    Some(parse_notes(value))
}

/// Accepts either `{ "notes": [...] }` or a bare array.
pub fn parse_notes(value: Value) -> Vec<Note> {
    let items = match value {
        Value::Array(a) => a,
        Value::Object(mut o) => match o.remove("notes") {
            Some(Value::Array(a)) => a,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    items
        .into_iter()
        .filter_map(|v| serde_json::from_value::<Note>(v).ok())
        .map(Note::sanitize)
        .collect()
}

pub fn text_to_html(text: &str) -> String {
    text.lines()
        .map(|line| {
            let escaped = line
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            format!("<p>{escaped}</p>")
        })
        .collect()
}

pub fn to_markdown(notes: &[Note]) -> String {
    notes
        .iter()
        .map(|n| n.text.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n---\n\n")
}
