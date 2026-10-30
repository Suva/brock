//! The vault's database: one SQLite file. The window holds the vault in memory
//! and sends every edit here as a list of changes, which are written in one
//! transaction as they arrive. There is no other way of saving.

use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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
    /// The day it is due, as 2026-10-30, or None.
    #[serde(default)]
    pub due: Option<String>,
    /// How a map is drawn: "org", "timeline", "board", or None for out to both sides.
    #[serde(default)]
    pub layout: Option<String>,
    /// A mark for the person: "ok", "attention" or "critical", or None.
    #[serde(default)]
    pub flag: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// One line of the log: a node changed, when, and by whom.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub seq: i64,
    pub at: i64,
    pub source: String,
    pub before: Option<Node>,
    pub after: Node,
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
    // 5: the day a node is due.
    r#"
    ALTER TABLE nodes ADD COLUMN due TEXT;
    "#,
    // 6: how a map is drawn. Unchecked, as a new way of drawing one should
    // not need the table rebuilt.
    r#"
    ALTER TABLE nodes ADD COLUMN layout TEXT;
    "#,
    // 7: a node can be marked as needing attention, and the log says who made
    // each change: the person ('user') or something working for them.
    r#"
    ALTER TABLE nodes ADD COLUMN attention INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE ops ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
    "#,
    // 8: the mark has three levels, so it is text: 'ok', 'attention' or
    // 'critical'. Unchecked, as a new level should not need the table rebuilt.
    // Marks made with step 7's yes-or-no column come over as 'attention'; that
    // column stays, unused, as a released step is never changed.
    r#"
    ALTER TABLE nodes ADD COLUMN flag TEXT;
    UPDATE nodes SET flag = 'attention' WHERE attention = 1;
    "#,
    // 9: the log is looked through by node, to join typing as it is written
    // and by the background tidying, and when a node is purged.
    r#"
    CREATE INDEX ops_node ON ops (node_id, seq);
    "#,
];

/// Copies a vault that is about to be migrated into the folder of daily copies,
/// as `vault-before-v6.sqlite` for one at database version 6, so that going
/// back to the version of the app that wrote it is possible. A new vault, and
/// one already up to date, are not copied. A copy that cannot be made must
/// not keep the vault from opening: the caller only reports it.
fn keep_before_migrating(conn: &Connection, path: &Path) -> Result<(), String> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
    if version == 0 || version >= MIGRATIONS.len() as i64 {
        return Ok(());
    }
    let dir = crate::backups::folder(path);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot make {}: {e}", dir.display()))?;
    let copy = dir.join(format!("vault-before-v{version}.sqlite"));
    let partial = copy.with_extension("partial");
    let _ = std::fs::remove_file(&partial);
    conn.execute("VACUUM INTO ?1", [partial.to_string_lossy()]).map_err(|e| format!("Cannot copy the vault before updating it: {e}"))?;
    std::fs::rename(&partial, &copy).map_err(|e| format!("Cannot keep the copy of the vault: {e}"))
}

/// Edits to one node's words made this close together are one entry in the log.
pub const SAME_RUN_MS: i64 = 2 * 60 * 1000;

/// Whether two states of a node, as JSON, differ in their title and text only
/// (and when they were saved): typing, which the log keeps as one entry.
pub fn words_only(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    let (Some(a), Some(b)) = (a.as_object(), b.as_object()) else { return false };
    const WORDS: [&str; 3] = ["title", "body", "updatedAt"];
    a.keys().chain(b.keys()).filter(|k| !WORDS.contains(&k.as_str())).all(|k| a.get(k) == b.get(k))
}

/// Whether two states have the same title and text.
pub fn same_words(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    a.get("title") == b.get("title") && a.get("body") == b.get("body")
}

pub struct Db {
    conn: Connection,
    /// When the last write was logged: the log tells steps apart by when they were made.
    last_at: i64,
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
        // A vault about to be brought up to date is kept as it is first: once
        // migrated, an older version of the app cannot open it.
        if let Err(e) = keep_before_migrating(&conn, path) {
            eprintln!("{e}");
        }
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
        Ok(Db { conn, last_at: 0 })
    }

    /// Every node, deleted ones too: the window needs them for undo and the trash.
    pub fn load(&self) -> Result<Vec<Node>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, parent_id, sort_key, side, title, body, is_map, collapsed, color, icon,
                        created_at, updated_at, deleted_at, links, task, done_at, priority, due, layout, flag
                 FROM nodes",
            )
            .map_err(err)?;
        let rows = stmt.query_map([], node_from_row).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    /// Writes one edit's changes, all or none, and adds them to the log.
    #[cfg(test)]
    pub fn apply(&mut self, changes: &[Change]) -> Result<(), String> {
        self.apply_from(changes, "user")
    }

    /// Like `apply`, saying in the log who made the changes: 'user', or
    /// something working for the person, such as 'agent'.
    pub fn apply_from(&mut self, changes: &[Change], source: &str) -> Result<(), String> {
        // Never the same moment as the write before, however quick: two steps are never one.
        let at = now().max(self.last_at + 1);
        self.last_at = at;
        let tx = self.conn.transaction().map_err(err)?;
        {
            let mut upsert = tx
                .prepare_cached(
                    "INSERT INTO nodes (id, parent_id, sort_key, side, title, body, is_map, collapsed,
                                        color, icon, created_at, updated_at, deleted_at, links, task, done_at, priority, due, layout, flag)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
                     ON CONFLICT (id) DO UPDATE SET
                        parent_id = excluded.parent_id, sort_key = excluded.sort_key,
                        side = excluded.side, title = excluded.title, body = excluded.body,
                        is_map = excluded.is_map, collapsed = excluded.collapsed,
                        color = excluded.color, icon = excluded.icon,
                        created_at = excluded.created_at, updated_at = excluded.updated_at,
                        deleted_at = excluded.deleted_at, links = excluded.links,
                        task = excluded.task, done_at = excluded.done_at, priority = excluded.priority,
                        due = excluded.due, layout = excluded.layout, flag = excluded.flag",
                )
                .map_err(err)?;
            let mut log = tx
                .prepare_cached("INSERT INTO ops (at, node_id, before, after, source) VALUES (?1, ?2, ?3, ?4, ?5)")
                .map_err(err)?;
            for change in changes {
                if changes.len() == 1 && extend_typing(&tx, change, source, at)? {
                    let n = &change.after;
                    upsert
                        .execute(params![
                            n.id, n.parent_id, n.sort_key, n.side, n.title, n.body, n.is_map, n.collapsed,
                            n.color, n.icon, n.created_at, n.updated_at, n.deleted_at,
                            serde_json::to_string(&n.links).unwrap(),
                            n.task, n.done_at, n.priority, n.due, n.layout, n.flag
                        ])
                        .map_err(|e| format!("Cannot save node {}: {e}", n.id))?;
                    continue;
                }
                let n = &change.after;
                upsert
                    .execute(params![
                        n.id, n.parent_id, n.sort_key, n.side, n.title, n.body, n.is_map, n.collapsed,
                        n.color, n.icon, n.created_at, n.updated_at, n.deleted_at,
                        serde_json::to_string(&n.links).unwrap(),
                        n.task, n.done_at, n.priority, n.due, n.layout, n.flag
                    ])
                    .map_err(|e| format!("Cannot save node {}: {e}", n.id))?;
                let before = change.before.as_ref().map(|b| serde_json::to_string(b).unwrap());
                let after = serde_json::to_string(n).unwrap();
                log.execute(params![at, n.id, before, after, source]).map_err(err)?;
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
    /// The latest `limit` entries of the log, newest first: what the History
    /// tab shows. Entries made by one write share `at` and `source`.
    pub fn history(&self, limit: usize) -> Result<Vec<LogEntry>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT seq, at, source, before, after FROM ops ORDER BY seq DESC LIMIT ?1")
            .map_err(err)?;
        let rows = stmt
            .query_map([limit as i64], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (seq, at, source, before, after) = row.map_err(err)?;
            // An entry that cannot be read (written by something newer) is left out, not an error.
            let Ok(after) = serde_json::from_str::<Node>(&after) else { continue };
            let before = before.and_then(|b| serde_json::from_str::<Node>(&b).ok());
            out.push(LogEntry { seq, at, source, before, after });
        }
        Ok(out)
    }

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
                        created_at, updated_at, deleted_at, links, task, done_at, priority, due, layout, flag
                 FROM nodes WHERE id = ?1",
                [id],
                node_from_row,
            )
            .optional()
            .map_err(err)
    }
}

/// Joins an edit of a node's words to the entry for the one before it, when
/// that was the last thing written, by the same hand a moment ago: typing
/// then costs one entry in the log, not one for each pause. Returns whether
/// it did, in which case the caller writes the node and not a new entry. A
/// run that ends where it began is taken out of the log: nothing changed.
fn extend_typing(tx: &rusqlite::Transaction, change: &Change, source: &str, at: i64) -> Result<bool, String> {
    use rusqlite::OptionalExtension;
    let Some(before) = &change.before else { return Ok(false) };
    let after = serde_json::to_value(&change.after).unwrap();
    if !words_only(&serde_json::to_value(before).unwrap(), &after) {
        return Ok(false);
    }
    let last: Option<(i64, i64, String, Option<String>)> = tx
        .query_row(
            "SELECT seq, at, source, before FROM ops WHERE node_id = ?1 ORDER BY seq DESC LIMIT 1",
            [&change.after.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let Some((seq, last_at, last_source, Some(first))) = last else { return Ok(false) };
    if last_source != source || at - last_at > SAME_RUN_MS || at < last_at {
        return Ok(false);
    }
    // It must be the last entry of all, and a step of its own: the one before
    // it was written at another moment.
    let newest: i64 = tx.query_row("SELECT max(seq) FROM ops", [], |r| r.get(0)).map_err(err)?;
    let earlier: Option<i64> = tx.query_row("SELECT at FROM ops WHERE seq = ?1", [seq - 1], |r| r.get(0)).optional().map_err(err)?;
    if newest != seq || earlier == Some(last_at) {
        return Ok(false);
    }
    // And itself only words, so that what is joined is typing.
    let first: serde_json::Value = serde_json::from_str(&first).map_err(|e| e.to_string())?;
    let last_after: String = tx.query_row("SELECT after FROM ops WHERE seq = ?1", [seq], |r| r.get(0)).map_err(err)?;
    let last_after: serde_json::Value = serde_json::from_str(&last_after).map_err(|e| e.to_string())?;
    if !words_only(&first, &last_after) {
        return Ok(false);
    }
    if same_words(&first, &after) {
        tx.execute("DELETE FROM ops WHERE seq = ?1", [seq]).map_err(err)?;
    } else {
        tx.execute("UPDATE ops SET after = ?1, at = ?2 WHERE seq = ?3", params![after.to_string(), at, seq]).map_err(err)?;
    }
    Ok(true)
}

/// Copies the vault kept under the app's old name into `new_dir`, once: when
/// there is none there yet, or one that holds nothing yet, and there is one
/// in `old_dir`. SQLite makes the copy (`VACUUM INTO`), so changes still in
/// the old vault's write-ahead log come too. The daily copies come along. The
/// old folder is left as it was. Returns whether anything was copied.
///
/// A vault that holds nothing is one the app made on starting under the new
/// name before it could copy, as a development build restarted midway
/// through the change did. It is set aside, under another name, not deleted.
pub fn carry_over(old_dir: &Path, new_dir: &Path) -> Result<bool, String> {
    let old = old_dir.join("vault.sqlite");
    let new = new_dir.join("vault.sqlite");
    if !old.exists() {
        return Ok(false);
    }
    if new.exists() {
        if !holds_nothing(&new)? {
            return Ok(false);
        }
        set_aside(&new)?;
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

/// Whether a vault holds nothing anyone made: no node besides its top one,
/// and no notes on that.
fn holds_nothing(path: &Path) -> Result<bool, String> {
    let conn = Connection::open(path).map_err(err)?;
    let others: i64 = conn
        .query_row("SELECT count(*) FROM nodes WHERE parent_id IS NOT NULL AND deleted_at IS NULL", [], |r| r.get(0))
        .map_err(err)?;
    let notes: i64 = conn
        .query_row("SELECT count(*) FROM nodes WHERE parent_id IS NULL AND body <> ''", [], |r| r.get(0))
        .map_err(err)?;
    Ok(others == 0 && notes == 0)
}

/// Moves a vault, with its write-ahead log, to `vault-before-copy-<time>.sqlite`
/// beside it, still a vault that opens.
fn set_aside(path: &Path) -> Result<(), String> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let aside = dir.join(format!("vault-before-copy-{}.sqlite", now()));
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", path.display()));
        if from.exists() {
            let to = PathBuf::from(format!("{}{suffix}", aside.display()));
            std::fs::rename(&from, &to).map_err(|e| format!("Cannot set {} aside: {e}", from.display()))?;
        }
    }
    Ok(())
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
        due: r.get(17)?,
        layout: r.get(18)?,
        flag: r.get(19)?,
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
            due: None,
            layout: None,
            flag: None,
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
    fn the_log_says_who_made_each_change_and_comes_newest_first() {
        let mut db = Db::in_memory().unwrap();
        db.apply(&[Change { before: None, after: node("root", None, "Home") }]).unwrap();
        let mut card = node("card", Some("root"), "Card");
        db.apply_from(&[Change { before: None, after: card.clone() }], "agent").unwrap();
        let before = card.clone();
        card.title = "Renamed".into();
        db.apply(&[Change { before: Some(before), after: card }]).unwrap();

        let log = db.history(10).unwrap();
        assert_eq!(log.iter().map(|e| e.source.as_str()).collect::<Vec<_>>(), ["user", "agent", "user"]);
        assert_eq!(log[0].after.title, "Renamed");
        assert_eq!(log[0].before.as_ref().unwrap().title, "Card");
        assert!(log[1].before.is_none());
        assert_eq!(db.history(1).unwrap().len(), 1, "the limit counts entries");
    }

    /// Applies the node as the next step; a few milliseconds apart, as the log tells steps by when they were made.
    fn step(db: &mut Db, before: &Node, after: &Node, source: &str) {
        std::thread::sleep(std::time::Duration::from_millis(3));
        db.apply_from(&[Change { before: Some(before.clone()), after: after.clone() }], source).unwrap();
    }

    fn typed(db: &mut Db, node: &mut Node, text: &str, source: &str) {
        let before = node.clone();
        node.title = text.into();
        step(db, &before, node, source);
    }

    fn started(titles: &[&str]) -> (Db, Vec<Node>) {
        let mut db = Db::in_memory().unwrap();
        let mut nodes = vec![node("root", None, "Home")];
        for t in titles {
            nodes.push(node(t, Some("root"), ""));
        }
        let changes: Vec<Change> = nodes.iter().map(|n| Change { before: None, after: n.clone() }).collect();
        db.apply(&changes).unwrap();
        (db, nodes)
    }

    #[test]
    fn typing_in_one_node_is_one_entry_in_the_log() {
        let (mut db, mut nodes) = started(&["a"]);
        let mut a = nodes.remove(1);
        for text in ["H", "He", "Hel", "Hell", "Hello"] {
            typed(&mut db, &mut a, text, "user");
        }
        let log = db.history(50).unwrap();
        // The root and "a" made together, and then one entry for all the typing.
        assert_eq!(log.len(), 3);
        assert_eq!(log[0].before.as_ref().unwrap().title, "", "from where the typing began");
        assert_eq!(log[0].after.title, "Hello", "to where it got");
        assert_eq!(db.get("a").unwrap().unwrap().title, "Hello", "the node itself is saved every time");
    }

    #[test]
    fn typing_is_joined_only_with_typing_by_the_same_hand_just_before() {
        let (mut db, mut nodes) = started(&["a", "b"]);
        let mut b = nodes.pop().unwrap();
        let mut a = nodes.pop().unwrap();
        typed(&mut db, &mut a, "one", "user");
        typed(&mut db, &mut a, "one two", "user");
        assert_eq!(db.history(50).unwrap().len(), 4, "joined: three made, one entry typed");

        typed(&mut db, &mut b, "other", "user");
        typed(&mut db, &mut a, "one two three", "user");
        assert_eq!(db.history(50).unwrap().len(), 6, "another node's entry came between");

        typed(&mut db, &mut a, "one two three four", "agent");
        assert_eq!(db.history(50).unwrap().len(), 7, "another hand");

        let before = a.clone();
        a.priority = Some(1);
        step(&mut db, &before, &a, "agent");
        typed(&mut db, &mut a, "after the priority", "agent");
        assert_eq!(db.history(50).unwrap().len(), 9, "something other than words came between");
    }

    #[test]
    fn typing_that_ends_where_it_began_leaves_nothing_in_the_log() {
        let (mut db, mut nodes) = started(&["a"]);
        let mut a = nodes.remove(1);
        typed(&mut db, &mut a, "x", "user");
        assert_eq!(db.history(50).unwrap().len(), 3);
        typed(&mut db, &mut a, "", "user");
        assert_eq!(db.history(50).unwrap().len(), 2, "only the root and the node made");
    }

    #[test]
    fn an_edit_of_several_nodes_is_never_joined() {
        let (mut db, mut nodes) = started(&["a", "b"]);
        let b = nodes.pop().unwrap();
        let a = nodes.pop().unwrap();
        let (mut a2, mut b2) = (a.clone(), b.clone());
        a2.title = "x".into();
        b2.title = "y".into();
        std::thread::sleep(std::time::Duration::from_millis(3));
        db.apply(&[Change { before: Some(a), after: a2.clone() }, Change { before: Some(b), after: b2 }]).unwrap();
        let before = a2.clone();
        a2.title = "xx".into();
        step(&mut db, &before, &a2, "user");
        assert_eq!(db.history(50).unwrap().len(), 6, "3 made, 2 typed together, then 1 typed: not joined with a step of two");
    }

    #[test]
    fn a_vault_is_copied_as_it_is_before_it_is_migrated_and_not_otherwise() {
        let dir = std::env::temp_dir().join(format!("brock-premigrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("vault.sqlite");
        let copy = crate::backups::folder(&path).join("vault-before-v6.sqlite");

        // A new vault is not copied.
        drop(Db::open(&path).unwrap());
        assert!(!crate::backups::folder(&path).exists() || std::fs::read_dir(crate::backups::folder(&path)).unwrap().count() == 0);
        std::fs::remove_file(&path).unwrap();
        for ext in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(dir.join(format!("vault.sqlite{ext}")));
        }

        // One an older version left, at database version 6.
        {
            let conn = Connection::open(&path).unwrap();
            for sql in &MIGRATIONS[..6] {
                conn.execute_batch(sql).unwrap();
            }
            conn.pragma_update(None, "user_version", 6).unwrap();
            conn.execute("INSERT INTO nodes (id, sort_key, title, created_at, updated_at) VALUES ('n', 'a0', 'Old', 1, 1)", []).unwrap();
        }
        let migrated = Db::open(&path).unwrap();
        assert_eq!(migrated.get("n").unwrap().unwrap().title, "Old", "and then brought up to date");
        let before = Connection::open(&copy).unwrap();
        assert_eq!(before.query_row::<i64, _, _>("PRAGMA user_version", [], |r| r.get(0)).unwrap(), 6, "the copy is as it was");
        assert_eq!(before.query_row::<String, _, _>("SELECT title FROM nodes WHERE id = 'n'", [], |r| r.get(0)).unwrap(), "Old");
        drop(before);
        drop(migrated);

        // Already up to date: no copy is made again.
        std::fs::remove_file(&copy).unwrap();
        drop(Db::open(&path).unwrap());
        assert!(!copy.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_node_marked_keeps_its_mark_and_level() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "A");
        a.flag = Some("critical".into());
        db.apply(&[Change { before: None, after: a.clone() }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().flag.as_deref(), Some("critical"));
        assert_eq!(db.load().unwrap()[0].flag.as_deref(), Some("critical"));
        let mut cleared = a.clone();
        cleared.flag = None;
        db.apply(&[Change { before: Some(a), after: cleared }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().flag, None);
    }

    #[test]
    fn marks_made_as_yes_or_no_come_over_as_attention() {
        // A vault as step 7 left it: the yes-or-no column, set on one node.
        let conn = Connection::open_in_memory().unwrap();
        for sql in &MIGRATIONS[..7] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 7).unwrap();
        for (id, attention) in [("marked", 1), ("plain", 0)] {
            conn.execute(
                "INSERT INTO nodes (id, sort_key, created_at, updated_at, attention) VALUES (?1, 'a0', 1, 1, ?2)",
                params![id, attention],
            )
            .unwrap();
        }
        let db = Db::setup(conn).unwrap();
        assert_eq!(db.get("marked").unwrap().unwrap().flag.as_deref(), Some("attention"));
        assert_eq!(db.get("plain").unwrap().unwrap().flag, None);
    }

    #[test]
    fn log_entries_from_before_levels_still_read() {
        let mut db = Db::in_memory().unwrap();
        db.apply(&[Change { before: None, after: node("a", None, "A") }]).unwrap();
        // An entry as an earlier version wrote it: a yes-or-no `attention`, and no `flag`.
        db.conn
            .execute("UPDATE ops SET after = json_set(json_remove(after, '$.flag'), '$.attention', json('true'))", [])
            .unwrap();
        let log = db.history(5).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].after.flag, None);
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
    fn a_map_keeps_how_it_is_drawn() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "Home");
        a.layout = Some("org".into());
        db.apply(&[Change { before: None, after: a }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().layout.as_deref(), Some("org"));
    }

    #[test]
    fn a_due_date_is_saved_and_can_be_taken_away() {
        let mut db = Db::in_memory().unwrap();
        let mut a = node("a", None, "Home");
        db.apply(&[Change { before: None, after: a.clone() }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().due, None);
        let before = a.clone();
        a.due = Some("2026-11-02".into());
        db.apply(&[Change { before: Some(before), after: a.clone() }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().due.as_deref(), Some("2026-11-02"));
        let before = a.clone();
        a.due = None;
        db.apply(&[Change { before: Some(before), after: a }]).unwrap();
        assert_eq!(db.get("a").unwrap().unwrap().due, None);
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
        assert_eq!(old.due, None);
        assert_eq!(old.layout, None);
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
        assert!(!carry_over(&old_dir, &new_dir).unwrap(), "once only: a vault with work in it is never written over");
        assert!(!carry_over(&root.join("nothing"), &root.join("fresh")).unwrap(), "nothing to copy");
        drop(old);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_new_vault_that_holds_nothing_is_set_aside_and_the_old_one_copied() {
        let root = std::env::temp_dir().join(format!("brock-carry-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (old_dir, new_dir) = (root.join("old"), root.join("new"));
        let mut old = Db::open(&old_dir.join("vault.sqlite")).unwrap();
        old.apply(&[
            Change { before: None, after: node("root", None, "Home") },
            Change { before: None, after: node("work", Some("root"), "My work") },
        ])
        .unwrap();
        drop(old);

        // Made by the app starting under the new name too early: its top node,
        // and one made and deleted.
        let mut early = Db::open(&new_dir.join("vault.sqlite")).unwrap();
        let mut gone = node("tried", Some("fresh"), "");
        gone.deleted_at = Some(5);
        early.apply(&[Change { before: None, after: node("fresh", None, "Home") }, Change { before: None, after: gone }]).unwrap();
        drop(early);

        assert!(carry_over(&old_dir, &new_dir).unwrap());
        let new = Db::open(&new_dir.join("vault.sqlite")).unwrap();
        assert_eq!(new.get("work").unwrap().unwrap().title, "My work");
        let aside: Vec<_> = std::fs::read_dir(&new_dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("vault-before-copy-") && n.ends_with(".sqlite"))
            .collect();
        assert_eq!(aside.len(), 1, "the early vault is kept beside it");
        let kept = Db::open(&new_dir.join(&aside[0])).unwrap();
        assert!(kept.get("fresh").unwrap().is_some());
        // Windows will not remove a file that is open.
        drop((new, kept));

        // One with work in it is left alone.
        let mut busy = Db::open(&root.join("busy").join("vault.sqlite")).unwrap();
        busy.apply(&[
            Change { before: None, after: node("b", None, "Home") },
            Change { before: None, after: node("c", Some("b"), "Mine") },
        ])
        .unwrap();
        drop(busy);
        assert!(!carry_over(&old_dir, &root.join("busy")).unwrap());
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
