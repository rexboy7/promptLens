use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const DB_SCHEMA_VERSION: i32 = 4;

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

pub fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|e| e.to_string())?;

    let current_version = conn
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i32>(0))
        .map_err(|e| e.to_string())?;

    if current_version != DB_SCHEMA_VERSION {
        conn.execute_batch(
            r#"
            DROP TABLE IF EXISTS images;
            DROP TABLE IF EXISTS batches;
            DROP TABLE IF EXISTS prompts;
            DROP TABLE IF EXISTS prompts_fts;
            DROP TABLE IF EXISTS ratings;
            DROP TABLE IF EXISTS comparisons;
            DROP TABLE IF EXISTS viewed_groups;
            "#,
        )
        .map_err(|e| e.to_string())?;

        conn.execute_batch(
            r#"
            CREATE TABLE prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE
            );
            CREATE VIRTUAL TABLE prompts_fts USING fts5(
                text,
                content='prompts',
                content_rowid='id'
            );
            CREATE TABLE batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                first_serial INTEGER NOT NULL,
                last_serial INTEGER NOT NULL,
                first_seed INTEGER NOT NULL,
                last_seed INTEGER NOT NULL,
                representative_path TEXT NOT NULL
            );
            CREATE TABLE images (
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
            CREATE INDEX idx_images_prompt_id ON images(prompt_id);
            CREATE TABLE ratings (
                group_id TEXT PRIMARY KEY,
                rating REAL NOT NULL,
                matches INTEGER NOT NULL
            );
            CREATE TABLE comparisons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_a TEXT NOT NULL,
                group_b TEXT NOT NULL,
                winner TEXT NOT NULL,
                ts INTEGER NOT NULL
            );
            CREATE TABLE viewed_groups (
                group_id TEXT PRIMARY KEY,
                signature TEXT NOT NULL,
                viewed_at INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')", [])
            .map_err(|e| e.to_string())?;

        conn.execute(
            &format!("PRAGMA user_version = {}", DB_SCHEMA_VERSION),
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS viewed_groups (
            group_id TEXT PRIMARY KEY,
            signature TEXT NOT NULL,
            viewed_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
