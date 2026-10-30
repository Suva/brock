//! The app's native side: it opens the vault's database and answers the
//! window's few requests. The vault's logic lives in the window
//! (`src/core/`), so this stays small.

mod agent;
mod backups;
mod db;
mod maintenance;
pub mod mcp;

use db::{Change, Db, LogEntry, Node};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct Vault {
    db: Arc<Mutex<Db>>,
    /// The folder the daily copies go into.
    backups: PathBuf,
}

/// How often the app looks whether today's copy is due, while it stays open.
const BACKUP_CHECK: Duration = Duration::from_secs(60 * 60);

/// The window starts hidden and the page shows it once it is drawn, so that
/// it does not flash white; if the page never does, it is shown after this.
const SHOW_ANYWAY: Duration = Duration::from_secs(3);

/// The app's identifier before it was called Brock: its data folder holds the
/// vaults made then, which are copied over on the first start (`carry_over`).
const OLD_IDENTIFIER: &str = "com.jaanpullerits.mindmap";

/// Where the vault is kept: `BROCK_DATA` if it is set, for trying things out
/// without touching the real vault, or else the app's data folder.
fn vault_path(app: &tauri::App) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("BROCK_DATA") {
        return Ok(PathBuf::from(dir).join("vault.sqlite"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Some(parent) = dir.parent() {
        // A copy that cannot be made must not keep the app from starting.
        match db::carry_over(&parent.join(OLD_IDENTIFIER), &dir) {
            Ok(true) => eprintln!("Copied the vault from {}", parent.join(OLD_IDENTIFIER).display()),
            Ok(false) => {}
            Err(e) => eprintln!("{e}"),
        }
    }
    Ok(dir.join("vault.sqlite"))
}

fn lock<'a>(vault: &'a State<Vault>) -> Result<std::sync::MutexGuard<'a, Db>, String> {
    vault.db.lock().map_err(|e| e.to_string())
}

/// How long a request from an agent waits for the window's answer.
const AGENT_ANSWER_WITHIN: Duration = Duration::from_secs(15);

/// The door agents knock on, while they are allowed, and the requests that
/// have been passed to the window and wait for its answer.
struct Agents {
    /// The vault's folder, where `agent.json` is written.
    dir: PathBuf,
    door: Mutex<Option<agent::Door>>,
    waiting: Arc<Mutex<HashMap<u64, mpsc::Sender<serde_json::Value>>>>,
    count: Arc<AtomicU64>,
}

/// Opens or closes the door. The window asks for it by what the person has
/// allowed (Settings), and again each time the app starts.
#[tauri::command]
fn agent_enable(app: tauri::AppHandle, agents: State<Agents>, enabled: bool) -> Result<(), String> {
    let mut door = agents.door.lock().map_err(|e| e.to_string())?;
    // `brock --mcp` reads this to know whether to start the app for an agent.
    agent::set_allowed(&agents.dir, enabled)?;
    if !enabled {
        *door = None;
        return Ok(());
    }
    if door.is_some() {
        return Ok(());
    }
    let (waiting, count) = (agents.waiting.clone(), agents.count.clone());
    let handler: agent::Handler = Arc::new(move |request| {
        let id = count.fetch_add(1, Ordering::Relaxed);
        let (send, receive) = mpsc::channel();
        if let Ok(mut waiting) = waiting.lock() {
            waiting.insert(id, send);
        }
        let answer = match app.emit_to("main", "agent-request", serde_json::json!({ "id": id, "request": request })) {
            Ok(()) => receive
                .recv_timeout(AGENT_ANSWER_WITHIN)
                .unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": "Brock did not answer in time." })),
            Err(e) => serde_json::json!({ "ok": false, "error": format!("Brock cannot be reached: {e}") }),
        };
        if let Ok(mut waiting) = waiting.lock() {
            waiting.remove(&id);
        }
        answer
    });
    *door = Some(agent::Door::open(&agents.dir, handler)?);
    Ok(())
}

/// The window's answer to a request it was passed.
#[tauri::command]
fn agent_reply(agents: State<Agents>, id: u64, reply: serde_json::Value) {
    let sender = agents.waiting.lock().ok().and_then(|mut waiting| waiting.remove(&id));
    if let Some(sender) = sender {
        let _ = sender.send(reply);
    }
}

/// This app's own executable, which is what an agent starts, with `--mcp`, to
/// work with it (see `mcp.rs`).
#[tauri::command]
fn agent_executable() -> Option<String> {
    std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_vault(vault: State<Vault>) -> Result<Vec<Node>, String> {
    lock(&vault)?.load()
}

/// `source` says who made the changes ('user' if not said), for the History tab.
#[tauri::command]
fn apply_changes(vault: State<Vault>, changes: Vec<Change>, source: Option<String>) -> Result<(), String> {
    lock(&vault)?.apply_from(&changes, source.as_deref().unwrap_or("user"))
}

/// The latest entries of the log, newest first.
#[tauri::command]
fn load_history(vault: State<Vault>, limit: usize) -> Result<Vec<LogEntry>, String> {
    lock(&vault)?.history(limit.min(5000))
}

#[tauri::command]
fn purge_nodes(vault: State<Vault>, ids: Vec<String>) -> Result<(), String> {
    lock(&vault)?.purge(&ids)
}

#[tauri::command]
fn search(vault: State<Vault>, query: String, limit: usize) -> Result<Vec<String>, String> {
    lock(&vault)?.search(&query, limit)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Backups {
    folder: String,
    keep: usize,
    copies: Vec<backups::Backup>,
}

#[tauri::command]
fn list_backups(vault: State<Vault>) -> Backups {
    Backups {
        folder: vault.backups.to_string_lossy().into_owned(),
        keep: backups::KEEP,
        copies: backups::list(&vault.backups),
    }
}

#[tauri::command]
fn back_up_now(vault: State<Vault>) -> Result<Backups, String> {
    lock(&vault)?.back_up(&vault.backups)?;
    Ok(list_backups(vault))
}

/// Shows the folder of copies in Finder or Explorer.
#[tauri::command]
fn show_backups(app: tauri::AppHandle, vault: State<Vault>) -> Result<(), String> {
    std::fs::create_dir_all(&vault.backups).map_err(|e| e.to_string())?;
    app.opener().reveal_item_in_dir(&vault.backups).map_err(|e| e.to_string())
}

/// What a file linked from a note may be, by its extension, to be opened in
/// its own app: documents, pictures, sound and video. A folder with no
/// extension opens too. Anything else is only shown in Finder or Explorer,
/// since it might be a program (`.app`, `.command`, `.exe`, a script, a file
/// with no extension) and a link in a pasted note is clicked without thought.
const DOCUMENTS: &[&str] = &[
    "pdf", "txt", "md", "markdown", "rtf", "rtfd", "csv", "tsv", "json", "yaml", "yml", "log", "doc", "docx", "xls",
    "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key", "epub", "png", "jpg", "jpeg", "gif", "webp",
    "heic", "heif", "tif", "tiff", "bmp", "svg", "psd", "ai", "sketch", "fig", "xd", "afdesign", "afphoto", "mp3",
    "m4a", "wav", "aif", "aiff", "flac", "ogg", "mp4", "m4v", "mov", "avi", "mkv", "webm", "zip",
];

/// Whether the file or folder at `path` is one that may be opened.
fn opens_safely(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => DOCUMENTS.contains(&ext.to_ascii_lowercase().as_str()),
        // On a Mac an app is a folder too, but it always has its `.app`.
        None => path.is_dir(),
    }
}

/// Opens a file or folder a note links to, as a `file:` address: in its own
/// app if `opens_safely` allows it, both as linked and where a link on the
/// disk leads, or else shows it in Finder or Explorer without opening it.
#[tauri::command]
fn open_file(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let path = tauri::Url::parse(&url)
        .ok()
        .filter(|u| u.scheme() == "file")
        .and_then(|u| u.to_file_path().ok())
        .ok_or_else(|| format!("{url} is not the address of a file"))?;
    let real = std::fs::canonicalize(&path).map_err(|_| format!("There is nothing at {}", path.display()))?;
    if opens_safely(&path) && opens_safely(&real) {
        app.opener().open_path(path.to_string_lossy(), None::<&str>)
    } else {
        app.opener().reveal_item_in_dir(&path)
    }
    .map_err(|e| e.to_string())
}

/// The kinds of file the window exports and imports: (extension, name shown).
fn filter(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "json" => Ok(("json", "JSON")),
        "md" => Ok(("md", "Markdown")),
        "opml" => Ok(("opml", "OPML")),
        "svg" => Ok(("svg", "SVG picture")),
        "png" => Ok(("png", "PNG picture")),
        _ => Err(format!("Unknown kind of file: {kind}")),
    }
}

/// Asks where to save, with the system's dialog, and writes the text there.
/// The window never names a path itself. Returns the file's name, or None if
/// the person cancelled. Async, so the dialog is not opened on the main
/// thread, which would freeze the app on macOS.
#[tauri::command]
async fn save_text(app: tauri::AppHandle, name: String, content: String, kind: String) -> Result<Option<String>, String> {
    let (ext, label) = filter(&kind)?;
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(label, &[ext]).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// As `save_text`, for a file that is not text: a picture.
#[tauri::command]
async fn save_bytes(app: tauri::AppHandle, name: String, bytes: Vec<u8>, kind: String) -> Result<Option<String>, String> {
    let (ext, label) = filter(&kind)?;
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(label, &[ext]).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// The largest file brought in: an outline larger than this is not one.
const LARGEST_IMPORT: u64 = 50 * 1024 * 1024;

/// Asks for a file to bring in, with the system's dialog, and reads it.
/// Returns None if the person cancelled.
#[tauri::command]
async fn open_text(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("OPML or JSON", &["opml", "xml", "json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > LARGEST_IMPORT {
        return Err("The file is too large to be an outline.".into());
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::opens_safely;

    #[test]
    fn documents_and_plain_folders_open_and_programs_do_not() {
        let dir = std::env::temp_dir().join(format!("brock-open-{}", std::process::id()));
        for name in ["Designs", "Brock.app", "Report.PDF", "run.command", "tool"] {
            let path = dir.join(name);
            if name == "Designs" || name.ends_with(".app") {
                std::fs::create_dir_all(&path).unwrap();
            } else {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(&path, "").unwrap();
            }
        }
        assert!(opens_safely(&dir.join("Designs")), "a folder");
        assert!(opens_safely(&dir.join("Report.PDF")), "a document, whatever the case of its extension");
        assert!(!opens_safely(&dir.join("Brock.app")), "an app, though a folder");
        assert!(!opens_safely(&dir.join("run.command")), "a script");
        assert!(!opens_safely(&dir.join("tool")), "a file without an extension may be a program");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // One copy of the app at a time, so that an agent asking for it while it is
    // open, or a second launch on Windows and Linux, brings its window forward
    // rather than starting another on the same vault. Not in development builds,
    // which share the installed app's identifier and are run beside it.
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    builder
        // Opens web addresses from notes in the browser, when clicked; the
        // capability lets the window open http and https addresses only.
        // Files are opened from Rust, by `open_file`, with its own rules.
        .plugin(tauri_plugin_opener::init())
        // The save and open dialogs of export and import, used from Rust only.
        .plugin(tauri_plugin_dialog::init())
        // Copy and paste of branches: text only, read only when ⌘V is pressed.
        .plugin(tauri_plugin_clipboard_manager::init())
        // The app's own updates: the window asks for the newest release's
        // latest.json, and installs it only when the person agrees; then
        // restarts the app with the process plugin.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let path = vault_path(app)?;
            let db = Db::open(&path)?;
            let backups = backups::folder(&path);
            // A copy that cannot be made must not keep the vault from opening.
            if let Err(e) = db.back_up_if_due(&backups) {
                eprintln!("{e}");
            }
            let db = Arc::new(Mutex::new(db));
            let (shared, dir) = (db.clone(), backups.clone());
            std::thread::spawn(move || loop {
                std::thread::sleep(BACKUP_CHECK);
                if let Ok(db) = shared.lock() {
                    if let Err(e) = db.back_up_if_due(&dir) {
                        eprintln!("{e}");
                    }
                }
            });
            // Tidying the log and giving space back, in the background, a while after the window is up.
            maintenance::spawn(path.clone());
            app.manage(Vault { db, backups });
            // A file left by an earlier run points at a door that is gone.
            let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
            let _ = std::fs::remove_file(dir.join(agent::FILE));
            app.manage(Agents { dir, door: Mutex::new(None), waiting: Arc::default(), count: Arc::default() });
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY);
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_vault,
            apply_changes,
            load_history,
            purge_nodes,
            search,
            list_backups,
            back_up_now,
            show_backups,
            open_file,
            save_text,
            save_bytes,
            open_text,
            agent_enable,
            agent_reply,
            agent_executable
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
