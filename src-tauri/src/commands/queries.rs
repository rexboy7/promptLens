use crate::db::{init_db, open_db};
use crate::types::{GroupItem, ImageItem};
use rusqlite::types::Value;
use tauri::AppHandle;

#[tauri::command]
pub fn list_groups(
    app: AppHandle,
    root_path: String,
    date_filter: Option<String>,
    search_text: Option<String>,
    group_mode: Option<String>,
) -> Result<Vec<GroupItem>, String> {
    let conn = open_db(&app, &root_path)?;
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

    let use_fts = search_fts.is_some();
    let fts_filter = if use_fts {
        "AND p.id IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?2)"
    } else {
        ""
    };

    if mode == "date" {
        let prompt_query = r#"
            SELECT
                'prompt' AS group_type,
                p.id AS group_id,
                p.text AS label,
                MAX(i.date) AS date,
                COUNT(i.id) AS size,
                MIN(i.path) AS representative_path,
                MAX(i.mtime) AS sort_mtime
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id
            "#
        .replace("{fts_where}", fts_filter);

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
                        MAX(i.date) AS date,
                        COUNT(i.id) AS size,
                        b.representative_path AS representative_path,
                        MAX(i.mtime) AS sort_mtime
                    FROM batches b
                    JOIN images i ON i.batch_id = b.id
                    WHERE i.prompt_id IS NULL
                      AND (?1 IS NULL OR i.date = ?1)
                      {batch_search}
                    GROUP BY b.id, b.date
                )
                ORDER BY date DESC, sort_mtime DESC, label DESC
                "#,
                    prompt_query,
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
                    id: format!(
                        "{}:{}",
                        if group_type == "prompt" { "p" } else { "b" },
                        group_id
                    ),
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
        return Ok(groups);
    }

    let (prompt_query, order_clause) = if mode == "score" {
        (
            r#"
            SELECT
                'prompt' AS group_type,
                p.id AS group_id,
                p.text AS label,
                MAX(i.date) AS date,
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
                MAX(i.date) AS date,
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
                id: format!(
                    "{}:{}",
                    if group_type == "prompt" { "p" } else { "b" },
                    group_id
                ),
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
pub fn list_images(
    app: AppHandle,
    root_path: String,
    group_id: String,
) -> Result<Vec<ImageItem>, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    let (group_type, raw_id) = group_id
        .split_once(':')
        .ok_or_else(|| "Invalid group id".to_string())?;
    let (query, params_vec): (&str, Vec<String>) = if group_type == "p" {
        ("WHERE prompt_id = ?1", vec![raw_id.to_string()])
    } else if group_type == "b" {
        ("WHERE batch_id = ?1", vec![raw_id.to_string()])
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
