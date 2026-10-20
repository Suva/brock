//! The app's native side: it opens the vault's database and answers the
//! window's few requests. The vault's logic lives in the window
//! (`src/core/`), so this stays small.

mod db;

use db::{Change, Db, Node};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

struct Vault(Mutex<Db>);

/// Where the vault is kept: `MINDMAP_DATA` if it is set, for trying things out
/// without touching the real vault, or else the app's data folder.
fn vault_path(app: &tauri::App) -> Result<PathBuf, String> {
    let dir = match std::env::var_os("MINDMAP_DATA") {
        Some(dir) => PathBuf::from(dir),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    Ok(dir.join("vault.sqlite"))
}

#[tauri::command]
fn load_vault(vault: State<Vault>) -> Result<Vec<Node>, String> {
    vault.0.lock().map_err(|e| e.to_string())?.load()
}

#[tauri::command]
fn apply_changes(vault: State<Vault>, changes: Vec<Change>) -> Result<(), String> {
    vault.0.lock().map_err(|e| e.to_string())?.apply(&changes)
}

#[tauri::command]
fn search(vault: State<Vault>, query: String, limit: usize) -> Result<Vec<String>, String> {
    vault.0.lock().map_err(|e| e.to_string())?.search(&query, limit)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = vault_path(app)?;
            let db = Db::open(&path)?;
            app.manage(Vault(Mutex::new(db)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load_vault, apply_changes, search])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
