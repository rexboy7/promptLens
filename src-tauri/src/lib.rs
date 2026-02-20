use rusqlite::{params, types::Value, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use walkdir::WalkDir;

const DB_SCHEMA_VERSION: i32 = 4;

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
    date: Option<String>,
    size: i64,
    representative_path: String,
}

#[derive(Serialize)]
struct ImageItem {
    path: String,
    serial: i64,
    seed: i64,
}

#[derive(Serialize)]
struct RatingItem {
    group_id: String,
    rating: f64,
    matches: i64,
}

#[derive(Clone)]
struct ImageMeta {
    path: String,
    date: String,
    serial: i64,
    seed: i64,
    mtime: i64,
}

struct DbImageRow {
    path: String,
    date: String,
    serial: i64,
    seed: i64,
    mtime: i64,
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
            DROP TABLE IF EXISTS prompts_fts;
            DROP TABLE IF EXISTS ratings;
            DROP TABLE IF EXISTS comparisons;
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

    Ok(())
}

fn build_index(conn: &mut Connection, root_path: &str) -> Result<ScanResult, String> {
    let mut items_by_path: HashMap<String, ImageMeta> = HashMap::new();
    let mut items_by_date: HashMap<String, Vec<ImageMeta>> = HashMap::new();
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
            let mtime = match fs::metadata(path)
                .and_then(|m| m.modified())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                })) {
                Ok(duration) => duration.as_secs() as i64,
                Err(_) => 0,
            };
            let meta = ImageMeta {
                path: path_str.clone(),
                date: date.clone(),
                serial,
                seed,
                mtime,
            };
            items_by_path.insert(path_str.clone(), meta.clone());
            items_by_date.entry(date).or_default().push(meta);
        }
    }

    let mut db_items: HashMap<String, DbImageRow> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT path, date, serial, seed, mtime FROM images")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DbImageRow {
                    path: row.get(0)?,
                    date: row.get(1)?,
                    serial: row.get(2)?,
                    seed: row.get(3)?,
                    mtime: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let item = row.map_err(|e| e.to_string())?;
            db_items.insert(item.path.clone(), item);
        }
    }

    let mut dates_changed: HashSet<String> = HashSet::new();
    for (path, item) in &items_by_path {
        match db_items.remove(path) {
            None => {
                dates_changed.insert(item.date.clone());
            }
            Some(db_item) => {
                if db_item.mtime != item.mtime
                    || db_item.serial != item.serial
                    || db_item.seed != item.seed
                    || db_item.date != item.date
                {
                    dates_changed.insert(db_item.date);
                    dates_changed.insert(item.date.clone());
                }
            }
        }
    }
    for (_, db_item) in db_items {
        dates_changed.insert(db_item.date);
    }

    if !dates_changed.is_empty() {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut sorted_dates: Vec<String> = dates_changed.into_iter().collect();
        sorted_dates.sort();
        for date in sorted_dates {
            tx.execute("DELETE FROM images WHERE date = ?1", params![date])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM batches WHERE date = ?1", params![date])
                .map_err(|e| e.to_string())?;
            let Some(mut items) = items_by_date.get(&date).cloned() else {
                continue;
            };
            items.sort_by(|a, b| a.serial.cmp(&b.serial).then(a.seed.cmp(&b.seed)));
            let mut current_batch_id: Option<i64> = None;
            let mut prev_serial: Option<i64> = None;
            let mut prev_seed: Option<i64> = None;
            for item in items {
                let new_sequence = match (prev_serial, prev_seed) {
                    (Some(ps), Some(pd)) => item.serial != ps + 1 || item.seed != pd + 1,
                    _ => true,
                };

                if new_sequence || current_batch_id.is_none() {
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
                } else if let Some(batch_id) = current_batch_id {
                    tx.execute(
                        "UPDATE batches SET last_serial = ?1, last_seed = ?2 WHERE id = ?3",
                        params![item.serial, item.seed, batch_id],
                    )
                    .map_err(|e| e.to_string())?;
                }

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
                        item.mtime
                    ],
                )
                .map_err(|e| e.to_string())?;

                prev_serial = Some(item.serial);
                prev_seed = Some(item.seed);
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    let total_images: i64 = conn
        .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_batches: i64 = conn
        .query_row("SELECT COUNT(*) FROM batches", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(ScanResult {
        total_images: total_images as usize,
        total_batches: total_batches as usize,
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

fn extract_positive_prompt(text: &str) -> String {
    if let Some(index) = text.find("Negative prompt:") {
        return text[..index].trim().trim_end_matches(',').trim().to_string();
    }
    text.trim().trim_end_matches(',').trim().to_string()
}

#[tauri::command]
fn scan_directory(app: AppHandle, root_path: String) -> Result<ScanResult, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;
    build_index(&mut conn, &root_path)
}

#[tauri::command]
fn list_groups(
    app: AppHandle,
    date_filter: Option<String>,
    search_text: Option<String>,
    group_mode: Option<String>,
) -> Result<Vec<GroupItem>, String> {
    let conn = open_db(&app)?;
    init_db(&conn)?;
    let mode = group_mode.unwrap_or_else(|| "prompt".to_string());
    let search = search_text.unwrap_or_default().trim().to_lowercase();
    let search = if search.is_empty() { None } else { Some(search) };
    let search_like = search
        .as_ref()
        .map(|s| format!("%{}%", s))
        .unwrap_or_default();
    let search_fts = search.as_ref().and_then(|text| {
        let tokens: Vec<String> = text
            .split_whitespace()
            .map(|token| {
                token
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_')
                    .collect::<String>()
            })
            .filter(|token| !token.is_empty())
            .collect();
        if tokens.is_empty() {
            None
        } else {
            Some(tokens.join(" AND "))
        }
    });

    if mode == "date" {
        let date_value = date_filter
            .as_ref()
            .map(|value| Value::from(value.clone()))
            .unwrap_or(Value::Null);
        let (query, params_vec) = if search.is_some() {
            (
                r#"
                SELECT
                    'date' AS group_type,
                    i.date AS group_id,
                    i.date AS label,
                    i.date AS date,
                    COUNT(i.id) AS size,
                    MIN(i.path) AS representative_path
                FROM images i
                WHERE (?1 IS NULL OR i.date = ?1)
                  AND LOWER(i.date) LIKE ?2
                GROUP BY i.date
                ORDER BY i.date DESC
                "#,
                vec![date_value, Value::from(search_like.clone())],
            )
        } else {
            (
                r#"
                SELECT
                    'date' AS group_type,
                    i.date AS group_id,
                    i.date AS label,
                    i.date AS date,
                    COUNT(i.id) AS size,
                    MIN(i.path) AS representative_path
                FROM images i
                WHERE (?1 IS NULL OR i.date = ?1)
                GROUP BY i.date
                ORDER BY i.date DESC
                "#,
                vec![date_value],
            )
        };

        let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec), |row| {
                let label: String = row.get(2)?;
                Ok(GroupItem {
                    id: format!("d:{}", label),
                    label,
                    group_type: row.get(0)?,
                    date: row.get(3)?,
                    size: row.get(4)?,
                    representative_path: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut groups = Vec::new();
        for row in rows {
            groups.push(row.map_err(|e| e.to_string())?);
        }
        return Ok(groups);
    }

    let use_fts = search_fts.is_some();
    let fts_filter = if use_fts {
        "AND p.id IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?2)"
    } else {
        ""
    };

    let (prompt_query, order_clause) = if mode == "date_prompt" {
        (
            r#"
            SELECT
                'date_prompt' AS group_type,
                p.id AS group_id,
                p.text AS label,
                i.date AS date,
                COUNT(i.id) AS size,
                MIN(i.path) AS representative_path,
                NULL AS score
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY i.date, p.id
            "#
            .replace("{fts_where}", fts_filter),
            "ORDER BY date DESC, label DESC".to_string(),
        )
    } else if mode == "prompt_date" {
        (
            r#"
            SELECT
                'prompt_date' AS group_type,
                p.id AS group_id,
                p.text AS label,
                i.date AS date,
                COUNT(i.id) AS size,
                MIN(i.path) AS representative_path,
                NULL AS score
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id, i.date
            "#
            .replace("{fts_where}", fts_filter),
            "ORDER BY group_type ASC, label DESC".to_string(),
        )
    } else if mode == "score" {
        (
            r#"
            SELECT
                'prompt' AS group_type,
                p.id AS group_id,
                p.text AS label,
                NULL AS date,
                COUNT(i.id) AS size,
                MIN(i.path) AS representative_path,
                COALESCE(r.rating, 1000) AS score
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            LEFT JOIN ratings r ON r.group_id = 'p:' || p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id
            "#
            .replace("{fts_where}", fts_filter),
            "ORDER BY score DESC, label DESC".to_string(),
        )
    } else {
        (
            r#"
            SELECT
                'prompt' AS group_type,
                p.id AS group_id,
                p.text AS label,
                NULL AS date,
                COUNT(i.id) AS size,
                MIN(i.path) AS representative_path,
                NULL AS score
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id
            "#
            .replace("{fts_where}", fts_filter),
            "ORDER BY group_type ASC, label DESC".to_string(),
        )
    };

    let date_like_param = if use_fts { "?3" } else { "?2" };
    let batch_search_clause = if search.is_some() {
        format!("AND LOWER(b.date) LIKE {}", date_like_param)
    } else {
        String::new()
    };
    let mut stmt = conn
        .prepare(
            &format!(
                r#"
            SELECT group_type, group_id, label, date, size, representative_path
            FROM (
                {}

                UNION ALL

                SELECT
                    'batch' AS group_type,
                    b.id AS group_id,
                    b.date AS label,
                    b.date AS date,
                    COUNT(i.id) AS size,
                    b.representative_path AS representative_path,
                    NULL AS score
                FROM batches b
                JOIN images i ON i.batch_id = b.id
                WHERE i.prompt_id IS NULL
                  AND (?1 IS NULL OR i.date = ?1)
                  {batch_search}
                GROUP BY b.id, b.date
            )
            {}
            "#,
                prompt_query,
                order_clause,
                batch_search = batch_search_clause
            ),
        )
        .map_err(|e| e.to_string())?;

    let date_value = date_filter
        .as_ref()
        .map(|value| Value::from(value.clone()))
        .unwrap_or(Value::Null);
    let params_vec = if search.is_none() {
        vec![date_value.clone()]
    } else if use_fts {
        vec![
            date_value.clone(),
            Value::from(search_fts.clone().unwrap_or_default()),
            Value::from(search_like.clone()),
        ]
    } else {
        vec![date_value.clone(), Value::from(search_like.clone())]
    };

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
            let group_type: String = row.get(0)?;
            let group_id: i64 = row.get(1)?;
            let label: String = row.get(2)?;
            let date: Option<String> = row.get(3)?;
            Ok(GroupItem {
                id: if group_type == "prompt_date" || group_type == "date_prompt" {
                    format!("pd:{}:{}", group_id, date.clone().unwrap_or_default())
                } else {
                    format!(
                        "{}:{}",
                        if group_type == "prompt" { "p" } else { "b" },
                        group_id
                    )
                },
                label,
                group_type,
                date,
                size: row.get(4)?,
                representative_path: row.get(5)?,
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
    let (query, params_vec): (&str, Vec<String>) = if group_type == "p" {
        ("WHERE prompt_id = ?1", vec![raw_id.to_string()])
    } else if group_type == "b" {
        ("WHERE batch_id = ?1", vec![raw_id.to_string()])
    } else if group_type == "pd" {
        let parts: Vec<&str> = group_id.splitn(3, ':').collect();
        if parts.len() != 3 {
            return Err("Invalid prompt-date group id".to_string());
        }
        (
            "WHERE prompt_id = ?1 AND date = ?2",
            vec![parts[1].to_string(), parts[2].to_string()],
        )
    } else if group_type == "d" {
        ("WHERE date = ?1", vec![raw_id.to_string()])
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
        .query_map(rusqlite::params_from_iter(params_vec), |row| {
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

fn delete_images_by_query(
    conn: &mut Connection,
    query: &str,
    params_vec: Vec<rusqlite::types::Value>,
) -> Result<usize, String> {
    let to_delete: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec), |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut collected = Vec::new();
        for row in rows {
            collected.push(row.map_err(|e| e.to_string())?);
        }
        collected
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (id, path) in &to_delete {
        let _ = fs::remove_file(path);
        tx.execute("DELETE FROM images WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "DELETE FROM prompts WHERE id NOT IN (SELECT DISTINCT prompt_id FROM images WHERE prompt_id IS NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM images)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(to_delete.len())
}

#[tauri::command]
fn delete_image(app: AppHandle, image_path: String) -> Result<bool, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&image_path);
    tx.execute("DELETE FROM images WHERE path = ?1", params![image_path])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM prompts WHERE id NOT IN (SELECT DISTINCT prompt_id FROM images WHERE prompt_id IS NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM images)",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn get_ratings(app: AppHandle, group_ids: Vec<String>) -> Result<Vec<RatingItem>, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in &group_ids {
        tx.execute(
            "INSERT OR IGNORE INTO ratings (group_id, rating, matches) VALUES (?1, 1000.0, 0)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT group_id, rating, matches FROM ratings WHERE group_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for id in group_ids {
        if let Ok(item) = stmt.query_row(params![id], |row| {
            Ok(RatingItem {
                group_id: row.get(0)?,
                rating: row.get(1)?,
                matches: row.get(2)?,
            })
        }) {
            results.push(item);
        }
    }
    Ok(results)
}

#[tauri::command]
fn submit_comparison(
    app: AppHandle,
    left_id: String,
    right_id: String,
    winner_id: String,
) -> Result<bool, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO ratings (group_id, rating, matches) VALUES (?1, 1000.0, 0)",
        params![left_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO ratings (group_id, rating, matches) VALUES (?1, 1000.0, 0)",
        params![right_id],
    )
    .map_err(|e| e.to_string())?;

    let (left_rating, left_matches): (f64, i64) = tx
        .query_row(
            "SELECT rating, matches FROM ratings WHERE group_id = ?1",
            params![left_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let (right_rating, right_matches): (f64, i64) = tx
        .query_row(
            "SELECT rating, matches FROM ratings WHERE group_id = ?1",
            params![right_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let expected_left = 1.0 / (1.0 + 10.0_f64.powf((right_rating - left_rating) / 400.0));
    let expected_right = 1.0 / (1.0 + 10.0_f64.powf((left_rating - right_rating) / 400.0));
    let k = 24.0;
    let (left_score, right_score, bonus) = if winner_id == left_id {
        (1.0, 0.0, 0.0)
    } else if winner_id == right_id {
        (0.0, 1.0, 0.0)
    } else if winner_id == "both_good" {
        (0.5, 0.5, 4.0)
    } else if winner_id == "both_bad" {
        (0.5, 0.5, -4.0)
    } else {
        (0.5, 0.5, 0.0)
    };

    let new_left = left_rating + k * (left_score - expected_left) + bonus;
    let new_right = right_rating + k * (right_score - expected_right) + bonus;

    tx.execute(
        "UPDATE ratings SET rating = ?1, matches = ?2 WHERE group_id = ?3",
        params![new_left, left_matches + 1, left_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE ratings SET rating = ?1, matches = ?2 WHERE group_id = ?3",
        params![new_right, right_matches + 1, right_id],
    )
    .map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    tx.execute(
        "INSERT INTO comparisons (group_a, group_b, winner, ts) VALUES (?1, ?2, ?3, ?4)",
        params![left_id, right_id, winner_id, ts],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn delete_group(app: AppHandle, group_id: String) -> Result<usize, String> {
    let mut conn = open_db(&app)?;
    init_db(&conn)?;
    let (group_type, raw_id) = group_id
        .split_once(':')
        .ok_or_else(|| "Invalid group id".to_string())?;

    if group_type == "p" {
        let id = raw_id.parse::<i64>().map_err(|_| "Invalid group id".to_string())?;
        return delete_images_by_query(
            &mut conn,
            "SELECT id, path FROM images WHERE prompt_id = ?1",
            vec![rusqlite::types::Value::from(id)],
        );
    }
    if group_type == "b" {
        let id = raw_id.parse::<i64>().map_err(|_| "Invalid group id".to_string())?;
        return delete_images_by_query(
            &mut conn,
            "SELECT id, path FROM images WHERE batch_id = ?1",
            vec![rusqlite::types::Value::from(id)],
        );
    }
    if group_type == "d" {
        return delete_images_by_query(
            &mut conn,
            "SELECT id, path FROM images WHERE date = ?1",
            vec![rusqlite::types::Value::from(raw_id.to_string())],
        );
    }
    if group_type == "pd" {
        let parts: Vec<&str> = group_id.splitn(3, ':').collect();
        if parts.len() != 3 {
            return Err("Invalid prompt-date group id".to_string());
        }
        let prompt_id = parts[1]
            .parse::<i64>()
            .map_err(|_| "Invalid prompt-date group id".to_string())?;
        return delete_images_by_query(
            &mut conn,
            "SELECT id, path FROM images WHERE prompt_id = ?1 AND date = ?2",
            vec![
                rusqlite::types::Value::from(prompt_id),
                rusqlite::types::Value::from(parts[2].to_string()),
            ],
        );
    }

    Err("Unknown group id type".to_string())
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
            let positive = extract_positive_prompt(&prompt);
            if !positive.is_empty() {
                updates.push((image_id, positive));
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
            "INSERT OR REPLACE INTO prompts_fts (rowid, text) VALUES (?1, ?2)",
            params![prompt_id, prompt],
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

fn build_menu<R: Runtime>(app: &tauri::App<R>) -> Result<Menu<R>, tauri::Error> {
    let random_image = MenuItem::with_id(
        app,
        "random_image",
        "Random Image",
        true,
        Option::<&str>::None,
    )?;
    let random_any =
        MenuItem::with_id(app, "random_any", "Random Any", true, Option::<&str>::None)?;
    let slideshow =
        MenuItem::with_id(app, "slideshow", "Slideshow", true, Option::<&str>::None)?;
    let slideshow_any = MenuItem::with_id(
        app,
        "slideshow_any",
        "Slideshow Any",
        true,
        Option::<&str>::None,
    )?;
    let delete_image = MenuItem::with_id(
        app,
        "delete_image",
        "Delete Image",
        true,
        Option::<&str>::None,
    )?;
    let delete_group = MenuItem::with_id(
        app,
        "delete_group",
        "Delete Group",
        true,
        Option::<&str>::None,
    )?;
    let fullscreen = MenuItem::with_id(
        app,
        "fullscreen",
        "Toggle Fullscreen",
        true,
        Option::<&str>::None,
    )?;
    let extract_prompts = MenuItem::with_id(
        app,
        "extract_prompts",
        "Extract Prompts",
        true,
        Option::<&str>::None,
    )?;

    let actions_submenu = Submenu::with_items(
        app,
        "Actions",
        true,
        &[
            &random_image,
            &random_any,
            &slideshow,
            &slideshow_any,
            &delete_image,
            &delete_group,
            &fullscreen,
            &extract_prompts,
        ],
    )?;

    Menu::with_items(app, &[&actions_submenu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            list_groups,
            list_images,
            delete_image,
            delete_group,
            extract_prompts,
            get_ratings,
            submit_comparison
        ])
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id();
            let window = app.get_webview_window("main");
            if let Some(window) = window {
                let _ = window.emit("menu-action", id.as_ref());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
