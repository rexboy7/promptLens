use crate::db::{init_db, open_db};
use crate::types::RatingItem;
use rusqlite::params;
use tauri::AppHandle;

fn submit_comparison_with_conn(
    conn: &mut rusqlite::Connection,
    left_id: &str,
    right_id: &str,
    winner_id: &str,
) -> Result<bool, String> {
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
pub fn get_ratings(
    app: AppHandle,
    root_path: String,
    group_ids: Vec<String>,
) -> Result<Vec<RatingItem>, String> {
    let mut conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut lookup_ids: Vec<Option<String>> = Vec::with_capacity(group_ids.len());
    for id in &group_ids {
        let lookup = if id.starts_with("b:") || id.starts_with("d:") {
            lookup_ids.push(None);
            continue;
        } else {
            id.clone()
        };
        tx.execute(
            "INSERT OR IGNORE INTO ratings (group_id, rating, matches) VALUES (?1, 1000.0, 0)",
            params![lookup],
        )
        .map_err(|e| e.to_string())?;
        lookup_ids.push(Some(lookup));
    }
    tx.commit().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT group_id, rating, matches FROM ratings WHERE group_id = ?1")
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for (id, lookup) in group_ids.into_iter().zip(lookup_ids.into_iter()) {
        let Some(lookup) = lookup else { continue; };
        if let Ok(item) = stmt.query_row(params![lookup], |row| {
            Ok(RatingItem {
                group_id: id.clone(),
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
pub fn submit_comparison(
    app: AppHandle,
    root_path: String,
    left_id: String,
    right_id: String,
    winner_id: String,
) -> Result<bool, String> {
    let mut conn = open_db(&app, &root_path)?;
    init_db(&conn)?;
    submit_comparison_with_conn(&mut conn, &left_id, &right_id, &winner_id)
}

#[tauri::command]
pub fn set_group_rating(
    app: AppHandle,
    root_path: String,
    group_id: String,
    rating: f64,
) -> Result<bool, String> {
    let mut conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO ratings (group_id, rating, matches) VALUES (?1, 1000.0, 0)",
        params![group_id],
    )
    .map_err(|e| e.to_string())?;

    let matches: i64 = tx
        .query_row(
            "SELECT matches FROM ratings WHERE group_id = ?1",
            params![group_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let next_matches = if matches < 1 { 1 } else { matches };

    tx.execute(
        "UPDATE ratings SET rating = ?1, matches = ?2 WHERE group_id = ?3",
        params![rating, next_matches, group_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_rating_percentiles(
    app: AppHandle,
    root_path: String,
    percentiles: Vec<f64>,
) -> Result<Vec<f64>, String> {
    let conn = open_db(&app, &root_path)?;
    init_db(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT rating FROM ratings WHERE matches > 0 AND group_id LIKE 'p:%' ORDER BY rating ASC",
        )
        .map_err(|e| e.to_string())?;
    let ratings: Vec<f64> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|item| item.ok())
        .collect();

    if ratings.is_empty() {
        return Ok(vec![]);
    }

    let last_index = (ratings.len() - 1) as f64;
    let mut results = Vec::with_capacity(percentiles.len());
    for percentile in percentiles {
        let clamped = percentile.clamp(0.0, 1.0);
        let position = clamped * last_index;
        let lower = position.floor() as usize;
        let upper = (lower + 1).min(ratings.len() - 1);
        let weight = position - lower as f64;
        let value = ratings[lower] * (1.0 - weight) + ratings[upper] * weight;
        results.push(value);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::submit_comparison_with_conn;
    use crate::db::init_db;
    use rusqlite::{params, Connection};

    fn fetch_rating(conn: &Connection, group_id: &str) -> (f64, i64) {
        conn.query_row(
            "SELECT rating, matches FROM ratings WHERE group_id = ?1",
            params![group_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("failed to fetch rating row")
    }

    #[test]
    fn submit_comparison_winner_updates_ratings_and_matches() {
        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");

        submit_comparison_with_conn(&mut conn, "p:left", "p:right", "p:left")
            .expect("submit comparison failed");

        let (left_rating, left_matches) = fetch_rating(&conn, "p:left");
        let (right_rating, right_matches) = fetch_rating(&conn, "p:right");
        assert_eq!(left_rating, 1012.0);
        assert_eq!(right_rating, 988.0);
        assert_eq!(left_matches, 1);
        assert_eq!(right_matches, 1);

        let comparison_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM comparisons", [], |row| row.get(0))
            .expect("failed to count comparisons");
        assert_eq!(comparison_count, 1);
    }

    #[test]
    fn submit_comparison_both_good_applies_positive_bonus() {
        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");

        submit_comparison_with_conn(&mut conn, "p:left", "p:right", "both_good")
            .expect("submit comparison failed");

        let (left_rating, left_matches) = fetch_rating(&conn, "p:left");
        let (right_rating, right_matches) = fetch_rating(&conn, "p:right");
        assert_eq!(left_rating, 1004.0);
        assert_eq!(right_rating, 1004.0);
        assert_eq!(left_matches, 1);
        assert_eq!(right_matches, 1);
    }

    #[test]
    fn submit_comparison_both_bad_applies_negative_bonus() {
        let mut conn = Connection::open_in_memory().expect("failed to open sqlite in-memory db");
        init_db(&conn).expect("failed to initialize db");

        submit_comparison_with_conn(&mut conn, "p:left", "p:right", "both_bad")
            .expect("submit comparison failed");

        let (left_rating, left_matches) = fetch_rating(&conn, "p:left");
        let (right_rating, right_matches) = fetch_rating(&conn, "p:right");
        assert_eq!(left_rating, 996.0);
        assert_eq!(right_rating, 996.0);
        assert_eq!(left_matches, 1);
        assert_eq!(right_matches, 1);
    }
}
