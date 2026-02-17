use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

#[derive(Serialize)]
struct ScanResult {
    total_images: usize,
    total_batches: usize,
}

#[derive(Serialize)]
struct GroupItem {
    id: i64,
    date: String,
    size: i64,
    representative_path: String,
}

#[derive(Serialize)]
struct ImageItem {
    path: String,
    serial: i64,
    seed: i64,
}

#[derive(Clone)]
struct ImageMeta {
    path: String,
    date: String,
    serial: i64,
    seed: i64,
}

fn is_date_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[5..7].iter().all(|b| b.is_ascii_digit())
        && bytes[8..10].iter().all(|b| b.is_ascii_digit())
}

fn extract_date_from_path(path: &Path) -> Option<String> {
    path.components()
        .filter_map(|c| c.as_os_str().to_str())
        .filter(|s| is_date_segment(s))
        .map(|s| s.to_string())
        .last()
}

fn parse_filename(path: &Path) -> Option<(i64, i64)> {
    let file_name = path.file_name()?.to_str()?;
    let lower = file_name.to_ascii_lowercase();
    if !lower.ends_with(".png") {
        return None;
    }
    let base = &file_name[..file_name.len().saturating_sub(4)];
    let mut parts = base.splitn(2, '-');
    let serial = parts.next()?.parse::<i64>().ok()?;
    let seed = parts.next()?.parse::<i64>().ok()?;
    Some((serial, seed))
}

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("promptlens.sqlite"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let db_path = get_db_path(app)?;
    Connection::open(db_path).map_err(|e| e.to_string())
}

fn init_db(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
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
            FOREIGN KEY(batch_id) REFERENCES batches(id)
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

fn build_index(conn: &mut Connection, root_path: &str) -> Result<ScanResult, String> {
    let mut items: Vec<ImageMeta> = Vec::new();
    for entry in WalkDir::new(root_path).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if let Some((serial, seed)) = parse_filename(path) {
            let date = match extract_date_from_path(path) {
                Some(d) => d,
                None => continue,
            };
            let path_str = path.to_string_lossy().to_string();
            items.push(ImageMeta {
                path: path_str,
                date,
                serial,
                seed,
            });
        }
    }

    items.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then(a.serial.cmp(&b.serial))
            .then(a.seed.cmp(&b.seed))
    });

    conn.execute_batch(
        r#"
        DELETE FROM images;
        DELETE FROM batches;
        "#,
    )
    .map_err(|e| e.to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut total_batches = 0usize;
    let mut total_images = 0usize;

    let mut current_date: Option<String> = None;
    let mut current_batch_id: Option<i64> = None;
    let mut prev_serial: Option<i64> = None;
    let mut prev_seed: Option<i64> = None;

    for item in items {
        let new_date = current_date.as_deref() != Some(&item.date);
        let new_sequence = match (prev_serial, prev_seed) {
            (Some(ps), Some(pd)) => item.serial != ps + 1 || item.seed != pd + 1,
            _ => true,
        };

        if new_date || new_sequence || current_batch_id.is_none() {
            let batch_id = tx
                .execute(
                    r#"
                    INSERT INTO batches (
                        date, first_serial, last_serial, first_seed, last_seed, representative_path
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    "#,
                    params![
                        item.date,
                        item.serial,
                        item.serial,
                        item.seed,
                        item.seed,
                        item.path
                    ],
                )
                .map_err(|e| e.to_string())
                .and_then(|_| Ok(tx.last_insert_rowid()))?;
            current_batch_id = Some(batch_id);
            current_date = Some(item.date.clone());
            total_batches += 1;
        } else if let Some(batch_id) = current_batch_id {
            tx.execute(
                "UPDATE batches SET last_serial = ?1, last_seed = ?2 WHERE id = ?3",
                params![item.serial, item.seed, batch_id],
            )
            .map_err(|e| e.to_string())?;
        }

        let mtime = match fs::metadata(&item.path)
            .and_then(|m| m.modified())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
            })) {
            Ok(duration) => duration.as_secs() as i64,
            Err(_) => 0,
        };

        tx.execute(
            r#"
            INSERT INTO images (path, date, serial, seed, batch_id, mtime)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                item.path,
                item.date,
                item.serial,
                item.seed,
                current_batch_id.unwrap(),
                mtime
            ],
        )
        .map_err(|e| e.to_string())?;

        total_images += 1;
        prev_serial = Some(item.serial);
        prev_seed = Some(item.seed);
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ScanResult {
        total_images,
        total_batches,
    })
}

#[tauri::command]
fn scan_directory(app: AppHandle, root_path: String) -> Result<ScanResult, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;
    build_index(&mut conn, &root_path)
}

#[tauri::command]
fn list_groups(app: AppHandle, date_filter: Option<String>) -> Result<Vec<GroupItem>, String> {
    let conn = open_db(&app)?;
    init_db(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT b.id, b.date, COUNT(i.id) AS size, b.representative_path
            FROM batches b
            LEFT JOIN images i ON i.batch_id = b.id
            WHERE (?1 IS NULL OR b.date = ?1)
            GROUP BY b.id
            ORDER BY b.date DESC, b.id DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![date_filter], |row| {
            Ok(GroupItem {
                id: row.get(0)?,
                date: row.get(1)?,
                size: row.get(2)?,
                representative_path: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut groups = Vec::new();
    for row in rows {
        groups.push(row.map_err(|e| e.to_string())?);
    }
    Ok(groups)
}

#[tauri::command]
fn list_images(app: AppHandle, batch_id: i64) -> Result<Vec<ImageItem>, String> {
    let conn = open_db(&app)?;
    init_db(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT path, serial, seed
            FROM images
            WHERE batch_id = ?1
            ORDER BY serial ASC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![batch_id], |row| {
            Ok(ImageItem {
                path: row.get(0)?,
                serial: row.get(1)?,
                seed: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for row in rows {
        images.push(row.map_err(|e| e.to_string())?);
    }
    Ok(images)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            list_groups,
            list_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
