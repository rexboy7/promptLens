use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const DB_SCHEMA_VERSION: i32 = 5;

fn stable_root_hash(root_path: &str) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET;
    for byte in root_path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn get_db_path(app: &AppHandle, root_path: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let hash = stable_root_hash(root_path);
    Ok(dir.join(format!("promptlens_{:016x}.sqlite", hash)))
}

pub fn open_db(app: &AppHandle, root_path: &str) -> Result<Connection, String> {
    let db_path = get_db_path(app, root_path)?;
    Connection::open(db_path).map_err(|e| e.to_string())
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            [table_name],
            |_| Ok(()),
        )
        .is_ok();
    Ok(exists)
}

fn ensure_schema_objects(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            first_serial INTEGER NOT NULL,
            last_serial INTEGER NOT NULL,
            first_seed INTEGER NOT NULL,
            last_seed INTEGER NOT NULL,
            representative_path TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            date TEXT NOT NULL,
            serial INTEGER NOT NULL,
            seed INTEGER NOT NULL,
            batch_id INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            prompt_id INTEGER,
            FOREIGN KEY(batch_id) REFERENCES batches(id)
        );
        CREATE INDEX IF NOT EXISTS idx_images_prompt_id ON images(prompt_id);
        CREATE TABLE IF NOT EXISTS ratings (
            group_id TEXT PRIMARY KEY,
            rating REAL NOT NULL,
            matches INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS comparisons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_a TEXT NOT NULL,
            group_b TEXT NOT NULL,
            winner TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS viewed_groups (
            group_id TEXT PRIMARY KEY,
            signature TEXT NOT NULL,
            viewed_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;

    if !table_exists(conn, "prompts_fts")? {
        conn.execute_batch(
            r#"
            CREATE VIRTUAL TABLE prompts_fts USING fts5(
                text,
                content='prompts',
                content_rowid='id'
            );
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')", [])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| e.to_string())?;

    let current_version: i32 = conn
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())?;

    ensure_schema_objects(conn)?;

    if current_version < DB_SCHEMA_VERSION {
        conn.execute(
            &format!("PRAGMA user_version = {}", DB_SCHEMA_VERSION),
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{init_db, table_exists, DB_SCHEMA_VERSION};
    use rusqlite::Connection;

    #[test]
    fn init_db_preserves_existing_data_without_drop() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE
            );
            INSERT INTO prompts (text) VALUES ('keep-me');
            PRAGMA user_version = 4;
            "#,
        )
        .expect("failed to seed legacy schema");

        init_db(&conn).expect("init_db failed");

        let prompt_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM prompts WHERE text = 'keep-me'", [], |row| {
                row.get(0)
            })
            .expect("failed to query prompts");
        assert_eq!(prompt_count, 1);

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("failed to query user_version");
        assert_eq!(version, DB_SCHEMA_VERSION);
    }

    #[test]
    fn init_db_creates_required_tables_for_fresh_database() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("init_db failed");

        assert!(table_exists(&conn, "prompts").expect("failed to check prompts table"));
        assert!(table_exists(&conn, "prompts_fts").expect("failed to check prompts_fts table"));
        assert!(table_exists(&conn, "images").expect("failed to check images table"));
        assert!(table_exists(&conn, "batches").expect("failed to check batches table"));
        assert!(table_exists(&conn, "ratings").expect("failed to check ratings table"));
        assert!(table_exists(&conn, "comparisons").expect("failed to check comparisons table"));
        assert!(
            table_exists(&conn, "viewed_groups").expect("failed to check viewed_groups table")
        );
    }
}
