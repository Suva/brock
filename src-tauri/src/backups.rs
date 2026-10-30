//! Copies of the vault: one a day, the last few kept, in a `Backups` folder
//! beside it. SQLite writes each copy whole and consistent while the app goes
//! on using the vault (`VACUUM INTO`), to a temporary name first, so a copy
//! is never left half written. A temporary file left by an app quit midway is
//! removed by the next copy made, whatever day it is for.

use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many daily copies are kept.
pub const KEEP: usize = 7;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub name: String,
    pub bytes: u64,
    /// Milliseconds since 1970.
    pub made_at: i64,
}

pub fn folder(vault: &Path) -> PathBuf {
    vault.parent().unwrap_or(Path::new(".")).join("Backups")
}

/// Makes today's copy if there is none yet, and drops the oldest past `KEEP`.
/// Returns whether a copy was made.
pub fn make_if_due(conn: &Connection, dir: &Path) -> Result<bool, String> {
    if dir.join(name_for(today())).exists() {
        return Ok(false);
    }
    make(conn, dir)?;
    Ok(true)
}

/// Makes today's copy now, replacing one made earlier today.
pub fn make(conn: &Connection, dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot make {}: {e}", dir.display()))?;
    let path = dir.join(name_for(today()));
    let partial = path.with_extension("partial");
    let _ = std::fs::remove_file(&partial);
    remove_stale_partials(dir);
    conn.execute("VACUUM INTO ?1", [partial.to_string_lossy()])
        .map_err(|e| format!("Cannot copy the vault: {e}"))?;
    std::fs::rename(&partial, &path).map_err(|e| format!("Cannot keep the copy: {e}"))?;
    prune(dir)
}

/// How old a temporary file must be to be one left behind, not one being written now.
const STALE: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Removes temporary copies left by an app that was quit while making one. Their
/// names are of the day they were started, so the next day's copy would never
/// replace them. A copy takes seconds, so a recent one is being made, and stays.
fn remove_stale_partials(dir: &Path) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("vault-") && name.ends_with(".partial")) {
            continue;
        }
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The copies there are, the latest first.
pub fn list(dir: &Path) -> Vec<Backup> {
    let mut out: Vec<Backup> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_copy(&name) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let made_at = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64;
            Some(Backup { name, bytes: meta.len(), made_at })
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

fn prune(dir: &Path) -> Result<(), String> {
    for old in list(dir).into_iter().skip(KEEP) {
        std::fs::remove_file(dir.join(&old.name)).map_err(|e| format!("Cannot remove an old copy: {e}"))?;
    }
    Ok(())
}

/// Whether `name` is a daily copy, `vault-2026-01-01.sqlite`: not another file kept beside them,
/// such as `vault-before-v10.sqlite`, the vault as it was before an update.
fn is_copy(name: &str) -> bool {
    let b = name.as_bytes();
    name.len() == "vault-2026-01-01.sqlite".len()
        && name.starts_with("vault-")
        && name.ends_with(".sqlite")
        && b[6..10].iter().chain(&b[11..13]).chain(&b[14..16]).all(u8::is_ascii_digit)
        && b[10] == b'-'
        && b[13] == b'-'
}

fn name_for((y, m, d): (i64, u32, u32)) -> String {
    format!("vault-{y:04}-{m:02}-{d:02}.sqlite")
}

/// Today's date in UTC, as the system's clock gives it.
fn today() -> (i64, u32, u32) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    civil_from_days((secs / 86_400) as i64)
}

/// The calendar date of a day counted from 1970-01-01 (Howard Hinnant's
/// `civil_from_days`), so as not to need a date library for one name.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_daily_copies_are_copies() {
        assert!(is_copy("vault-2026-10-30.sqlite"));
        assert!(!is_copy("vault-before-v10.sqlite"), "the same length, and not a daily copy");
        assert!(!is_copy("vault-before-v6.sqlite"));
        assert!(!is_copy("vault-2026-10-30.partial"));
        assert!(!is_copy("vault-2026-1x-30.sqlite"));
        assert!(!is_copy("notes.txt"));
    }

    #[test]
    fn dates_from_day_numbers() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(20_746), (2026, 10, 20));
    }

    #[test]
    fn a_copy_left_half_made_is_removed_by_the_next_one_but_one_being_made_is_not() {
        let dir = std::env::temp_dir().join(format!("brock-backups-partial-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (left, being_made) = (dir.join("vault-2000-01-01.partial"), dir.join("vault-2000-01-02.partial"));
        std::fs::write(&left, b"half").unwrap();
        std::fs::write(&being_made, b"half").unwrap();
        // Old enough to have been left behind.
        let old = std::time::SystemTime::now() - STALE - std::time::Duration::from_secs(60);
        std::fs::File::options().write(true).open(&left).unwrap().set_modified(old).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (x);").unwrap();
        make(&conn, &dir).unwrap();
        assert!(!left.exists(), "left by an app that was quit");
        assert!(being_made.exists(), "this one may be being written");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_copy_a_day_and_only_the_last_few_kept() {
        let dir = std::env::temp_dir().join(format!("brock-backups-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (42);").unwrap();

        assert!(make_if_due(&conn, &dir).unwrap());
        assert!(!make_if_due(&conn, &dir).unwrap(), "one a day");
        let copies = list(&dir);
        assert_eq!(copies.len(), 1);
        let copy = Connection::open(dir.join(&copies[0].name)).unwrap();
        let x: i64 = copy.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42, "the copy holds the vault");
        // Windows will not replace or remove a file that is open.
        drop(copy);

        for day in 1..=9 {
            std::fs::write(dir.join(format!("vault-2000-01-{day:02}.sqlite")), b"old").unwrap();
        }
        std::fs::write(dir.join("notes.txt"), b"not a copy").unwrap();
        make(&conn, &dir).unwrap();
        let names: Vec<String> = list(&dir).into_iter().map(|b| b.name).collect();
        assert_eq!(names.len(), KEEP);
        assert_eq!(names[0], name_for(today()), "today's is kept");
        assert!(!names.contains(&"vault-2000-01-01.sqlite".to_string()), "the oldest went");
        assert!(dir.join("notes.txt").exists(), "other files are left alone");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
