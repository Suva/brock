//! The vault's database: one SQLite file. The window holds the vault in memory
//! and sends every edit here as a list of changes, which are written in one
//! transaction as they arrive. There is no other way of saving.

use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// A node as the window knows it (`src/core/node.ts`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub sort_key: String,
    pub side: Option<String>,
    pub title: String,
    pub body: String,
    pub is_map: bool,
    pub collapsed: bool,
    pub color: Option<String>,
    pub icon: Option<String>,
    /// The ids of the nodes this one links to; kept as a JSON list.
    #[serde(default)]
    pub links: Vec<String>,
    /// "open", "done", or None for a node that is not a task.
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub done_at: Option<i64>,
    /// 1 to 5, or None.
    #[serde(default)]
    pub priority: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// One node changed; `before` is None for a node just made.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub before: Option<Node>,
    pub after: Node,
}

/// Each step brings the database from the version before it to its own; the
/// version is kept in SQLite's `user_version`. Add steps, never change one
/// that has been released.
const MIGRATIONS: &[&str] = &[
    // 1: nodes, links between them, the log of changes, and the search index.
    r#"
    CREATE TABLE nodes (
        id          TEXT PRIMARY KEY,
        parent_id   TEXT,
        sort_key    TEXT NOT NULL,
        side        TEXT CHECK (side IN ('left', 'right')),
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        is_map      INTEGER NOT NULL DEFAULT 0,
        collapsed   INTEGER NOT NULL DEFAULT 0,
        color       TEXT,
        icon        TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER
    );
    CREATE INDEX nodes_parent ON nodes (parent_id);

    CREATE TABLE links (
        id          TEXT PRIMARY KEY,
        from_id     TEXT NOT NULL,
        to_id       TEXT NOT NULL,
        label       TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER
    );
    CREATE INDEX links_from ON links (from_id);
    CREATE INDEX links_to ON links (to_id);

    -- Every change in the order it was made, as JSON: for syncing later.
    CREATE TABLE ops (
        seq         INTEGER PRIMARY KEY AUTOINCREMENT,
        at          INTEGER NOT NULL,
        node_id     TEXT NOT NULL,
        before      TEXT,
        after       TEXT NOT NULL
    );

    -- Kept up to date from `nodes` by the triggers below.
    CREATE VIRTUAL TABLE nodes_fts USING fts5 (
        title, body,
        content = 'nodes', content_rowid = 'rowid',
        tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts (nodes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
    END;
    CREATE TRIGGER nodes_fts_update AFTER UPDATE OF title, body ON nodes BEGIN
        INSERT INTO nodes_fts (nodes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO nodes_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    "#,
    // 2: links between nodes are kept on the node they start from, which
    // saves, undoes and syncs them with it. The table planned for them was
    // never used.
    r#"
    ALTER TABLE nodes ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
    DROP TABLE links;
    "#,
    // 3: tasks, open or done, and when one was done.
    r#"
    ALTER TABLE nodes ADD COLUMN task TEXT CHECK (task IN ('open', 'done'));
    ALTER TABLE nodes ADD COLUMN done_at INTEGER;
    "#,
    // 4: priorities, 1 to 5.
    r#"
    ALTER TABLE nodes ADD COLUMN priority INTEGER CHECK (priority BETWEEN 1 AND 5);
    "#,
];

pub struct Db {
    conn: Connection,
}

impl Db {
    /// Opens the vault at `path`, making it and bringing it up to date as needed.
    pub fn open(path: &Path) -> Result<Db, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("Cannot make {}: {e}", dir.display()))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
        // WAL lets each small write be quick; FULL makes each one survive a
        // power cut, which matters more than speed in an app with no Save.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;").map_err(err)?;
        Db::setup(conn)
    }

    /// A vault that lives in memory only, for tests.
    #[cfg(test)]
    pub fn in_memory() -> Result<Db, String> {
        Db::setup(Connection::open_in_memory().map_err(err)?)
    }

    fn setup(mut conn: Connection) -> Result<Db, String> {
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        if version > MIGRATIONS.len() as i64 {
            return Err(format!(
                "This vault was written by a newer version of the app (database version {version}). Update the app to open it."
            ));
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = conn.transaction().map_err(err)?;
            tx.execute_batch(sql).map_err(err)?;
            tx.pragma_update(None, "user_version", i as i64 + 1).map_err(err)?;
            tx.commit().map_err(err)?;
        }
        Ok(Db { conn })
    }

    /// Every node, deleted ones too: the window needs them for undo and the trash.
    pub fn load(&self) -> Result<Vec<Node>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_id, sort_key, side, title, body, is_map, collapsed, color, icon,
                        created_at, updated_at, deleted_at, links, task, done_at, priority
                 FROM nodes",
            )
            .map_err(err)?;
        let rows = stmt.query_map([], node_from_row).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    /// Writes one edit's changes, all or none, and adds them to the log.
    pub fn apply(&mut self, changes: &[Change]) -> Result<(), String> {
        let at = now();
        let tx = self.conn.transaction().map_err(err)?;
        {
            let mut upsert = tx
                .prepare_cached(
                    "INSERT INTO nodes (id, parent_id, sort_key, side, title, body, is_map, collapsed,
                                        color, icon, created_at, updated_at, deleted_at, links, task, done_at, priority)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                     ON CONFLICT (id) DO UPDATE SET
                        parent_id = excluded.parent_id, sort_key = excluded.sort_key,
                        side = excluded.side, title = excluded.title, body = excluded.body,
                        is_map = excluded.is_map, collapsed = excluded.collapsed,
                        color = excluded.color, icon = excluded.icon,
                        created_at = excluded.created_at, updated_at = excluded.updated_at,
                        deleted_at = excluded.deleted_at, links = excluded.links,
                        task = excluded.task, done_at = excluded.done_at, priority = excluded.priority",
                )
                .map_err(err)?;
            let mut log = tx
                .prepare_cached("INSERT INTO ops (at, node_id, before, after) VALUES (?1, ?2, ?3, ?4)")
                .map_err(err)?;
            for change in changes {
                let n = &change.after;
                upsert
                    .execute(params![
                        n.id, n.parent_id, n.sort_key, n.side, n.title, n.body, n.is_map, n.collapsed,
                        n.color, n.icon, n.created_at, n.updated_at, n.deleted_at,
                        serde_json::to_string(&n.links).unwrap(),
                        n.task, n.done_at, n.priority
                    ])
                    .map_err(|e| format!("Cannot save node {}: {e}", n.id))?;
                let before = change.before.as_ref().map(|b| serde_json::to_string(b).unwrap());
                let after = serde_json::to_string(n).unwrap();
                log.execute(params![at, n.id, before, after]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    /// Removes nodes for good, with their entries in the log, all or none: for
    /// emptying the trash. The search index follows by its trigger.
    pub fn purge(&mut self, ids: &[String]) -> Result<(), String> {
        let tx = self.conn.transaction().map_err(err)?;
        {
            let mut node = tx.prepare_cached("DELETE FROM nodes WHERE id = ?1").map_err(err)?;
            let mut log = tx.prepare_cached("DELETE FROM ops WHERE node_id = ?1").map_err(err)?;
            for id in ids {
                node.execute([id]).map_err(err)?;
                log.execute([id]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    /// Makes today's copy of the vault into `dir` if there is none (see backups.rs).
    pub fn back_up_if_due(&self, dir: &std::path::Path) -> Result<bool, String> {
        crate::backups::make_if_due(&self.conn, dir)
    }

    /// Makes today's copy of the vault into `dir` now.
    pub fn back_up(&self, dir: &std::path::Path) -> Result<(), String> {
        crate::backups::make(&self.conn, dir)
    }

    /// The ids of nodes whose title or text matches an FTS5 query, best first.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT nodes.id FROM nodes_fts JOIN nodes ON nodes.rowid = nodes_fts.rowid
                 WHERE nodes_fts MATCH ?1 ORDER BY rank LIMIT ?2",
            )
            .map_err(err)?;
        let rows = stmt.query_map(params![query, limit as i64], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    /// How many changes the log holds.
    #[cfg(test)]
    pub fn log_length(&self) -> Result<i64, String> {
        self.conn.query_row("SELECT count(*) FROM ops", [], |r| r.get(0)).map_err(err)
    }

    #[cfg(test)]
    pub fn get(&self, id: &str) -> Result<Option<Node>, String> {
        use rusqlite::OptionalExtension;
        self.conn
            .query_row(
                "SELECT id, parent_id, sort_key, side, title, body, is_map, collapsed, color, icon,
                        created_at, updated_at, deleted_at, links, task, done_at, priority
                 FROM nodes WHERE id = ?1",
                [id],
                node_from_row,
            )
            .optional()
            .map_err(err)
    }
}

/// Copies the vault kept under the app's old name into `new_dir`, once: when
/// there is none there yet and there is one in `old_dir`. SQLite makes the
/// copy (`VACUUM INTO`), so changes still in the old vault's write-ahead log
/// come too. The daily copies come along. The old folder is left as it was.
/// Returns whether anything was copied.
pub fn carry_over(old_dir: &Path, new_dir: &Path) -> Result<bool, String> {
    let old = old_dir.join("vault.sqlite");
    let new = new_dir.join("vault.sqlite");
    if new.exists() || !old.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(new_dir).map_err(|e| format!("Cannot make {}: {e}", new_dir.display()))?;
    let partial = new.with_extension("partial");
    let _ = std::fs::remove_file(&partial);
    let conn = Connection::open(&old).map_err(|e| format!("Cannot open {}: {e}", old.display()))?;
    conn.execute("VACUUM INTO ?1", [partial.to_string_lossy()])
        .map_err(|e| format!("Cannot copy the vault from {}: {e}", old.display()))?;
    drop(conn);
    std::fs::rename(&partial, &new).map_err(|e| format!("Cannot keep the copied vault: {e}"))?;
    let (old_copies, new_copies) = (crate::backups::folder(&old), crate::backups::folder(&new));
    for copy in crate::backups::list(&old_copies) {
        std::fs::create_dir_all(&new_copies).map_err(|e| e.to_string())?;
        let _ = std::fs::copy(old_copies.join(&copy.name), new_copies.join(&copy.name));
    }
    Ok(true)
}

fn node_from_row(r: &Row) -> rusqlite::Result<Node> {
    Ok(Node {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        sort_key: r.get(2)?,
        side: r.get(3)?,
        title: r.get(4)?,
        body: r.get(5)?,
        is_map: r.get(6)?,
        collapsed: r.get(7)?,
        color: r.get(8)?,
        icon: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        deleted_at: r.get(12)?,
        // A list that does not read is taken as no links rather than losing the node.
        links: serde_json::from_str(&r.get::<_, String>(13)?).unwrap_or_default(),
        task: r.get(14)?,
        done_at: r.get(15)?,
        priority: r.get(16)?,
    })
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, parent: Option<&str>, title: &str) -> Node {
        Node {
            id: id.into(),
            parent_id: parent.map(Into::into),
            sort_key: "a0".into(),
            side: None,
            title: title.into(),
            body: String::new(),
            is_map: parent.is_none(),
            collapsed: false,
            color: None,
            icon: None,
            links: Vec::new(),
            task: None,
            done_at: None,
            priority: None,
            created_at: 1,
            updated_at: 1,
            deleted_at: None,
        }
    }

    #[test]
    fn changes_are_saved_and_loaded() {
        let mut db = Db::in_memory().unwrap();
        let root = node("root", None, "Home");
        let child = node("child", Some("root"), "Ideas");
        db.apply(&[
            Change { before: None, after: root.clone() },
            Change { before: None, after: child.clone() },
        ])
        .unwrap();
        let mut renamed = child.clone();
        renamed.title = "Better ideas".into();
        renamed.side = Some("left".into());
        db.apply(&[Change { before: Some(child), after: renamed.clone() }]).unwrap();

        let mut loaded = db.load().unwrap();
        loaded.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(loaded, vec![renamed, root]);
        assert_eq!(db.log_length().unwrap(), 3);
    }

    #[test]
    fn an_edit_is_saved_whole_or_not_at_all() {
        let mut db = Db::in_memory().unwrap();
        let mut bad = node("bad", Some("root"), "x");
        bad.side = Some("up".into());
        let result = db.apply(&[
            Change { before: None, after: node("root", None, "Home") },
            Change { before: None, after: bad },
        ]);
        assert!(result.is_err());
        assert!(db.load().unwrap().is_empty());
        assert_eq!(db.log_length().unwrap(), 0);
    }

    #[test]
    fn search_follows_titles_and_text() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "Garden plans");
        a.body = "Tomatoes along the south wall".into();
        db.apply(&[
            Change { before: None, after: a.clone() },
            Change { before: None, after: node("b", Some("a"), "Café menu") },
        ])
        .unwrap();
        assert_eq!(db.search("tomatoes", 10).unwrap(), vec!["a"]);
        assert_eq!(db.search("cafe", 10).unwrap(), vec!["b"], "accents are ignored");
        assert_eq!(db.search("gard*", 10).unwrap(), vec!["a"]);

        let mut renamed = a.clone();
        renamed.title = "Allotment".into();
        renamed.body = String::new();
        db.apply(&[Change { before: Some(a), after: renamed }]).unwrap();
        assert!(db.search("tomatoes", 10).unwrap().is_empty());
        assert_eq!(db.search("allotment", 10).unwrap(), vec!["a"]);
    }

    #[test]
    fn a_vault_on_disk_opens_again() {
        let dir = std::env::temp_dir().join(format!("brock-test-{}", std::process::id()));
        let path = dir.join("vault.sqlite");
        let _ = std::fs::remove_dir_all(&dir);
        {
            let mut db = Db::open(&path).unwrap();
            db.apply(&[Change { before: None, after: node("root", None, "Home") }]).unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(db.get("root").unwrap().unwrap().title, "Home");
        drop(db);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn purged_nodes_are_gone_from_the_nodes_the_log_and_search() {
        let mut db = Db::in_memory().unwrap();
        db.apply(&[
            Change { before: None, after: node("root", None, "Home") },
            Change { before: None, after: node("gone", Some("root"), "Secret plans") },
        ])
        .unwrap();
        db.purge(&["gone".into()]).unwrap();
        assert!(db.get("gone").unwrap().is_none());
        assert_eq!(db.log_length().unwrap(), 1, "only the root's entry is left");
        assert!(db.search("secret", 10).unwrap().is_empty());
    }

    #[test]
    fn links_are_saved_with_their_node() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "Home");
        a.links = vec!["b".into(), "c".into()];
        db.apply(&[Change { before: None, after: a.clone() }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().links, vec!["b", "c"]);
    }

    #[test]
    fn tasks_are_saved_and_checked() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "Home");
        a.task = Some("done".into());
        a.done_at = Some(5);
        db.apply(&[Change { before: None, after: a.clone() }]).unwrap();
        let back = db.get("a").unwrap().unwrap();
        assert_eq!((back.task.as_deref(), back.done_at), (Some("done"), Some(5)));
        let mut bad = a.clone();
        bad.task = Some("maybe".into());
        assert!(db.apply(&[Change { before: Some(a.clone()), after: bad }]).is_err());
        let mut urgent = a.clone();
        urgent.priority = Some(1);
        db.apply(&[Change { before: Some(a.clone()), after: urgent.clone() }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().priority, Some(1));
        let mut wrong = urgent.clone();
        wrong.priority = Some(9);
        assert!(db.apply(&[Change { before: Some(urgent), after: wrong }]).is_err(), "only 1 to 5");
    }

    #[test]
    fn a_vault_of_the_first_version_is_brought_up_to_date() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO nodes (id, sort_key, title, created_at, updated_at) VALUES ('old', 'a0', 'Old', 1, 1)",
            [],
        )
        .unwrap();
        let db = Db::setup(conn).unwrap();
        let old = db.get("old").unwrap().unwrap();
        assert_eq!(old.title, "Old");
        assert!(old.links.is_empty());
        assert_eq!(old.task, None);
        assert_eq!(db.search("old", 10).unwrap(), vec!["old"], "the search index carries over");
    }

    #[test]
    fn the_vault_under_the_old_name_is_copied_once_with_what_its_log_holds() {
        let root = std::env::temp_dir().join(format!("brock-carry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old_dir, new_dir) = (root.join("com.jaanpullerits.mindmap"), root.join("app.getbrock.brock"));

        // The old vault, still open, its last change only in the write-ahead log.
        let mut old = Db::open(&old_dir.join("vault.sqlite")).unwrap();
        old.apply(&[Change { before: None, after: node("root", None, "Home") }]).unwrap();
        old.conn.execute_batch("PRAGMA wal_autocheckpoint = 0;").unwrap();
        old.apply(&[Change { before: None, after: node("late", Some("root"), "Written last") }]).unwrap();
        std::fs::create_dir_all(old_dir.join("Backups")).unwrap();
        std::fs::write(old_dir.join("Backups").join("vault-2026-10-01.sqlite"), b"a copy").unwrap();

        assert!(carry_over(&old_dir, &new_dir).unwrap());
        let new = Db::open(&new_dir.join("vault.sqlite")).unwrap();
        assert_eq!(new.get("late").unwrap().unwrap().title, "Written last", "what was only in the log came too");
        assert!(new_dir.join("Backups").join("vault-2026-10-01.sqlite").exists(), "the daily copies came along");
        assert!(old_dir.join("vault.sqlite").exists(), "the old vault is left as it was");

        drop(new);
        assert!(!carry_over(&old_dir, &new_dir).unwrap(), "once only: a vault there is never written over");
        assert!(!carry_over(&root.join("nothing"), &root.join("fresh")).unwrap(), "nothing to copy");
        drop(old);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_vault_from_a_newer_app_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1).unwrap();
        let error = Db::setup(conn).err().unwrap();
        assert!(error.contains("newer version"), "{error}");
    }
}
