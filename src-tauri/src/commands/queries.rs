use crate::db::{init_db, open_db};
use crate::types::{GroupItem, ImageItem};
use rusqlite::Connection;
use rusqlite::types::Value;
use tauri::AppHandle;

fn list_groups_with_conn(
    conn: &Connection,
    date_filter: Option<String>,
    search_text: Option<String>,
    min_size: Option<i64>,
    max_size: Option<i64>,
    group_mode: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<GroupItem>, String> {
    let mode = group_mode.unwrap_or_else(|| "prompt".to_string());
    let min_group_size = min_size.unwrap_or(1).max(1);
    let max_group_size = max_size.filter(|value| *value > 0).unwrap_or(i64::MAX);
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
    let min_size_param = if use_fts {
        "?4"
    } else if search.is_some() {
        "?3"
    } else {
        "?2"
    };
    let max_size_param = if use_fts {
        "?5"
    } else if search.is_some() {
        "?4"
    } else {
        "?3"
    };
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
            HAVING COUNT(i.id) >= {min_size_param}
               AND COUNT(i.id) <= {max_size_param}
            "#
        .replace("{fts_where}", fts_filter)
        .replace("{min_size_param}", min_size_param)
        .replace("{max_size_param}", max_size_param);

        let date_like_param = if use_fts { "?3" } else { "?2" };
        let batch_search_clause = if search.is_some() {
            format!("AND LOWER(b.date) LIKE {}", date_like_param)
        } else {
            String::new()
        };

        let mut query = format!(
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
                    HAVING COUNT(i.id) >= {min_size_param}
                       AND COUNT(i.id) <= {max_size_param}
                )
                ORDER BY date DESC, sort_mtime DESC, label DESC
                "#,
            prompt_query,
            batch_search = batch_search_clause,
            min_size_param = min_size_param,
            max_size_param = max_size_param
        );

        let date_value = date_filter
            .as_ref()
            .map(|value| Value::from(value.clone()))
            .unwrap_or(Value::Null);
        let mut params_vec = if search.is_none() {
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
        params_vec.push(Value::from(min_group_size));
        params_vec.push(Value::from(max_group_size));
        if let Some(limit_value) = limit {
            let offset_value = offset.unwrap_or(0).max(0);
            let limit_param_index = params_vec.len() + 1;
            let offset_param_index = params_vec.len() + 2;
            query.push_str(&format!(
                " LIMIT ?{} OFFSET ?{}",
                limit_param_index, offset_param_index
            ));
            params_vec.push(Value::from(limit_value.max(0)));
            params_vec.push(Value::from(offset_value));
        }

        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

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
            HAVING COUNT(i.id) >= {min_size_param}
               AND COUNT(i.id) <= {max_size_param}
            "#
            .replace("{fts_where}", fts_filter)
            .replace("{min_size_param}", min_size_param)
            .replace("{max_size_param}", max_size_param),
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
            HAVING COUNT(i.id) >= {min_size_param}
               AND COUNT(i.id) <= {max_size_param}
            "#
            .replace("{fts_where}", fts_filter)
            .replace("{min_size_param}", min_size_param)
            .replace("{max_size_param}", max_size_param),
            "ORDER BY group_type ASC, label DESC".to_string(),
        )
    };

    let date_like_param = if use_fts { "?3" } else { "?2" };
    let batch_search_clause = if search.is_some() {
        format!("AND LOWER(b.date) LIKE {}", date_like_param)
    } else {
        String::new()
    };
    let mut query = format!(
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
                HAVING COUNT(i.id) >= {min_size_param}
                   AND COUNT(i.id) <= {max_size_param}
            )
            {}
            "#,
        prompt_query,
        order_clause,
        batch_search = batch_search_clause,
        min_size_param = min_size_param,
        max_size_param = max_size_param
    );

    let date_value = date_filter
        .as_ref()
        .map(|value| Value::from(value.clone()))
        .unwrap_or(Value::Null);
    let mut params_vec = if search.is_none() {
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
    params_vec.push(Value::from(min_group_size));
    params_vec.push(Value::from(max_group_size));
    if let Some(limit_value) = limit {
        let offset_value = offset.unwrap_or(0).max(0);
        let limit_param_index = params_vec.len() + 1;
        let offset_param_index = params_vec.len() + 2;
        query.push_str(&format!(
            " LIMIT ?{} OFFSET ?{}",
            limit_param_index, offset_param_index
        ));
        params_vec.push(Value::from(limit_value.max(0)));
        params_vec.push(Value::from(offset_value));
    }

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

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
pub fn list_groups(
    app: AppHandle,
    root_path: String,
    date_filter: Option<String>,
    search_text: Option<String>,
    min_size: Option<i64>,
    max_size: Option<i64>,
    group_mode: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<GroupItem>, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    list_groups_with_conn(
        &conn,
        date_filter,
        search_text,
        min_size,
        max_size,
        group_mode,
        limit,
        offset,
    )
}

fn count_groups_with_conn(
    conn: &Connection,
    date_filter: Option<String>,
    search_text: Option<String>,
    min_size: Option<i64>,
    max_size: Option<i64>,
    group_mode: Option<String>,
) -> Result<i64, String> {
    let mode = group_mode.unwrap_or_else(|| "prompt".to_string());
    let min_group_size = min_size.unwrap_or(1).max(1);
    let max_group_size = max_size.filter(|value| *value > 0).unwrap_or(i64::MAX);
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
    let min_size_param = if use_fts {
        "?4"
    } else if search.is_some() {
        "?3"
    } else {
        "?2"
    };
    let max_size_param = if use_fts {
        "?5"
    } else if search.is_some() {
        "?4"
    } else {
        "?3"
    };
    let fts_filter = if use_fts {
        "AND p.id IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?2)"
    } else {
        ""
    };
    let date_like_param = if use_fts { "?3" } else { "?2" };
    let batch_search_clause = if search.is_some() {
        format!("AND LOWER(b.date) LIKE {}", date_like_param)
    } else {
        String::new()
    };

    let prompt_query = if mode == "date" {
        r#"
            SELECT p.id AS group_id
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id
            HAVING COUNT(i.id) >= {min_size_param}
               AND COUNT(i.id) <= {max_size_param}
        "#
    } else {
        r#"
            SELECT p.id AS group_id
            FROM prompts p
            JOIN images i ON i.prompt_id = p.id
            WHERE (?1 IS NULL OR i.date = ?1)
              {fts_where}
            GROUP BY p.id
            HAVING COUNT(i.id) >= {min_size_param}
               AND COUNT(i.id) <= {max_size_param}
        "#
    }
    .replace("{fts_where}", fts_filter)
    .replace("{min_size_param}", min_size_param)
    .replace("{max_size_param}", max_size_param);

    let query = format!(
        r#"
            SELECT COUNT(*)
            FROM (
                {}
                UNION ALL
                SELECT b.id AS group_id
                FROM batches b
                JOIN images i ON i.batch_id = b.id
                WHERE i.prompt_id IS NULL
                  AND (?1 IS NULL OR i.date = ?1)
                  {batch_search}
                GROUP BY b.id
                HAVING COUNT(i.id) >= {min_size_param}
                   AND COUNT(i.id) <= {max_size_param}
            ) AS grouped
        "#,
        prompt_query,
        batch_search = batch_search_clause,
        min_size_param = min_size_param,
        max_size_param = max_size_param
    );

    let date_value = date_filter
        .as_ref()
        .map(|value| Value::from(value.clone()))
        .unwrap_or(Value::Null);
    let mut params_vec = if search.is_none() {
        vec![date_value]
    } else if use_fts {
        vec![
            date_value,
            Value::from(search_fts.unwrap_or_default()),
            Value::from(search_like),
        ]
    } else {
        vec![date_value, Value::from(search_like)]
    };
    params_vec.push(Value::from(min_group_size));
    params_vec.push(Value::from(max_group_size));

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let count = stmt
        .query_row(rusqlite::params_from_iter(params_vec), |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn count_groups(
    app: AppHandle,
    root_path: String,
    date_filter: Option<String>,
    search_text: Option<String>,
    min_size: Option<i64>,
    max_size: Option<i64>,
    group_mode: Option<String>,
) -> Result<i64, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    count_groups_with_conn(&conn, date_filter, search_text, min_size, max_size, group_mode)
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

#[cfg(test)]
mod tests {
    use super::{count_groups_with_conn, list_groups_with_conn};
    use crate::db::init_db;
    use rusqlite::{params, Connection};

    fn seed_groups(conn: &Connection) {
        conn.execute("INSERT INTO prompts (text) VALUES (?1)", params!["p-one"])
            .expect("failed to insert prompt one");
        conn.execute("INSERT INTO prompts (text) VALUES (?1)", params!["p-two"])
            .expect("failed to insert prompt two");
        conn.execute(
            "INSERT OR REPLACE INTO prompts_fts (rowid, text) VALUES (?1, ?2)",
            params![1_i64, "p-one"],
        )
        .expect("failed to insert prompt one fts");
        conn.execute(
            "INSERT OR REPLACE INTO prompts_fts (rowid, text) VALUES (?1, ?2)",
            params![2_i64, "p-two"],
        )
        .expect("failed to insert prompt two fts");

        conn.execute(
            "INSERT INTO batches (date, first_serial, last_serial, first_seed, last_seed, representative_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["2026-03-17", 1_i64, 2_i64, 100_i64, 101_i64, "/tmp/prompt-batch.png"],
        )
        .expect("failed to insert prompt batch");
        let prompt_batch_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO batches (date, first_serial, last_serial, first_seed, last_seed, representative_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["2026-03-16", 10_i64, 12_i64, 200_i64, 202_i64, "/tmp/unprompted-large.png"],
        )
        .expect("failed to insert unprompted large batch");
        let unprompted_large_batch_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO batches (date, first_serial, last_serial, first_seed, last_seed, representative_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["2026-03-15", 20_i64, 20_i64, 300_i64, 300_i64, "/tmp/unprompted-small.png"],
        )
        .expect("failed to insert unprompted small batch");
        let unprompted_small_batch_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["/tmp/p1-1.png", "2026-03-17", 1_i64, 100_i64, prompt_batch_id, 1_i64, 1_i64],
        )
        .expect("failed to insert p1 image one");
        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["/tmp/p1-2.png", "2026-03-17", 2_i64, 101_i64, prompt_batch_id, 1_i64, 1_i64],
        )
        .expect("failed to insert p1 image two");
        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["/tmp/p2-1.png", "2026-03-17", 3_i64, 102_i64, prompt_batch_id, 1_i64, 2_i64],
        )
        .expect("failed to insert p2 image one");

        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params!["/tmp/u-large-1.png", "2026-03-16", 10_i64, 200_i64, unprompted_large_batch_id, 1_i64],
        )
        .expect("failed to insert unprompted large image one");
        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params!["/tmp/u-large-2.png", "2026-03-16", 11_i64, 201_i64, unprompted_large_batch_id, 1_i64],
        )
        .expect("failed to insert unprompted large image two");
        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params!["/tmp/u-large-3.png", "2026-03-16", 12_i64, 202_i64, unprompted_large_batch_id, 1_i64],
        )
        .expect("failed to insert unprompted large image three");
        conn.execute(
            "INSERT INTO images (path, date, serial, seed, batch_id, mtime, prompt_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params!["/tmp/u-small-1.png", "2026-03-15", 20_i64, 300_i64, unprompted_small_batch_id, 1_i64],
        )
        .expect("failed to insert unprompted small image");
    }

    #[test]
    fn min_size_filters_list_groups_results() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        seed_groups(&conn);

        let groups = list_groups_with_conn(
            &conn,
            None,
            None,
            Some(2),
            None,
            Some("prompt".to_string()),
            None,
            None,
        )
        .expect("list_groups_with_conn failed");

        assert_eq!(groups.len(), 2);
        assert!(groups.iter().all(|group| group.size >= 2));
        assert!(groups.iter().any(|group| group.id == "p:1"));
        assert!(groups.iter().any(|group| group.id.starts_with("b:")));
    }

    #[test]
    fn min_size_filters_count_groups_results() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        seed_groups(&conn);

        let all_count = count_groups_with_conn(
            &conn,
            None,
            None,
            Some(1),
            None,
            Some("prompt".to_string()),
        )
        .expect("count_groups_with_conn failed for min size 1");
        let filtered_count = count_groups_with_conn(
            &conn,
            None,
            None,
            Some(2),
            None,
            Some("prompt".to_string()),
        )
        .expect("count_groups_with_conn failed for min size 2");

        assert_eq!(all_count, 4);
        assert_eq!(filtered_count, 2);
    }

    #[test]
    fn max_size_filters_list_groups_results() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        seed_groups(&conn);

        let groups = list_groups_with_conn(
            &conn,
            None,
            None,
            Some(1),
            Some(2),
            Some("prompt".to_string()),
            None,
            None,
        )
        .expect("list_groups_with_conn failed");

        assert_eq!(groups.len(), 3);
        assert!(groups.iter().all(|group| group.size <= 2));
        assert!(!groups.iter().any(|group| group.size > 2));
    }

    #[test]
    fn max_size_filters_count_groups_results() {
        let conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");
        seed_groups(&conn);

        let count = count_groups_with_conn(
            &conn,
            None,
            None,
            Some(1),
            Some(2),
            Some("prompt".to_string()),
        )
        .expect("count_groups_with_conn failed for max size 2");

        assert_eq!(count, 3);
    }
}
