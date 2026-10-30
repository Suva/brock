//! Keeping the vault small, in the background. The log (`ops`) holds every
//! change, which for typing was once an entry a pause; this joins what is left
//! of that in old entries, and then gives the freed space back to the system.
//!
//! It must never be noticed. It starts a while after the app has, works on its
//! own connection, in small transactions with a pause between, so that the
//! window's own saves go in between, and nothing here holds the window's
//! connection. The only step that cannot be made small is the one-time
//! `VACUUM` that turns on incremental vacuuming; by then the log has been
//! joined and the file holds little, so it takes a moment.

use crate::db::{same_words, words_only, SAME_RUN_MS};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

/// How long after the app starts before the first tidying: the window comes first.
const START_AFTER: Duration = Duration::from_secs(45);
/// How often it looks again while the app stays open.
const EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// Entries newer than this are left as they are.
const LEAVE_RECENT_MS: i64 = 60 * 60 * 1000;
/// Nodes joined in one transaction, and the pause after each such step.
const NODES_PER_STEP: usize = 25;
const PAUSE: Duration = Duration::from_millis(60);
/// Pages given back in one step of incremental vacuuming.
const PAGES_PER_STEP: i64 = 256;
/// Free space worth giving back: this much, or a quarter of the file.
const WORTH_BYTES: i64 = 2 * 1024 * 1024;

#[derive(Debug, Default, PartialEq)]
pub struct Report {
    /// Entries of the log joined into others.
    pub joined: usize,
    /// Bytes the file got smaller by.
    pub reclaimed: i64,
}

/// Starts tidying the vault at `path` in the background, now and then.
pub fn spawn(path: std::path::PathBuf) {
    let spawned = std::thread::Builder::new().name("brock-maintenance".into()).spawn(move || {
        std::thread::sleep(START_AFTER);
        loop {
            match run(&path, now(), PAUSE) {
                Ok(r) if r.joined > 0 || r.reclaimed > 0 => {
                    eprintln!("Tidied the vault: joined {} entries of the log, {} KB smaller", r.joined, r.reclaimed / 1024)
                }
                Ok(_) => {}
                Err(e) => eprintln!("Could not tidy the vault: {e}"),
            }
            std::thread::sleep(EVERY);
        }
    });
    if let Err(e) = spawned {
        eprintln!("Could not start tidying the vault: {e}");
    }
}

/// One round of tidying: a copy of the vault first if today's is not made,
/// then the log joined, then the space given back. `pause` is taken between
/// steps, so that the app's own work goes in between.
pub fn run(path: &Path, now: i64, pause: Duration) -> Result<Report, String> {
    let mut conn = Connection::open(path).map_err(err)?;
    // A save from the window waits for a step of this, never the other way round for long.
    conn.busy_timeout(Duration::from_secs(20)).map_err(err)?;
    conn.execute_batch("PRAGMA synchronous = NORMAL;").map_err(err)?;
    let before = size(&conn)?;
    // Joining entries loses nothing a person can see, but a copy that has the log as it was costs little.
    if let Err(e) = crate::backups::make_if_due(&conn, &crate::backups::folder(path)) {
        eprintln!("{e}");
    }
    let joined = compact_log(&mut conn, now - LEAVE_RECENT_MS, pause)?;
    heal_search_index(&conn)?;
    shrink(&conn, pause)?;
    // Folds the write-ahead log back into the file where it can; never waits for anyone.
    let _ = conn.query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |_| Ok(()));
    Ok(Report { joined, reclaimed: (before - size(&conn)?).max(0) })
}

/// The size of the vault file as SQLite counts it: pages in use and free.
fn size(conn: &Connection) -> Result<i64, String> {
    let pages: i64 = conn.query_row("PRAGMA page_count", [], |r| r.get(0)).map_err(err)?;
    let page: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).map_err(err)?;
    Ok(pages * page)
}

// ---- Joining the log -----------------------------------------------------------

struct Row {
    seq: i64,
    at: i64,
    source: String,
    before: Option<Value>,
    after: Value,
    after_text: String,
}

/// Joins runs of typing in entries made before `cutoff`: edits to one node's
/// words, by one hand, each soon after the one before, none part of a step of
/// several nodes. A run becomes its first entry, from where it began to where
/// it ended; one that ended where it began is removed. Returns the entries
/// joined into others.
pub fn compact_log(conn: &mut Connection, cutoff: i64, pause: Duration) -> Result<usize, String> {
    // Steps that wrote several entries at once: never joined, as one entry of them stands for a step.
    let many: HashSet<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT at, source FROM ops WHERE at < ?1 GROUP BY at, source HAVING count(*) > 1")
            .map_err(err)?;
        let rows = stmt.query_map([cutoff], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };
    let nodes: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT node_id FROM ops WHERE at < ?1 AND before IS NOT NULL")
            .map_err(err)?;
        let rows = stmt.query_map([cutoff], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<_, _>>().map_err(err)?
    };
    let mut joined = 0;
    for chunk in nodes.chunks(NODES_PER_STEP) {
        let tx = conn.transaction().map_err(err)?;
        for node in chunk {
            joined += compact_node(&tx, node, cutoff, &many)?;
        }
        tx.commit().map_err(err)?;
        std::thread::sleep(pause);
    }
    Ok(joined)
}

fn compact_node(tx: &rusqlite::Transaction, node: &str, cutoff: i64, many: &HashSet<(i64, String)>) -> Result<usize, String> {
    let mut rows: Vec<Row> = Vec::new();
    {
        let mut stmt = tx
            .prepare_cached("SELECT seq, at, source, before, after FROM ops WHERE node_id = ?1 AND at < ?2 ORDER BY seq")
            .map_err(err)?;
        let found = stmt
            .query_map(params![node, cutoff], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?))
            })
            .map_err(err)?;
        for row in found {
            let (seq, at, source, before, after_text) = row.map_err(err)?;
            // An entry that cannot be read is left alone: it has no `before`, so it is not typing.
            let after = serde_json::from_str(&after_text).unwrap_or(Value::Null);
            let before = before.and_then(|b| serde_json::from_str(&b).ok());
            rows.push(Row { seq, at, source, before, after, after_text });
        }
    }
    let typing = |row: &Row| match &row.before {
        Some(before) => !many.contains(&(row.at, row.source.clone())) && words_only(before, &row.after),
        None => false,
    };

    let mut joined = 0;
    let mut i = 0;
    while i < rows.len() {
        if !typing(&rows[i]) {
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < rows.len() && typing(&rows[j + 1]) && rows[j + 1].source == rows[i].source && rows[j + 1].at - rows[j].at <= SAME_RUN_MS {
            j += 1;
        }
        if j > i {
            let (first, last) = (&rows[i], &rows[j]);
            let nothing = same_words(first.before.as_ref().unwrap(), &last.after);
            if nothing {
                tx.execute("DELETE FROM ops WHERE seq BETWEEN ?1 AND ?2 AND node_id = ?3", params![first.seq, last.seq, node]).map_err(err)?;
            } else {
                tx.execute("UPDATE ops SET after = ?1, at = ?2 WHERE seq = ?3", params![last.after_text, last.at, first.seq]).map_err(err)?;
                let mut drop = tx.prepare_cached("DELETE FROM ops WHERE seq = ?1").map_err(err)?;
                for row in &rows[i + 1..=j] {
                    drop.execute([row.seq]).map_err(err)?;
                }
            }
            joined += j - i;
        }
        i = j + 1;
    }
    Ok(joined)
}

// ---- The search index ------------------------------------------------------------

/// Makes sure the search index agrees with the nodes it indexes, and builds it
/// again if not: as when the app was quit between a `VACUUM`, which renumbers
/// the rows the index follows, and the rebuild that comes after it. Returns
/// whether it had to.
pub fn heal_search_index(conn: &Connection) -> Result<bool, String> {
    let agrees = conn.execute("INSERT INTO nodes_fts (nodes_fts, rank) VALUES ('integrity-check', 1)", []).is_ok();
    if agrees {
        return Ok(false);
    }
    conn.execute("INSERT INTO nodes_fts (nodes_fts) VALUES ('rebuild')", []).map_err(err)?;
    Ok(true)
}

// ---- Giving the space back -----------------------------------------------------

/// Gives free pages back to the system when there are enough to be worth it.
/// A file that does not yet vacuum incrementally is turned to, with one
/// `VACUUM`, which may renumber the rows of `nodes`: the search index is
/// built again after it, as it follows rows by that number, and checked each
/// round in case the app was quit between the two.
fn shrink(conn: &Connection, pause: Duration) -> Result<(), String> {
    let free = |c: &Connection| -> Result<(i64, i64), String> {
        let free: i64 = c.query_row("PRAGMA freelist_count", [], |r| r.get(0)).map_err(err)?;
        let pages: i64 = c.query_row("PRAGMA page_count", [], |r| r.get(0)).map_err(err)?;
        Ok((free, pages))
    };
    let page: i64 = conn.query_row("PRAGMA page_size", [], |r| r.get(0)).map_err(err)?;
    let (pages_free, pages) = free(conn)?;
    if pages_free * page < WORTH_BYTES && pages_free * 4 < pages {
        return Ok(());
    }
    let mode: i64 = conn.query_row("PRAGMA auto_vacuum", [], |r| r.get(0)).map_err(err)?;
    if mode == 0 {
        conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL; VACUUM; INSERT INTO nodes_fts (nodes_fts) VALUES ('rebuild');").map_err(err)?;
        return Ok(());
    }
    // Stops when a step gives nothing back, so that one that cannot never makes this go on for ever.
    let mut left = free(conn)?.0;
    while left > 0 {
        conn.execute_batch(&format!("PRAGMA incremental_vacuum({PAGES_PER_STEP})")).map_err(err)?;
        let now = free(conn)?.0;
        if now >= left {
            break;
        }
        left = now;
        std::thread::sleep(pause);
    }
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Change, Db, Node};

    fn folder(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("brock-maint-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn node(id: &str, parent: Option<&str>, title: &str) -> Node {
        serde_json::from_value(serde_json::json!({
            "id": id, "parentId": parent, "sortKey": "a0", "side": null, "title": title, "body": "",
            "isMap": parent.is_none(), "collapsed": false, "color": null, "icon": null,
            "createdAt": 1, "updatedAt": 1, "deletedAt": null
        }))
        .unwrap()
    }

    /// Writes log entries as an older version did: one for every keystroke, at `at`.
    fn old_typing(conn: &Connection, id: &str, source: &str, start: i64, words: &[&str]) {
        let mut before = node(id, Some("root"), "");
        for (i, w) in words.iter().enumerate() {
            let mut after = before.clone();
            after.title = (*w).into();
            conn.execute(
                "INSERT INTO ops (at, node_id, before, after, source) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![start + i as i64 * 1000, id, serde_json::to_string(&before).unwrap(), serde_json::to_string(&after).unwrap(), source],
            )
            .unwrap();
            before = after;
        }
    }

    fn vault_file(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = folder(name);
        let path = dir.join("vault.sqlite");
        let mut db = Db::open(&path).unwrap();
        db.apply(&[
            Change { before: None, after: node("root", None, "Home") },
            Change { before: None, after: node("a", Some("root"), "") },
            Change { before: None, after: node("b", Some("root"), "") },
        ])
        .unwrap();
        (dir, path)
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn old_typing_is_joined_into_one_entry_each_with_its_start_and_end() {
        let (dir, path) = vault_file("join");
        let mut conn = Connection::open(&path).unwrap();
        old_typing(&conn, "a", "user", 1_000_000, &["H", "He", "Hel", "Hell", "Hello"]);
        old_typing(&conn, "b", "user", 2_000_000, &["W", "Wo", "Wor"]);
        assert_eq!(compact_log(&mut conn, i64::MAX, Duration::ZERO).unwrap(), 4 + 2);

        let a: (String, String) = conn
            .query_row("SELECT before, after FROM ops WHERE node_id = 'a' AND before IS NOT NULL", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(serde_json::from_str::<Value>(&a.0).unwrap()["title"], "");
        assert_eq!(serde_json::from_str::<Value>(&a.1).unwrap()["title"], "Hello");
        assert_eq!(count(&conn, "SELECT count(*) FROM ops WHERE node_id = 'a'"), 2, "made, and typed");
        assert_eq!(count(&conn, "SELECT at FROM ops WHERE node_id = 'a' AND before IS NOT NULL"), 1_004_000, "as of its last");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn what_is_not_one_hands_quick_typing_in_one_node_is_left() {
        let (dir, path) = vault_file("left");
        let mut conn = Connection::open(&path).unwrap();
        // After a pause, by another hand, and recent.
        old_typing(&conn, "a", "user", 1_000_000, &["a", "ab"]);
        old_typing(&conn, "a", "user", 1_000_000 + SAME_RUN_MS + 10_000, &["abc"]);
        old_typing(&conn, "a", "agent", 1_000_000 + SAME_RUN_MS + 20_000, &["abcd"]);
        old_typing(&conn, "b", "user", 9_000_000, &["x", "xy"]);
        let all = count(&conn, "SELECT count(*) FROM ops");
        // A cutoff before b's typing leaves it, and the pause and the hand split the rest.
        assert_eq!(compact_log(&mut conn, 5_000_000, Duration::ZERO).unwrap(), 1, "only a's first two are one run");
        assert_eq!(count(&conn, "SELECT count(*) FROM ops"), all - 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_step_of_several_nodes_and_other_changes_are_never_joined() {
        let (dir, path) = vault_file("steps");
        let mut conn = Connection::open(&path).unwrap();
        // Two nodes written at once, twice: each entry stands for a step.
        for t in [1_000_000i64, 1_001_000] {
            for id in ["a", "b"] {
                let (before, mut after) = (node(id, Some("root"), ""), node(id, Some("root"), ""));
                after.title = format!("t{t}");
                conn.execute(
                    "INSERT INTO ops (at, node_id, before, after, source) VALUES (?1, ?2, ?3, ?4, 'user')",
                    params![t, id, serde_json::to_string(&before).unwrap(), serde_json::to_string(&after).unwrap()],
                )
                .unwrap();
            }
        }
        // A change of something else for a, between two typed.
        old_typing(&conn, "a", "user", 3_000_000, &["p"]);
        let mut moved = node("a", Some("root"), "p");
        moved.priority = Some(2);
        conn.execute(
            "INSERT INTO ops (at, node_id, before, after, source) VALUES (3001000, 'a', ?1, ?2, 'user')",
            params![serde_json::to_string(&node("a", Some("root"), "p")).unwrap(), serde_json::to_string(&moved).unwrap()],
        )
        .unwrap();
        let all = count(&conn, "SELECT count(*) FROM ops");
        assert_eq!(compact_log(&mut conn, i64::MAX, Duration::ZERO).unwrap(), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM ops"), all);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn typing_that_ended_where_it_began_goes() {
        let (dir, path) = vault_file("none");
        let mut conn = Connection::open(&path).unwrap();
        old_typing(&conn, "a", "user", 1_000_000, &["x", "xy", ""]);
        assert_eq!(compact_log(&mut conn, i64::MAX, Duration::ZERO).unwrap(), 2);
        assert_eq!(count(&conn, "SELECT count(*) FROM ops WHERE node_id = 'a'"), 1, "only its making is left");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_second_round_finds_nothing_more() {
        let (dir, path) = vault_file("again");
        let mut conn = Connection::open(&path).unwrap();
        old_typing(&conn, "a", "user", 1_000_000, &["H", "He", "Hel"]);
        assert_eq!(compact_log(&mut conn, i64::MAX, Duration::ZERO).unwrap(), 2);
        assert_eq!(compact_log(&mut conn, i64::MAX, Duration::ZERO).unwrap(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_search_index_that_has_come_apart_from_the_nodes_is_built_again() {
        let (dir, path) = vault_file("heal");
        let conn = Connection::open(&path).unwrap();
        conn.execute("UPDATE nodes SET title = 'Searchable words' WHERE id = 'a'", []).unwrap();
        assert!(!heal_search_index(&conn).unwrap(), "a good index is left alone");

        // As if the app had been quit just after a VACUUM renumbered the rows, before the rebuild.
        conn.execute("INSERT INTO nodes_fts (nodes_fts) VALUES ('delete-all')", []).unwrap();
        assert!(Db::open(&path).unwrap().search("searchable", 5).unwrap().is_empty(), "the index is wrong");
        assert!(heal_search_index(&conn).unwrap(), "it notices");
        assert_eq!(Db::open(&path).unwrap().search("searchable", 5).unwrap(), vec!["a".to_string()]);
        assert!(!heal_search_index(&conn).unwrap(), "and is satisfied");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_vacuum_that_renumbers_rows_is_noticed_and_healed() {
        let (dir, path) = vault_file("renumber");
        let conn = Connection::open(&path).unwrap();
        conn.execute("UPDATE nodes SET title = 'Searchable words' WHERE id = 'b'", []).unwrap();
        // A gap before b's row, so that a VACUUM has rows to renumber.
        conn.execute("DELETE FROM nodes WHERE id = 'a'", []).unwrap();
        conn.execute_batch("VACUUM").unwrap();
        // Whether this SQLite renumbers or not, after healing the index finds b.
        heal_search_index(&conn).unwrap();
        assert_eq!(Db::open(&path).unwrap().search("searchable", 5).unwrap(), vec!["b".to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_whole_round_makes_the_file_smaller_and_keeps_the_vault_whole() {
        let (dir, path) = vault_file("round");
        {
            let mut conn = Connection::open(&path).unwrap();
            // Old typing, in bulk: enough that giving the space back is worth it.
            for n in 0..40 {
                let id = if n % 2 == 0 { "a" } else { "b" };
                let words: Vec<String> = (1..=300).map(|i| "x".repeat(i % 60 + 1) + &"y".repeat(i / 60 * 20)).collect();
                let words: Vec<&str> = words.iter().map(String::as_str).collect();
                old_typing(&conn, id, if n % 4 < 2 { "user" } else { "agent" }, 1_000_000 + n as i64 * 10_000_000, &words);
            }
            let _ = conn.execute("UPDATE nodes SET title = 'Searchable words' WHERE id = 'a'", []);
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").ok();
            let _ = &mut conn;
        }
        let big = std::fs::metadata(&path).unwrap().len();
        let report = run(&path, now(), Duration::ZERO).unwrap();
        assert!(report.joined > 10_000, "most of the log was typing: {report:?}");

        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").ok();
        let small = std::fs::metadata(&path).unwrap().len();
        assert!(small * 3 < big, "{big} bytes became {small}");
        assert_eq!(count(&conn, "PRAGMA auto_vacuum"), 2, "and later tidying gives space back in small steps");
        assert_eq!(conn.query_row::<String, _, _>("PRAGMA integrity_check", [], |r| r.get(0)).unwrap(), "ok");
        assert_eq!(count(&conn, "SELECT count(*) FROM nodes"), 3);

        // The search index still finds nodes by their words, after rows were renumbered.
        let db = Db::open(&path).unwrap();
        assert_eq!(db.search("searchable", 5).unwrap(), vec!["a".to_string()]);
        assert_eq!(db.history(5).unwrap().len(), 5);

        // A second round has nothing to do, and the file does not change.
        assert_eq!(run(&path, now(), Duration::ZERO).unwrap(), Report::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
