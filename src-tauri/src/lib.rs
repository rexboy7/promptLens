use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const DB_SCHEMA_VERSION: i32 = 2;

#[derive(Serialize)]
struct ScanResult {
    total_images: usize,
    total_batches: usize,
}

#[derive(Serialize)]
struct PromptResult {
    scanned: usize,
    updated: usize,
}

#[derive(Serialize)]
struct GroupItem {
    id: String,
    label: String,
    group_type: String,
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
            "#,
        )
        .map_err(|e| e.to_string())?;

        conn.execute_batch(
            r#"
            CREATE TABLE prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE
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
            "#,
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            &format!("PRAGMA user_version = {}", DB_SCHEMA_VERSION),
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
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

fn extract_parameters_from_png(path: &Path) -> Option<String> {
    const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 8 || bytes[0..8] != PNG_SIGNATURE {
        return None;
    }

    let mut index = 8usize;
    while index + 8 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[index],
            bytes[index + 1],
            bytes[index + 2],
            bytes[index + 3],
        ]) as usize;
        let chunk_type = &bytes[index + 4..index + 8];
        let data_start = index + 8;
        let data_end = data_start.saturating_add(length);
        if data_end > bytes.len() {
            break;
        }
        let data = &bytes[data_start..data_end];

        if chunk_type == b"tEXt" {
            if let Some(prompt) = parse_text_chunk(data) {
                return Some(prompt);
            }
        } else if chunk_type == b"iTXt" {
            if let Some(prompt) = parse_itext_chunk(data) {
                return Some(prompt);
            }
        }

        index = data_end + 4;
    }
    None
}

fn parse_text_chunk(data: &[u8]) -> Option<String> {
    let null_pos = data.iter().position(|b| *b == 0)?;
    let keyword = String::from_utf8_lossy(&data[..null_pos]).to_string();
    if keyword != "parameters" {
        return None;
    }
    let text_bytes = &data[null_pos + 1..];
    Some(String::from_utf8_lossy(text_bytes).to_string())
}

fn parse_itext_chunk(data: &[u8]) -> Option<String> {
    let keyword_end = data.iter().position(|b| *b == 0)?;
    let keyword = String::from_utf8_lossy(&data[..keyword_end]).to_string();
    if keyword != "parameters" {
        return None;
    }
    let mut cursor = keyword_end + 1;
    if cursor + 2 > data.len() {
        return None;
    }
    let compression_flag = data[cursor];
    let _compression_method = data[cursor + 1];
    cursor += 2;

    let language_end = data[cursor..].iter().position(|b| *b == 0)? + cursor;
    cursor = language_end + 1;
    let translated_end = data[cursor..].iter().position(|b| *b == 0)? + cursor;
    cursor = translated_end + 1;

    let text_bytes = &data[cursor..];
    if compression_flag == 1 {
        let mut decoder = flate2::read::ZlibDecoder::new(text_bytes);
        let mut decoded = Vec::new();
        decoder.read_to_end(&mut decoded).ok()?;
        return Some(String::from_utf8_lossy(&decoded).to_string());
    }
    Some(String::from_utf8_lossy(text_bytes).to_string())
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
            SELECT group_type, group_id, label, size, representative_path
            FROM (
                SELECT
                    'prompt' AS group_type,
                    p.id AS group_id,
                    p.text AS label,
                    COUNT(i.id) AS size,
                    MIN(i.path) AS representative_path
                FROM prompts p
                JOIN images i ON i.prompt_id = p.id
                WHERE (?1 IS NULL OR i.date = ?1)
                GROUP BY p.id

                UNION ALL

                SELECT
                    'batch' AS group_type,
                    b.id AS group_id,
                    b.date AS label,
                    COUNT(i.id) AS size,
                    b.representative_path AS representative_path
                FROM batches b
                JOIN images i ON i.batch_id = b.id
                WHERE i.prompt_id IS NULL
                  AND (?1 IS NULL OR i.date = ?1)
                GROUP BY b.id
            )
            ORDER BY group_type ASC, label DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![date_filter], |row| {
            let group_type: String = row.get(0)?;
            let group_id: i64 = row.get(1)?;
            let label: String = row.get(2)?;
            Ok(GroupItem {
                id: format!(
                    "{}:{}",
                    if group_type == "prompt" { "p" } else { "b" },
                    group_id
                ),
                label,
                group_type,
                size: row.get(3)?,
                representative_path: row.get(4)?,
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
fn list_images(app: AppHandle, group_id: String) -> Result<Vec<ImageItem>, String> {
    let conn = open_db(&app)?;
    init_db(&conn)?;
    let (group_type, raw_id) = group_id
        .split_once(':')
        .ok_or_else(|| "Invalid group id".to_string())?;
    let group_numeric = raw_id
        .parse::<i64>()
        .map_err(|_| "Invalid group id".to_string())?;
    let (query, param) = if group_type == "p" {
        ("WHERE prompt_id = ?1", group_numeric)
    } else if group_type == "b" {
        ("WHERE batch_id = ?1", group_numeric)
    } else {
        return Err("Unknown group id type".to_string());
    };
    let mut stmt = conn
        .prepare(
            &format!(
                r#"
                SELECT path, serial, seed
                FROM images
                {}
                ORDER BY serial ASC
                "#,
                query
            ),
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![param], |row| {
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

#[tauri::command]
fn extract_prompts(app: AppHandle) -> Result<PromptResult, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;

    let rows: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, path FROM images WHERE prompt_id IS NULL")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut collected = Vec::new();
        for row in rows {
            collected.push(row.map_err(|e| e.to_string())?);
        }
        collected
    };

    let mut updates: Vec<(i64, String)> = Vec::new();
    let mut scanned = 0usize;
    for (image_id, path) in rows {
        scanned += 1;
        if let Some(prompt) = extract_parameters_from_png(Path::new(&path)) {
            if !prompt.trim().is_empty() {
                updates.push((image_id, prompt));
            }
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut updated = 0usize;
    for (image_id, prompt) in updates {
        tx.execute(
            "INSERT OR IGNORE INTO prompts (text) VALUES (?1)",
            params![prompt],
        )
        .map_err(|e| e.to_string())?;
        let prompt_id: i64 = tx
            .query_row(
                "SELECT id FROM prompts WHERE text = ?1",
                params![prompt],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE images SET prompt_id = ?1 WHERE id = ?2",
            params![prompt_id, image_id],
        )
        .map_err(|e| e.to_string())?;
        updated += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(PromptResult { scanned, updated })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            list_groups,
            list_images,
            extract_prompts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
