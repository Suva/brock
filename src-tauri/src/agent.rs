//! The door AI agents knock on. While the person allows agents, the app listens
//! on the loopback address, on a port of the system's choosing, and writes
//! where, with a secret, to `agent.json` beside the vault, readable by its
//! owner only. `brock-mcp` reads that file and sends one request per
//! connection. Nothing here knows what a request means: it goes to the handler
//! (the window, which holds the vault) and its answer comes back. Nothing
//! listens on the network, and nothing at all while agents are not allowed.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

/// The file, in the vault's folder, that says where to knock and the secret to knock with.
pub const FILE: &str = "agent.json";

/// A file, beside the vault, that is there while agents are allowed: the
/// switch lives in the window's storage, which `brock --mcp` cannot read, and it
/// needs to know before it starts the app for an agent.
pub const ALLOWED_FILE: &str = "agents-allowed";

/// Records whether agents are allowed, for `brock --mcp` (see `ALLOWED_FILE`).
pub fn set_allowed(dir: &Path, allowed: bool) -> Result<(), String> {
    let file = dir.join(ALLOWED_FILE);
    if allowed {
        std::fs::write(&file, b"").map_err(|e| format!("Cannot write {}: {e}", file.display()))
    } else {
        match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Cannot remove {}: {e}", file.display())),
        }
    }
}

/// Whether agents are allowed, as last recorded.
pub fn is_allowed(dir: &Path) -> bool {
    dir.join(ALLOWED_FILE).exists()
}

/// A request is one line; a longer one is not an agent's. Room enough for the
/// longest outline or notes the window accepts (100,000 characters), escaped.
const MAX_LINE: u64 = 1024 * 1024;
/// A client that sends nothing for this long is let go.
const READ_WITHIN: Duration = Duration::from_secs(5);
/// More at once than this are turned away: an agent asks one thing at a time.
const MAX_AT_ONCE: usize = 8;
/// How often the listener looks whether it should stop.
const LOOK_EVERY: Duration = Duration::from_millis(100);

/// Answers a request, which is whatever JSON the client sent; the answer is sent back as it is.
pub type Handler = Arc<dyn Fn(Value) -> Value + Send + Sync>;

/// The listener, for as long as it lives; dropping it stops it and removes the file.
pub struct Door {
    stop: Arc<AtomicBool>,
    file: PathBuf,
}

impl Door {
    /// Starts listening, and writes `agent.json` in `dir`.
    pub fn open(dir: &Path, handler: Handler) -> Result<Door, String> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| format!("Cannot listen for agents: {e}"))?;
        // A non-blocking listener can look at `stop` between connections.
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let token = secret()?;
        let file = dir.join(FILE);
        write_private(&file, &json!({ "port": port, "token": token }).to_string())?;

        let stop = Arc::new(AtomicBool::new(false));
        let (flag, active) = (stop.clone(), Arc::new(AtomicUsize::new(0)));
        std::thread::spawn(move || {
            while !flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if active.fetch_add(1, Ordering::SeqCst) >= MAX_AT_ONCE {
                            active.fetch_sub(1, Ordering::SeqCst);
                            continue;
                        }
                        let (handler, token, active) = (handler.clone(), token.clone(), active.clone());
                        std::thread::spawn(move || {
                            let _ = serve(stream, &token, &handler);
                            active.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                    Err(_) => std::thread::sleep(LOOK_EVERY),
                }
            }
        });
        Ok(Door { stop, file })
    }
}

impl Drop for Door {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = std::fs::remove_file(&self.file);
    }
}

/// One request: a line `{"token": ..., "request": ...}`, answered by one line.
fn serve(stream: TcpStream, token: &str, handler: &Handler) -> std::io::Result<()> {
    // A connection accepted from a non-blocking listener may be non-blocking itself.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(READ_WITHIN))?;
    stream.set_write_timeout(Some(READ_WITHIN))?;
    let mut line = String::new();
    BufReader::new((&stream).take(MAX_LINE)).read_line(&mut line)?;
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(Value::Object(mut message)) => {
            let given = message.get("token").and_then(Value::as_str).unwrap_or("");
            if same(given, token) {
                handler(message.remove("request").unwrap_or(Value::Null))
            } else {
                refused("Not allowed.")
            }
        }
        _ => refused("Not a request."),
    };
    let mut out = &stream;
    out.write_all(reply.to_string().as_bytes())?;
    out.write_all(b"\n")
}

fn refused(why: &str) -> Value {
    json!({ "ok": false, "error": why })
}

/// Whether two secrets are equal, taking as long to say no as to say yes.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut differ = a.len() ^ b.len();
    for i in 0..b.len() {
        differ |= (a.get(i).copied().unwrap_or(0) ^ b[i]) as usize;
    }
    differ == 0
}

/// 32 random bytes from the system, as hex.
fn secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("Cannot make a secret: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Writes a file only its owner can read (on systems that have owners).
fn write_private(path: &Path, content: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        // `mode` only applies to a file just made; one left from before may be wider.
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    file.write_all(content.as_bytes()).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("brock-agent-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn echo() -> Handler {
        Arc::new(|request| json!({ "ok": true, "text": request.to_string() }))
    }

    /// Knocks as `brock-mcp` does: sends `line`, reads the answer.
    fn knock(dir: &Path, line: &str) -> Value {
        let found: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(FILE)).unwrap()).unwrap();
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, found["port"].as_u64().unwrap() as u16)).unwrap();
        stream.write_all(line.replace("TOKEN", found["token"].as_str().unwrap()).as_bytes()).unwrap();
        stream.write_all(b"\n").unwrap();
        let mut reply = String::new();
        BufReader::new(stream).read_line(&mut reply).unwrap();
        serde_json::from_str(&reply).unwrap()
    }

    #[test]
    fn a_request_with_the_secret_is_answered_and_without_it_is_not() {
        let dir = folder("secret");
        let _door = Door::open(&dir, echo()).unwrap();
        let reply = knock(&dir, r#"{"token":"TOKEN","request":{"tool":"list_maps"}}"#);
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["text"], r#"{"tool":"list_maps"}"#);
        assert_eq!(knock(&dir, r#"{"token":"wrong","request":{}}"#)["ok"], false);
        assert_eq!(knock(&dir, r#"{"request":{}}"#)["ok"], false, "no secret at all");
        assert_eq!(knock(&dir, "GET / HTTP/1.1")["ok"], false, "a web page's request is not one");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_is_the_owners_alone_and_goes_when_the_door_closes() {
        let dir = folder("file");
        let door = Door::open(&dir, echo()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(FILE)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        drop(door);
        assert!(!dir.join(FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_door_opened_again_has_a_new_secret() {
        let dir = folder("again");
        let open_and_read = || {
            let _door = Door::open(&dir, echo()).unwrap();
            let found: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(FILE)).unwrap()).unwrap();
            found["token"].as_str().unwrap().to_string()
        };
        let (one, two) = (open_and_read(), open_and_read());
        assert_eq!(one.len(), 64);
        assert_ne!(one, two);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_request_as_long_as_the_window_accepts_is_not_cut() {
        let dir = folder("long");
        let _door = Door::open(&dir, echo()).unwrap();
        // 100,000 characters of notes, each escaped to two in the JSON line.
        let notes = "\n".repeat(100_000);
        let line = json!({ "token": "TOKEN", "request": { "tool": "update_node", "notes": notes } }).to_string();
        assert!(line.len() > 64 * 1024);
        let reply = knock(&dir, &line);
        assert_eq!(reply["ok"], true, "{reply}");
        assert_eq!(serde_json::from_str::<Value>(reply["text"].as_str().unwrap()).unwrap()["notes"].as_str().unwrap().len(), 100_000);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn whether_agents_are_allowed_is_kept_for_the_shim() {
        let dir = folder("allowed");
        assert!(!is_allowed(&dir));
        set_allowed(&dir, true).unwrap();
        assert!(is_allowed(&dir));
        set_allowed(&dir, true).unwrap();
        set_allowed(&dir, false).unwrap();
        assert!(!is_allowed(&dir));
        set_allowed(&dir, false).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn secrets_are_compared_whole() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
        assert!(!same("", "abc"));
        assert!(!same("abcd", "abc"));
    }
}
