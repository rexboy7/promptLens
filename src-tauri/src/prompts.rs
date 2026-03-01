use rusqlite::{params, Connection};
use std::fs;
use std::io::Read;
use std::path::Path;

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

pub fn extract_prompts_for_unparsed(conn: &mut Connection) -> Result<(), String> {
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

    if rows.is_empty() {
        return Ok(());
    }

    let mut updates: Vec<(i64, String)> = Vec::new();
    for (image_id, path) in rows {
        if let Some(prompt) = extract_parameters_from_png(Path::new(&path)) {
            let positive = extract_positive_prompt(&prompt);
            if !positive.is_empty() {
                updates.push((image_id, positive));
            }
        }
    }

    if updates.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
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
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
