use crate::db::{init_db, open_db};
use crate::prompts::extract_prompts_for_unparsed;
use crate::types::ScanResult;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use walkdir::WalkDir;

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
    prompt_id: Option<i64>,
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
            .prepare("SELECT path, date, serial, seed, mtime, prompt_id FROM images")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DbImageRow {
                    path: row.get(0)?,
                    date: row.get(1)?,
                    serial: row.get(2)?,
                    seed: row.get(3)?,
                    mtime: row.get(4)?,
                    prompt_id: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let item = row.map_err(|e| e.to_string())?;
            db_items.insert(item.path.clone(), item);
        }
    }

    let mut dates_changed: HashSet<String> = HashSet::new();
    let mut prompt_by_path: HashMap<String, Option<i64>> = HashMap::new();
    for (path, item) in &items_by_path {
        match db_items.remove(path) {
            None => {
                dates_changed.insert(item.date.clone());
            }
            Some(db_item) => {
                let unchanged = db_item.mtime == item.mtime
                    && db_item.serial == item.serial
                    && db_item.seed == item.seed
                    && db_item.date == item.date;
                if !unchanged {
                    dates_changed.insert(db_item.date);
                    dates_changed.insert(item.date.clone());
                } else {
                    prompt_by_path.insert(path.clone(), db_item.prompt_id);
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

                let prompt_id = prompt_by_path
                    .get(&item.path)
                    .and_then(|value| *value);
                tx.execute(
                    r#"
                    INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    "#,
                    params![
                        item.path,
                        item.date,
                        item.serial,
                        item.seed,
                        current_batch_id.unwrap(),
                        item.mtime,
                        prompt_id
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

#[tauri::command]
pub fn scan_directory(app: AppHandle, root_path: String) -> Result<ScanResult, String> {
    let mut conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    let result = build_index(&mut conn, &root_path)?;
    extract_prompts_for_unparsed(&mut conn)?;
    Ok(result)
}
