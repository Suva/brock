//! The app's native side: it opens the vault's database and answers the
//! window's few requests. The vault's logic lives in the window
//! (`src/core/`), so this stays small.

mod backups;
mod db;

use db::{Change, Db, Node};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State};
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

#[tauri::command]
fn load_vault(vault: State<Vault>) -> Result<Vec<Node>, String> {
    lock(&vault)?.load()
}

#[tauri::command]
fn apply_changes(vault: State<Vault>, changes: Vec<Change>) -> Result<(), String> {
    lock(&vault)?.apply(&changes)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Opens web addresses from notes in the browser, when clicked; the
        // capability lets it open http and https addresses only.
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
            app.manage(Vault { db, backups });
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
            purge_nodes,
            search,
            list_backups,
            back_up_now,
            show_backups,
            save_text,
            save_bytes,
            open_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
