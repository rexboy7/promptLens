use crate::db::{init_db, open_db};
use rusqlite::{params, params_from_iter};
use std::collections::HashMap;
use tauri::AppHandle;

const SQLITE_MAX_VARS: usize = 900;

fn parse_prompt_group_id(group_id: &str) -> Option<i64> {
    let (group_type, raw_id) = group_id.split_once(':')?;
    if group_type != "p" {
        return None;
    }
    raw_id.parse::<i64>().ok()
}

fn collect_prompt_signatures(
    conn: &rusqlite::Connection,
    prompt_ids: &[i64],
) -> Result<HashMap<String, String>, String> {
    let mut signatures = HashMap::new();
    if prompt_ids.is_empty() {
        return Ok(signatures);
    }

    for chunk in prompt_ids.chunks(SQLITE_MAX_VARS) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            r#"
            SELECT
                prompt_id,
                COUNT(*),
                COALESCE(MAX(mtime), 0),
                COALESCE(MIN(path), ''),
                COALESCE(MAX(path), '')
            FROM images
            WHERE prompt_id IN ({})
            GROUP BY prompt_id
            "#,
            placeholders
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter().copied()), |row| {
                let prompt_id: i64 = row.get(0)?;
                let count: i64 = row.get(1)?;
                let max_mtime: i64 = row.get(2)?;
                let min_path: String = row.get(3)?;
                let max_path: String = row.get(4)?;
                Ok((prompt_id, count, max_mtime, min_path, max_path))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (prompt_id, count, max_mtime, min_path, max_path) =
                row.map_err(|e| e.to_string())?;
            signatures.insert(
                format!("p:{prompt_id}"),
                format!("{count}:{max_mtime}:{min_path}:{max_path}"),
            );
        }
    }

    Ok(signatures)
}

fn load_stored_signatures(
    conn: &rusqlite::Connection,
    group_ids: &[String],
) -> Result<HashMap<String, String>, String> {
    let mut stored = HashMap::new();
    if group_ids.is_empty() {
        return Ok(stored);
    }

    for chunk in group_ids.chunks(SQLITE_MAX_VARS) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT group_id, signature FROM viewed_groups WHERE group_id IN ({})",
            placeholders
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter().cloned()), |row| {
                let group_id: String = row.get(0)?;
                let signature: String = row.get(1)?;
                Ok((group_id, signature))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (group_id, signature) = row.map_err(|e| e.to_string())?;
            stored.insert(group_id, signature);
        }
    }

    Ok(stored)
}

fn delete_viewed_rows(conn: &rusqlite::Connection, group_ids: &[String]) -> Result<(), String> {
    if group_ids.is_empty() {
        return Ok(());
    }

    for chunk in group_ids.chunks(SQLITE_MAX_VARS) {
        let placeholders = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("DELETE FROM viewed_groups WHERE group_id IN ({})", placeholders);
        conn.execute(&sql, params_from_iter(chunk.iter().cloned()))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn mark_group_viewed(
    app: AppHandle,
    root_path: String,
    group_id: String,
) -> Result<bool, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let prompt_id = match parse_prompt_group_id(&group_id) {
        Some(id) => id,
        None => return Ok(false),
    };
    let signatures = collect_prompt_signatures(&conn, &[prompt_id])?;
    let signature = match signatures.get(&group_id) {
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

    let prompt_groups: Vec<(String, i64)> = group_ids
        .into_iter()
        .filter_map(|group_id| parse_prompt_group_id(&group_id).map(|id| (group_id, id)))
        .collect();
    if prompt_groups.is_empty() {
        return Ok(Vec::new());
    }

    let prompt_ids: Vec<i64> = prompt_groups.iter().map(|(_, id)| *id).collect();
    let group_id_list: Vec<String> = prompt_groups
        .iter()
        .map(|(group_id, _)| group_id.clone())
        .collect();

    let signatures = collect_prompt_signatures(&conn, &prompt_ids)?;
    let stored_signatures = load_stored_signatures(&conn, &group_id_list)?;

    let mut viewed = Vec::new();
    let mut stale = Vec::new();
    for group_id in group_id_list {
        let current = signatures.get(&group_id);
        let stored = stored_signatures.get(&group_id);
        if current.is_some() && current == stored {
            viewed.push(group_id);
        } else if stored.is_some() {
            stale.push(group_id);
        }
    }

    delete_viewed_rows(&conn, &stale)?;

    Ok(viewed)
}
