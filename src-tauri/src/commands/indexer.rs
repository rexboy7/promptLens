use crate::db::{init_db, open_db};
use crate::prompts::extract_prompts_for_unparsed;
use crate::types::{ScanProgressEvent, ScanResult, ScanStartResponse};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
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

#[derive(Clone, Debug)]
struct ScanFolderState {
    dir_mtime: i64,
}

#[derive(Clone, Debug)]
struct ScanFolderMetrics {
    file_count: i64,
    max_serial: i64,
    max_seed: i64,
    dir_mtime: i64,
}

struct FsSnapshot {
    items_by_path: HashMap<String, ImageMeta>,
    items_by_date: HashMap<String, Vec<ImageMeta>>,
    encountered_date_folders: HashSet<String>,
    skipped_date_folders: HashSet<String>,
    scan_folder_metrics: HashMap<String, ScanFolderMetrics>,
}

struct Delta {
    dates_changed: HashSet<String>,
    prompt_by_path: HashMap<String, Option<i64>>,
}

struct BuildIndexOutcome {
    result: ScanResult,
    scanned_files: usize,
}

#[derive(Clone)]
pub struct ScanManager {
    active_scan_id: Arc<Mutex<Option<String>>>,
}

impl Default for ScanManager {
    fn default() -> Self {
        Self {
            active_scan_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl ScanManager {
    fn try_start(&self, scan_id: String) -> Result<(), String> {
        let mut guard = self
            .active_scan_id
            .lock()
            .map_err(|_| "Scan state lock poisoned".to_string())?;
        if guard.is_some() {
            return Err("A scan is already running".to_string());
        }
        *guard = Some(scan_id);
        Ok(())
    }

    fn finish(&self, scan_id: &str) {
        if let Ok(mut guard) = self.active_scan_id.lock() {
            if guard.as_deref() == Some(scan_id) {
                *guard = None;
            }
        }
    }
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

fn extract_date_folder_path(path: &Path) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    let mut latest_date_path: Option<PathBuf> = None;
    for component in path.components() {
        result.push(component.as_os_str());
        if let Some(segment) = component.as_os_str().to_str() {
            if is_date_segment(segment) {
                latest_date_path = Some(result.clone());
            }
        }
    }
    latest_date_path
}

fn unix_mtime(path: &Path) -> i64 {
    match fs::metadata(path)
        .and_then(|m| m.modified())
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        }) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => 0,
    }
}

fn emit_scan_progress(app: &AppHandle, progress: ScanProgressEvent) {
    let _ = app.emit("scan-progress", progress);
}

fn load_known_scan_folders(conn: &Connection) -> Result<HashMap<String, ScanFolderState>, String> {
    let mut known_scan_folders: HashMap<String, ScanFolderState> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT folder_path, dir_mtime FROM scan_folders")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ScanFolderState {
                    dir_mtime: row.get(1)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (folder_path, state) = row.map_err(|e| e.to_string())?;
        known_scan_folders.insert(folder_path, state);
    }
    Ok(known_scan_folders)
}

fn collect_fs_snapshot<F>(
    root_path: &str,
    known_scan_folders: &HashMap<String, ScanFolderState>,
    indexed_folders: &HashSet<String>,
    on_progress: &mut F,
) -> FsSnapshot
where
    F: FnMut(usize),
{
    let mut items_by_path: HashMap<String, ImageMeta> = HashMap::new();
    let mut items_by_date: HashMap<String, Vec<ImageMeta>> = HashMap::new();
    let mut encountered_date_folders: HashSet<String> = HashSet::new();
    let mut skipped_date_folders: HashSet<String> = HashSet::new();
    let mut scan_folder_metrics: HashMap<String, ScanFolderMetrics> = HashMap::new();
    let mut processed_files = 0usize;

    let mut walker = WalkDir::new(root_path).into_iter();
    while let Some(entry_result) = walker.next() {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if entry.file_type().is_dir() {
            if let Some(date_folder_path) = extract_date_folder_path(path) {
                if date_folder_path == path {
                    let folder_key = date_folder_path.to_string_lossy().to_string();
                    let dir_mtime = unix_mtime(path);
                    encountered_date_folders.insert(folder_key.clone());
                    if let Some(previous) = known_scan_folders.get(&folder_key) {
                        if previous.dir_mtime == dir_mtime
                            && indexed_folders.contains(&folder_key)
                        {
                            skipped_date_folders.insert(folder_key);
                            walker.skip_current_dir();
                            continue;
                        }
                    }
                    scan_folder_metrics.entry(folder_key).or_insert(ScanFolderMetrics {
                        file_count: 0,
                        max_serial: -1,
                        max_seed: -1,
                        dir_mtime,
                    });
                }
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        processed_files += 1;
        if processed_files % 500 == 0 {
            on_progress(processed_files);
        }
        let folder_key = extract_date_folder_path(path)
            .map(|folder| folder.to_string_lossy().to_string());
        if let Some(folder_key) = &folder_key {
            if skipped_date_folders.contains(folder_key) {
                continue;
            }
        }
        if let Some((serial, seed)) = parse_filename(path) {
            let date = match extract_date_from_path(path) {
                Some(d) => d,
                None => continue,
            };
            let path_str = path.to_string_lossy().to_string();
            let mtime = unix_mtime(path);
            let meta = ImageMeta {
                path: path_str.clone(),
                date: date.clone(),
                serial,
                seed,
                mtime,
            };
            items_by_path.insert(path_str.clone(), meta.clone());
            items_by_date.entry(date).or_default().push(meta);

            if let Some(folder_key) = folder_key {
                encountered_date_folders.insert(folder_key.clone());
                let metric = scan_folder_metrics
                    .entry(folder_key.clone())
                    .or_insert(ScanFolderMetrics {
                        file_count: 0,
                        max_serial: -1,
                        max_seed: -1,
                        dir_mtime: 0,
                    });
                metric.file_count += 1;
                if serial > metric.max_serial
                    || (serial == metric.max_serial && seed > metric.max_seed)
                {
                    metric.max_serial = serial;
                    metric.max_seed = seed;
                }
                if metric.dir_mtime == 0 {
                    metric.dir_mtime = unix_mtime(Path::new(&folder_key));
                }
            }
        }
    }
    on_progress(processed_files);

    FsSnapshot {
        items_by_path,
        items_by_date,
        encountered_date_folders,
        skipped_date_folders,
        scan_folder_metrics,
    }
}

fn load_db_items(conn: &Connection) -> Result<HashMap<String, DbImageRow>, String> {
    let mut db_items: HashMap<String, DbImageRow> = HashMap::new();
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
    Ok(db_items)
}

fn extract_indexed_folders(db_items: &HashMap<String, DbImageRow>) -> HashSet<String> {
    let mut indexed_folders = HashSet::new();
    for db_item in db_items.values() {
        if let Some(folder) = extract_date_folder_path(Path::new(&db_item.path)) {
            indexed_folders.insert(folder.to_string_lossy().to_string());
        }
    }
    indexed_folders
}

fn merge_skipped_folder_db_rows(snapshot: &mut FsSnapshot, db_items: &HashMap<String, DbImageRow>) {
    for db_item in db_items.values() {
        let is_in_skipped_folder = extract_date_folder_path(Path::new(&db_item.path))
            .map(|folder| {
                snapshot
                    .skipped_date_folders
                    .contains(&folder.to_string_lossy().to_string())
            })
            .unwrap_or(false);
        if !is_in_skipped_folder {
            continue;
        }
        let meta = ImageMeta {
            path: db_item.path.clone(),
            date: db_item.date.clone(),
            serial: db_item.serial,
            seed: db_item.seed,
            mtime: db_item.mtime,
        };
        snapshot.items_by_path.insert(db_item.path.clone(), meta.clone());
        snapshot
            .items_by_date
            .entry(db_item.date.clone())
            .or_default()
            .push(meta);
    }
}

fn compute_delta(
    items_by_path: &HashMap<String, ImageMeta>,
    db_items: &mut HashMap<String, DbImageRow>,
) -> Delta {
    let mut dates_changed: HashSet<String> = HashSet::new();
    let mut prompt_by_path: HashMap<String, Option<i64>> = HashMap::new();
    for (path, item) in items_by_path {
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
    for db_item in db_items.values() {
        dates_changed.insert(db_item.date.clone());
    }
    Delta {
        dates_changed,
        prompt_by_path,
    }
}

fn apply_delta(
    conn: &mut Connection,
    delta: &Delta,
    items_by_date: &HashMap<String, Vec<ImageMeta>>,
) -> Result<(), String> {
    if delta.dates_changed.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut sorted_dates: Vec<String> = delta.dates_changed.iter().cloned().collect();
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

            let prompt_id = delta.prompt_by_path.get(&item.path).and_then(|value| *value);
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
    tx.commit().map_err(|e| e.to_string())
}

fn upsert_scan_folder_state(
    conn: &mut Connection,
    scan_folder_metrics: HashMap<String, ScanFolderMetrics>,
    encountered_date_folders: HashSet<String>,
) -> Result<(), String> {
    if scan_folder_metrics.is_empty() && encountered_date_folders.is_empty() {
        return Ok(());
    }
    let scan_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (folder_path, metrics) in scan_folder_metrics {
        tx.execute(
            r#"
            INSERT INTO scan_folders (
                folder_path, last_scan_ts, file_count, max_serial, max_seed, dir_mtime, strategy
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(folder_path) DO UPDATE SET
                last_scan_ts = excluded.last_scan_ts,
                file_count = excluded.file_count,
                max_serial = excluded.max_serial,
                max_seed = excluded.max_seed,
                dir_mtime = excluded.dir_mtime,
                strategy = excluded.strategy
            "#,
            params![
                folder_path,
                scan_ts,
                metrics.file_count,
                metrics.max_serial,
                metrics.max_seed,
                metrics.dir_mtime,
                "full"
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut existing_folders_stmt = tx
        .prepare("SELECT folder_path FROM scan_folders")
        .map_err(|e| e.to_string())?;
    let existing_rows = existing_folders_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut to_remove = Vec::new();
    for row in existing_rows {
        let folder = row.map_err(|e| e.to_string())?;
        if !encountered_date_folders.contains(&folder) {
            to_remove.push(folder);
        }
    }
    drop(existing_folders_stmt);
    for folder in to_remove {
        tx.execute("DELETE FROM scan_folders WHERE folder_path = ?1", params![folder])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn load_scan_result(conn: &Connection) -> Result<ScanResult, String> {
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

fn build_index<F>(
    conn: &mut Connection,
    root_path: &str,
    on_progress: &mut F,
) -> Result<BuildIndexOutcome, String>
where
    F: FnMut(usize),
{
    let known_scan_folders = load_known_scan_folders(conn)?;
    let mut db_items = load_db_items(conn)?;
    let indexed_folders = extract_indexed_folders(&db_items);
    let mut scanned_files = 0usize;
    let mut snapshot = collect_fs_snapshot(
        root_path,
        &known_scan_folders,
        &indexed_folders,
        &mut |processed| {
        scanned_files = processed;
        on_progress(processed);
    });
    merge_skipped_folder_db_rows(&mut snapshot, &db_items);
    let delta = compute_delta(&snapshot.items_by_path, &mut db_items);
    apply_delta(conn, &delta, &snapshot.items_by_date)?;
    upsert_scan_folder_state(
        conn,
        snapshot.scan_folder_metrics,
        snapshot.encountered_date_folders,
    )?;
    Ok(BuildIndexOutcome {
        result: load_scan_result(conn)?,
        scanned_files,
    })
}

fn run_scan(app: AppHandle, root_path: String, scan_id: String) {
    emit_scan_progress(
        &app,
        ScanProgressEvent {
            scan_id: scan_id.clone(),
            stage: "counting".to_string(),
            message: "Counting files...".to_string(),
            processed: 0,
            total: 0,
            done: false,
            success: false,
            result: None,
        },
    );

    emit_scan_progress(
        &app,
        ScanProgressEvent {
            scan_id: scan_id.clone(),
            stage: "indexing".to_string(),
            message: "Indexing files...".to_string(),
            processed: 0,
            total: 0,
            done: false,
            success: false,
            result: None,
        },
    );

    let scan_result = (|| -> Result<BuildIndexOutcome, String> {
        let mut conn = open_db(&app, &root_path)?;
        init_db(&conn)?;
        let mut report = |processed: usize| {
            emit_scan_progress(
                &app,
                ScanProgressEvent {
                    scan_id: scan_id.clone(),
                    stage: "indexing".to_string(),
                    message: "Indexing files...".to_string(),
                    processed,
                    total: 0,
                    done: false,
                    success: false,
                    result: None,
                },
            );
        };
        let outcome = build_index(&mut conn, &root_path, &mut report)?;
        emit_scan_progress(
            &app,
            ScanProgressEvent {
                scan_id: scan_id.clone(),
                stage: "extracting_prompts".to_string(),
                message: "Extracting prompts...".to_string(),
                processed: 0,
                total: 0,
                done: false,
                success: false,
                result: None,
            },
        );
        extract_prompts_for_unparsed(&mut conn)?;
        Ok(outcome)
    })();

    match scan_result {
        Ok(outcome) => emit_scan_progress(
            &app,
            ScanProgressEvent {
                scan_id,
                stage: "done".to_string(),
                message: format!(
                    "Indexed {} images in {} groups.",
                    outcome.result.total_images, outcome.result.total_batches
                ),
                processed: outcome.scanned_files,
                total: outcome.scanned_files,
                done: true,
                success: true,
                result: Some(outcome.result),
            },
        ),
        Err(error) => emit_scan_progress(
            &app,
            ScanProgressEvent {
                scan_id,
                stage: "error".to_string(),
                message: format!("Scan failed: {}", error),
                processed: 0,
                total: 0,
                done: true,
                success: false,
                result: None,
            },
        ),
    }
}

#[tauri::command]
pub fn scan_directory(app: AppHandle, root_path: String) -> Result<ScanResult, String> {
    let mut conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    let mut noop_progress = |_: usize| {};
    let outcome = build_index(&mut conn, &root_path, &mut noop_progress)?;
    extract_prompts_for_unparsed(&mut conn)?;
    Ok(outcome.result)
}

#[tauri::command]
pub fn start_scan(
    app: AppHandle,
    root_path: String,
    scan_manager: State<ScanManager>,
) -> Result<ScanStartResponse, String> {
    let root_path = root_path.trim().to_string();
    if root_path.is_empty() {
        return Err("Please enter a root folder path.".to_string());
    }

    let scan_id = format!(
        "{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    );
    scan_manager.try_start(scan_id.clone())?;

    let app_clone = app.clone();
    let manager = scan_manager.inner().clone();
    let scan_id_for_task = scan_id.clone();
    let scan_id_for_error = scan_id.clone();
    tauri::async_runtime::spawn(async move {
        let run_result = tauri::async_runtime::spawn_blocking(move || {
            run_scan(app_clone, root_path, scan_id_for_task.clone());
            scan_id_for_task
        })
        .await;

        match run_result {
            Ok(done_id) => manager.finish(&done_id),
            Err(error) => {
                manager.finish(&scan_id_for_error);
                emit_scan_progress(
                    &app,
                    ScanProgressEvent {
                        scan_id: scan_id_for_error,
                        stage: "error".to_string(),
                        message: format!("Scan failed: {}", error),
                        processed: 0,
                        total: 0,
                        done: true,
                        success: false,
                        result: None,
                    },
                );
            }
        }
    });

    Ok(ScanStartResponse { scan_id })
}

#[cfg(test)]
mod tests {
    use super::{
        build_index, extract_date_folder_path, extract_date_from_path, parse_filename, unix_mtime,
    };
    use crate::db::init_db;
    use rusqlite::{params, Connection};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::fs::{self, File};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn create_test_root() -> PathBuf {
        let mut path = std::env::temp_dir();
        let counter = TEST_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed);
        let unique = format!(
            "promptlens-indexer-tests-{}-{}-{}",
            std::process::id(),
            counter,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos()
        );
        path.push(unique);
        fs::create_dir_all(&path).expect("failed to create test root");
        path
    }

    fn touch_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("failed to create parent directory");
        }
        File::create(path).expect("failed to create test file");
    }

    #[test]
    fn parse_filename_accepts_serial_seed_png() {
        let path = Path::new("00123-987654321.png");
        let parsed = parse_filename(path);
        assert_eq!(parsed, Some((123, 987654321)));
    }

    #[test]
    fn extract_date_from_path_uses_last_date_segment() {
        let path = Path::new("/tmp/2025-01-01/archive/2026-03-16/00001-1.png");
        let date = extract_date_from_path(path);
        assert_eq!(date.as_deref(), Some("2026-03-16"));
    }

    #[test]
    fn extract_date_folder_path_uses_last_date_segment_folder() {
        let path = Path::new("/tmp/2025-01-01/archive/2026-03-16/00001-1.png");
        let folder = extract_date_folder_path(path);
        let expected = Path::new("/tmp/2025-01-01/archive/2026-03-16");
        assert_eq!(folder.as_deref(), Some(expected));
    }

    #[test]
    fn build_index_splits_batches_on_sequence_break() {
        let root = create_test_root();
        let date_dir = root.join("images").join("2026-03-16");
        touch_file(&date_dir.join("00001-100.png"));
        touch_file(&date_dir.join("00002-101.png"));
        touch_file(&date_dir.join("00004-103.png"));

        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        let mut no_progress = |_: usize| {};

        let outcome =
            build_index(&mut conn, root.to_str().expect("non-utf8 temp path"), &mut no_progress)
        .expect("build_index failed");
        let result = outcome.result;

        assert_eq!(result.total_images, 3);
        assert_eq!(result.total_batches, 2);

        let mut stmt = conn
            .prepare(
                "SELECT first_serial, last_serial, first_seed, last_seed FROM batches ORDER BY id ASC",
            )
            .expect("failed to prepare query");
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .expect("failed to query batches");
        let batches: Vec<(i64, i64, i64, i64)> = rows
            .map(|row| row.expect("failed to parse row"))
            .collect();

        assert_eq!(batches, vec![(1, 2, 100, 101), (4, 4, 103, 103)]);

        let scan_folder_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scan_folders", [], |row| row.get(0))
            .expect("failed to query scan_folders count");
        assert_eq!(scan_folder_count, 1);

        fs::remove_dir_all(root).expect("failed to remove temp test root");
    }

    #[test]
    fn build_index_does_not_skip_without_indexed_rows_for_folder() {
        let root = create_test_root();
        let date_dir = root.join("images").join("2026-03-16");
        touch_file(&date_dir.join("00001-100.png"));
        touch_file(&date_dir.join("00002-101.png"));
        let dir_mtime = unix_mtime(&date_dir);

        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        conn.execute(
            "INSERT INTO scan_folders (folder_path, last_scan_ts, file_count, max_serial, max_seed, dir_mtime, strategy) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                date_dir.to_string_lossy().to_string(),
                1_i64,
                999_i64,
                999_i64,
                999_i64,
                dir_mtime,
                "full",
            ],
        )
        .expect("failed to seed scan_folders");

        let mut no_progress = |_: usize| {};
        build_index(&mut conn, root.to_str().expect("non-utf8 temp path"), &mut no_progress)
        .expect("build_index failed");

        let updated_file_count: i64 = conn
            .query_row(
                "SELECT file_count FROM scan_folders WHERE folder_path = ?1",
                params![date_dir.to_string_lossy().to_string()],
                |row| row.get(0),
            )
            .expect("failed to query updated scan_folders row");
        assert_eq!(updated_file_count, 2);

        fs::remove_dir_all(root).expect("failed to remove temp test root");
    }

    #[test]
    fn build_index_keeps_existing_images_when_folder_is_skipped() {
        let root = create_test_root();
        let date_dir = root.join("images").join("2026-03-16");
        touch_file(&date_dir.join("00001-100.png"));
        touch_file(&date_dir.join("00002-101.png"));

        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");

        let mut no_progress = |_: usize| {};
        build_index(&mut conn, root.to_str().expect("non-utf8 temp path"), &mut no_progress)
        .expect("initial build_index failed");

        let first_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .expect("failed to query first image count");
        assert_eq!(first_count, 2);

        build_index(&mut conn, root.to_str().expect("non-utf8 temp path"), &mut no_progress)
        .expect("second build_index failed");

        let second_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |row| row.get(0))
            .expect("failed to query second image count");
        assert_eq!(second_count, 2);

        fs::remove_dir_all(root).expect("failed to remove temp test root");
    }
}
