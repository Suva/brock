// Keeps a console window from opening beside the app on Windows. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `brock --mcp` is the MCP server agents start (see mcp.rs): no window, and
    // nothing of the app, only the protocol on the standard streams.
    if std::env::args().any(|a| a == "--mcp") {
        brock_lib::mcp::run();
        return;
    }
    brock_lib::run()
}
