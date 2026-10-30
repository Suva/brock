//! `brock --mcp`: the app's own executable acting as an MCP server for AI
//! agents, so that nothing else has to be installed. It speaks MCP (JSON-RPC,
//! a message to a line) on its standard input and output, and passes each tool
//! call to the running app over the loopback door the app opens while agents
//! are allowed (`agent.rs`). The app answers from the vault it holds, for the
//! maps the person has shared; this reads no vault and holds no data.
//!
//! Nothing but protocol may be written to standard output, and no window is
//! made here: `main` comes here before anything of the app starts. If the app is
//! not open and the person has allowed agents, it is started, as it would be by
//! a double click, and waited for.

use serde_json::{json, Map, Value};
use std::cell::Cell;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// What the app is called on disk: its folder is named by it, as in `tauri.conf.json`.
const IDENTIFIER: &str = "app.getbrock.brock";
const NEWEST_PROTOCOL: &str = "2025-06-18";
/// A little over the app's own wait for the window, so its answer is the one heard.
const WAIT: Duration = Duration::from_secs(20);
const CONNECT_WITHIN: Duration = Duration::from_secs(5);
/// How long to wait for the app's door after starting it: the window has to load first.
const LAUNCH_WAIT: Duration = Duration::from_secs(25);
const LOOK_EVERY: Duration = Duration::from_millis(300);
const NOT_ALLOWED: &str = "Agents are not allowed in Brock. Open Brock, turn on Settings › Agents and share a map, then try again.";
/// The longest answer read: a reply is cut well before this by the app.
const MAX_ANSWER: u64 = 8 * 1024 * 1024;

const TOOLS: &str = include_str!("mcp-tools.json");

/// Serves MCP on this process's standard input and output until it closes.
pub fn run() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    serve(stdin.lock(), stdout.lock(), &Shim::new(data_folder()));
}

/// What the server knows while it runs: where the vault is, how to start the
/// app, and when it last did.
pub struct Shim {
    folder: PathBuf,
    /// Starts the app. A parameter so that tests can start a stand-in.
    launch: Box<dyn Fn() -> std::io::Result<()>>,
    /// How long to wait for the app's door after starting it.
    wait: Duration,
    started: Cell<Option<Instant>>,
}

impl Shim {
    pub fn new(folder: PathBuf) -> Shim {
        Shim::with(folder, Box::new(launch_app), LAUNCH_WAIT)
    }

    pub fn with(folder: PathBuf, launch: Box<dyn Fn() -> std::io::Result<()>>, wait: Duration) -> Shim {
        Shim { folder, launch, wait, started: Cell::new(None) }
    }

    /// Asks the app one thing: its answer's text, or what to tell the agent if it cannot.
    fn ask(&self, request: Value) -> Result<String, String> {
        match knock(&request, &self.folder) {
            Ok(text) => return Ok(text),
            Err(Knock::Failed(why)) => return Err(why),
            Err(Knock::Closed) => {}
        }
        // Nothing answers. Starting the app is for the person who allowed agents, and not otherwise.
        if !crate::agent::is_allowed(&self.folder) {
            return Err(NOT_ALLOWED.into());
        }
        // Started a moment ago and still loading: wait for it; do not start another.
        let started = match self.started.get() {
            Some(at) if at.elapsed() < self.wait => at,
            _ => {
                (self.launch)().map_err(|e| format!("Brock could not be started: {e}"))?;
                let now = Instant::now();
                self.started.set(Some(now));
                now
            }
        };
        loop {
            match knock(&request, &self.folder) {
                Ok(text) => return Ok(text),
                Err(Knock::Failed(why)) => return Err(why),
                Err(Knock::Closed) if started.elapsed() >= self.wait => {
                    return Err("Brock was started but has not opened its door. Check that Settings › Agents is on, and try again.".into())
                }
                Err(Knock::Closed) => std::thread::sleep(LOOK_EVERY),
            }
        }
    }
}

/// Starts the app, as a double click would, and leaves it running when this ends.
fn launch_app() -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()?;
    // On a Mac, through the system, so that it opens behind what the person is doing
    // and an app already running is not started twice. Not when `BROCK_DATA` is set:
    // the system does not pass it on, and that is someone trying things out.
    #[cfg(target_os = "macos")]
    if std::env::var_os("BROCK_DATA").is_none() {
        if let Some(bundle) = exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")) {
            let status = Command::new("open").arg("-g").arg(bundle).status()?;
            return if status.success() { Ok(()) } else { Err(std::io::Error::other("the system could not open it")) };
        }
    }
    let mut command = Command::new(exe);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // Out of this process's group, so that an agent ending its server does not end the app.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(|_| ())
}

/// The folder the app keeps its vault in, which holds `agent.json` while agents are allowed.
/// The same as the app finds it: `BROCK_DATA` if set, or the system's data folder.
pub fn data_folder() -> PathBuf {
    folder_in(|key| std::env::var_os(key), cfg!(target_os = "macos"), cfg!(target_os = "windows"))
}

fn folder_in(env: impl Fn(&str) -> Option<std::ffi::OsString>, mac: bool, windows: bool) -> PathBuf {
    if let Some(dir) = env("BROCK_DATA") {
        return PathBuf::from(dir);
    }
    let home = || PathBuf::from(env(if windows { "USERPROFILE" } else { "HOME" }).unwrap_or_default());
    if mac {
        home().join("Library").join("Application Support").join(IDENTIFIER)
    } else if windows {
        env("APPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData").join("Roaming")).join(IDENTIFIER)
    } else {
        env("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local").join("share")).join(IDENTIFIER)
    }
}

/// Reads messages, one to a line, and writes the answers, until `input` ends.
pub fn serve(input: impl BufRead, mut output: impl Write, shim: &Shim) {
    for line in input.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(&message, shim),
            Err(_) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })),
        };
        if let Some(response) = response {
            if writeln!(output, "{response}").and_then(|_| output.flush()).is_err() {
                break;
            }
        }
    }
}

/// One JSON-RPC message in; the message to send back, or None for none.
pub fn handle(message: &Value, shim: &Shim) -> Option<Value> {
    // A notification has no id and is not answered.
    let id = message.get("id").filter(|id| !id.is_null())?.clone();
    let params = message.get("params");
    let reply = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let error = |code: i64, text: String| Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } }));

    match message.get("method").and_then(Value::as_str).unwrap_or("") {
        "initialize" => reply(json!({
            "protocolVersion": params.and_then(|p| p.get("protocolVersion")).and_then(Value::as_str).unwrap_or(NEWEST_PROTOCOL),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "brock", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Brock is a mind map app. You can reach only the maps the person has shared: start with list_maps, which says which you may edit. Ids come from the outlines. You cannot delete anything.",
        })),
        "ping" => reply(json!({})),
        "tools/list" => reply(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.and_then(|p| p.get("name")).and_then(Value::as_str).unwrap_or("");
            if !tools().as_array().is_some_and(|all| all.iter().any(|t| t["name"] == name)) {
                return error(-32602, format!("Unknown tool: {name}"));
            }
            // The tool's name is the call's, never an argument's: an argument cannot choose another tool.
            let mut request: Map<String, Value> = params.and_then(|p| p.get("arguments")).and_then(Value::as_object).cloned().unwrap_or_default();
            request.insert("tool".into(), json!(name));
            let (text, is_error) = match shim.ask(Value::Object(request)) {
                Ok(text) => (text, false),
                Err(why) => (why, true),
            };
            reply(json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        other => error(-32601, format!("Method not found: {other}")),
    }
}

fn tools() -> Value {
    serde_json::from_str(TOOLS).expect("mcp-tools.json is JSON")
}

/// Why a knock got no answer to give an agent.
enum Knock {
    /// Nothing is listening: the app is not open, or has not opened its door.
    Closed,
    /// Something is, and this is what to tell the agent.
    Failed(String),
}

/// Knocks once: the app's answer's text, or why not.
fn knock(request: &Value, folder: &Path) -> Result<String, Knock> {
    let failed = |why: &str| Knock::Failed(why.to_string());
    let door: Value = std::fs::read_to_string(folder.join(crate::agent::FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .ok_or(Knock::Closed)?;
    let port = door["port"].as_u64().and_then(|p| u16::try_from(p).ok()).ok_or(Knock::Closed)?;
    let mut stream = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), CONNECT_WITHIN).map_err(|_| Knock::Closed)?;
    stream.set_read_timeout(Some(WAIT)).map_err(|e| Knock::Failed(e.to_string()))?;
    stream.set_write_timeout(Some(WAIT)).map_err(|e| Knock::Failed(e.to_string()))?;
    let line = json!({ "token": door["token"], "request": request }).to_string();
    stream.write_all(line.as_bytes()).and_then(|_| stream.write_all(b"\n")).map_err(|_| Knock::Closed)?;

    let mut answer = String::new();
    match BufReader::new(stream.take(MAX_ANSWER)).read_line(&mut answer) {
        Ok(0) => return Err(failed("Brock closed the connection.")),
        Ok(_) => {}
        Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
            return Err(failed("Brock did not answer in time."))
        }
        Err(_) => return Err(failed("Brock closed the connection.")),
    }
    let answer: Value = serde_json::from_str(&answer).map_err(|_| failed("Brock gave an answer that could not be read."))?;
    if answer["ok"] == true {
        Ok(answer["text"].as_str().unwrap_or_default().to_string())
    } else {
        Err(Knock::Failed(answer["error"].as_str().unwrap_or("Brock could not answer.").to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Door, Handler};
    use std::sync::{Arc, Mutex};

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("brock-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The app, as far as the shim can tell: answers each request with `reply`, and keeps what it was asked.
    fn app(dir: &Path, reply: fn(&Value) -> Value) -> (Door, Arc<Mutex<Vec<Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let handler: Handler = Arc::new(move |request| {
            log.lock().unwrap().push(request.clone());
            reply(&request)
        });
        (Door::open(dir, handler).unwrap(), seen)
    }

    /// Sends these messages in and gives back the answers, as the process would on its standard streams.
    fn talk(dir: &Path, messages: &[Value]) -> Vec<Value> {
        talk_with(&Shim::with(dir.to_path_buf(), Box::new(|| panic!("the app was started")), Duration::from_millis(300)), messages)
    }

    fn talk_with(shim: &Shim, messages: &[Value]) -> Vec<Value> {
        let input: String = messages.iter().map(|m| format!("{m}\n")).collect();
        let mut out = Vec::new();
        serve(input.as_bytes(), &mut out, shim);
        String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn call(id: u64, name: &str, args: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": name, "arguments": args } })
    }

    #[test]
    fn the_tools_are_listed_and_the_protocol_answered() {
        let dir = folder("protocol");
        let replies = talk(
            &dir,
            &[
                json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26", "capabilities": {} } }),
                json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
                json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
                json!({ "jsonrpc": "2.0", "id": 3, "method": "ping" }),
                json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/list" }),
            ],
        );
        assert_eq!(replies.len(), 4, "a notification gets no answer");
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-03-26", "the client's version is answered in kind");
        assert_eq!(replies[0]["result"]["serverInfo"]["name"], "brock");
        let names: Vec<&str> = replies[1]["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["list_maps", "read_map", "read_node", "search", "add_nodes", "update_node", "set_task", "move_node", "flag_node"]);
        assert_eq!(replies[2]["result"], json!({}));
        assert_eq!(replies[3]["error"]["code"], -32601);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn every_tool_says_what_it_takes() {
        for tool in tools().as_array().unwrap() {
            assert!(tool["description"].as_str().is_some_and(|d| d.len() > 20), "{} is described", tool["name"]);
            assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
            assert!(tool["annotations"]["readOnlyHint"].is_boolean(), "{} says whether it only reads", tool["name"]);
        }
    }

    #[test]
    fn a_call_goes_to_the_app_and_its_answer_comes_back() {
        let dir = folder("call");
        let (_door, seen) = app(&dir, |request| match request["tool"].as_str() {
            Some("list_maps") => json!({ "ok": true, "text": "Maps shared with you:\n- Garden\n" }),
            _ => json!({ "ok": false, "error": "Not found." }),
        });
        let replies = talk(&dir, &[call(1, "list_maps", json!({})), call(2, "read_map", json!({ "id": "x" }))]);
        assert_eq!(replies[0]["result"]["isError"], false);
        assert_eq!(replies[0]["result"]["content"][0]["text"], "Maps shared with you:\n- Garden\n");
        assert_eq!(replies[1]["result"]["isError"], true, "what the app refuses is an error to the agent");
        assert_eq!(replies[1]["result"]["content"][0]["text"], "Not found.");
        assert_eq!(seen.lock().unwrap()[1], json!({ "tool": "read_map", "id": "x" }));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_tools_name_cannot_be_changed_by_its_arguments() {
        let dir = folder("name");
        let (_door, seen) = app(&dir, |_| json!({ "ok": true, "text": "" }));
        talk(&dir, &[call(1, "list_maps", json!({ "tool": "read_node", "id": "secret" }))]);
        assert_eq!(seen.lock().unwrap()[0], json!({ "tool": "list_maps", "id": "secret" }));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn text(reply: &Value) -> String {
        reply["result"]["content"][0]["text"].as_str().unwrap().to_string()
    }

    /// A shim whose launcher counts how often it is used, and does what `open` is told to.
    fn shim_that_starts_the_app(dir: &Path, wait_ms: u64, open: impl Fn() + Send + Sync + 'static) -> (Shim, Arc<std::sync::atomic::AtomicUsize>) {
        let starts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = starts.clone();
        let open = Arc::new(open);
        let shim = Shim::with(
            dir.to_path_buf(),
            Box::new(move || {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let open = open.clone();
                std::thread::spawn(move || open());
                Ok(())
            }),
            Duration::from_millis(wait_ms),
        );
        (shim, starts)
    }

    #[test]
    fn with_agents_not_allowed_the_app_is_not_started_and_the_agent_is_told_why() {
        let dir = folder("not-allowed");
        // A door left by an app that has gone changes nothing: the person has not allowed it.
        std::fs::write(dir.join(crate::agent::FILE), r#"{"port":1,"token":"x"}"#).unwrap();
        for _ in 0..2 {
            let reply = &talk(&dir, &[call(1, "list_maps", json!({}))])[0];
            assert_eq!(reply["result"]["isError"], true);
            assert!(text(reply).contains("not allowed") && text(reply).contains("Settings › Agents"));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn with_agents_allowed_and_the_app_closed_it_is_started_and_waited_for() {
        let dir = folder("starts");
        crate::agent::set_allowed(&dir, true).unwrap();
        // The app takes a moment to open its door, as it does to load its window.
        let held: Arc<Mutex<Option<Door>>> = Arc::default();
        let (opened, at) = (held.clone(), dir.clone());
        let (shim, starts) = shim_that_starts_the_app(&dir, 5_000, move || {
            std::thread::sleep(Duration::from_millis(700));
            let handler: Handler = Arc::new(|_| json!({ "ok": true, "text": "Maps shared with you:\n" }));
            *opened.lock().unwrap() = Some(Door::open(&at, handler).unwrap());
        });
        let replies = talk_with(&shim, &[call(1, "list_maps", json!({})), call(2, "list_maps", json!({}))]);
        assert_eq!(replies[0]["result"]["isError"], false, "{}", text(&replies[0]));
        assert_eq!(text(&replies[0]), "Maps shared with you:\n");
        assert_eq!(replies[1]["result"]["isError"], false);
        assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1, "started once, not for each call");
        drop(held);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_app_that_answers_is_never_started_again_and_a_refusal_is_not_closed() {
        let dir = folder("open");
        crate::agent::set_allowed(&dir, true).unwrap();
        let (_door, _seen) = app(&dir, |_| json!({ "ok": false, "error": "Not found." }));
        let (shim, starts) = shim_that_starts_the_app(&dir, 500, || {});
        let reply = &talk_with(&shim, &[call(1, "read_map", json!({ "id": "x" }))])[0];
        assert_eq!(text(reply), "Not found.");
        assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_app_that_never_opens_its_door_is_waited_for_so_long_and_then_tried_again() {
        let dir = folder("never");
        crate::agent::set_allowed(&dir, true).unwrap();
        let (shim, starts) = shim_that_starts_the_app(&dir, 500, || {});
        let reply = &talk_with(&shim, &[call(1, "list_maps", json!({}))])[0];
        assert_eq!(reply["result"]["isError"], true);
        assert!(text(reply).contains("has not opened its door"));
        assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1);
        // A later call, after the wait, starts it again: it may have been quit meanwhile.
        talk_with(&shim, &[call(2, "list_maps", json!({}))]);
        assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_app_that_cannot_be_started_is_said_so() {
        let dir = folder("fails");
        crate::agent::set_allowed(&dir, true).unwrap();
        let shim = Shim::with(dir.clone(), Box::new(|| Err(std::io::Error::other("no such program"))), Duration::from_millis(300));
        let reply = &talk_with(&shim, &[call(1, "list_maps", json!({}))])[0];
        assert_eq!(reply["result"]["isError"], true);
        assert!(text(reply).contains("could not be started") && text(reply).contains("no such program"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unknown_tools_and_bad_lines_are_errors_that_do_not_stop_it() {
        let dir = folder("bad");
        let input = format!("not json\n\n{}\n{}\n", call(1, "delete_everything", json!({})), json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }));
        let mut out = Vec::new();
        serve(input.as_bytes(), &mut out, &Shim::with(dir.clone(), Box::new(|| panic!("the app was started")), Duration::from_millis(300)));
        let replies: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(replies[0]["error"]["code"], -32700);
        assert_eq!(replies[1]["error"]["code"], -32602);
        assert_eq!(replies[2]["result"], json!({}));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_data_folder_is_where_the_app_keeps_its_vault() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |key: &str| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| std::ffi::OsString::from(v));
        assert_eq!(folder_in(env(&[("BROCK_DATA", "/tmp/try"), ("HOME", "/h")]), true, false), PathBuf::from("/tmp/try"));
        assert_eq!(folder_in(env(&[("HOME", "/Users/me")]), true, false), PathBuf::from("/Users/me/Library/Application Support/app.getbrock.brock"));
        assert_eq!(folder_in(env(&[("APPDATA", "C:\\Users\\me\\AppData\\Roaming")]), false, true), PathBuf::from("C:\\Users\\me\\AppData\\Roaming").join(IDENTIFIER));
        assert_eq!(folder_in(env(&[("HOME", "/home/me")]), false, false), PathBuf::from("/home/me/.local/share/app.getbrock.brock"));
        assert_eq!(folder_in(env(&[("HOME", "/home/me"), ("XDG_DATA_HOME", "/data")]), false, false), PathBuf::from("/data/app.getbrock.brock"));
    }
}
