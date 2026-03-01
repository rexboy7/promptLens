use crate::db::{init_db, open_db};
use rusqlite::{params, Connection};
use std::fs;
use tauri::AppHandle;

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
pub fn delete_image(app: AppHandle, root_path: String, image_path: String) -> Result<bool, String> {
    let mut conn = open_db(&app, &root_path)?;
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
pub fn delete_group(app: AppHandle, root_path: String, group_id: String) -> Result<usize, String> {
    let mut conn = open_db(&app, &root_path)?;
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
