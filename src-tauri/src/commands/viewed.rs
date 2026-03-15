use crate::db::{init_db, open_db};
use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

fn parse_group_id(group_id: &str) -> Result<(&str, &str), String> {
    group_id
        .split_once(':')
        .ok_or_else(|| "Invalid group id".to_string())
}

fn group_signature(conn: &rusqlite::Connection, group_id: &str) -> Result<Option<String>, String> {
    let (group_type, raw_id) = parse_group_id(group_id)?;

    let (count, max_mtime, min_path, max_path): (i64, i64, String, String) = match group_type {
        "p" => conn
            .query_row(
                r#"
                SELECT
                    COUNT(*),
                    COALESCE(MAX(mtime), 0),
                    COALESCE(MIN(path), ''),
                    COALESCE(MAX(path), '')
                FROM images
                WHERE prompt_id = ?1
                "#,
                params![raw_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| e.to_string())?,
        "b" => conn
            .query_row(
                r#"
                SELECT
                    COUNT(*),
                    COALESCE(MAX(mtime), 0),
                    COALESCE(MIN(path), ''),
                    COALESCE(MAX(path), '')
                FROM images
                WHERE batch_id = ?1
                "#,
                params![raw_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| e.to_string())?,
        "d" => conn
            .query_row(
                r#"
                SELECT
                    COUNT(*),
                    COALESCE(MAX(mtime), 0),
                    COALESCE(MIN(path), ''),
                    COALESCE(MAX(path), '')
                FROM images
                WHERE date = ?1
                "#,
                params![raw_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| e.to_string())?,
        _ => return Err("Unknown group id type".to_string()),
    };

    if count == 0 {
        return Ok(None);
    }

    Ok(Some(format!(
        "{}:{}:{}:{}",
        count, max_mtime, min_path, max_path
    )))
}

#[tauri::command]
pub fn mark_group_viewed(
    app: AppHandle,
    root_path: String,
    group_id: String,
) -> Result<bool, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let signature = match group_signature(&conn, &group_id)? {
        Some(value) => value,
        None => return Ok(false),
    };

    conn.execute(
        r#"
        INSERT INTO viewed_groups (group_id, signature, viewed_at)
        VALUES (?1, ?2, strftime('%s','now'))
        ON CONFLICT(group_id)
        DO UPDATE SET signature = excluded.signature, viewed_at = excluded.viewed_at
        "#,
        params![group_id, signature],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn mark_group_unviewed(
    app: AppHandle,
    root_path: String,
    group_id: String,
) -> Result<bool, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    conn.execute(
        "DELETE FROM viewed_groups WHERE group_id = ?1",
        params![group_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn list_viewed_group_ids(
    app: AppHandle,
    root_path: String,
    group_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let mut viewed = Vec::new();

    for group_id in group_ids {
        let current_signature = match group_signature(&conn, &group_id)? {
            Some(value) => value,
            None => {
                conn.execute(
                    "DELETE FROM viewed_groups WHERE group_id = ?1",
                    params![group_id],
                )
                .map_err(|e| e.to_string())?;
                continue;
            }
        };

        let stored_signature: Option<String> = conn
            .query_row(
                "SELECT signature FROM viewed_groups WHERE group_id = ?1",
                params![group_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if stored_signature.as_deref() == Some(current_signature.as_str()) {
            viewed.push(group_id);
        } else if stored_signature.is_some() {
            conn.execute(
                "DELETE FROM viewed_groups WHERE group_id = ?1",
                params![group_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(viewed)
}
