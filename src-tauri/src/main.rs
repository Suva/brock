// Keeps a console window from opening beside the app on Windows. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mindmap_lib::run()
}
