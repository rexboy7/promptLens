use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FixBatchesResult {
    pub transitions: usize,
    pub moved: usize,
    pub renamed: usize,
}

#[tauri::command]
pub fn fix_batches(root_path: String) -> Result<FixBatchesResult, String> {
    let root = Path::new(root_path.trim());
    if !root.exists() {
        return Err("Root path does not exist".to_string());
    }

    let date_dirs = list_date_dirs(root)?;
    if date_dirs.len() < 2 {
        return Ok(FixBatchesResult {
            transitions: 0,
            moved: 0,
            renamed: 0,
        });
    }

    let mut transitions = 0usize;
    let mut moved = 0usize;
    let mut renamed = 0usize;

    for pair in date_dirs.windows(2) {
        let prev_dir = &pair[0];
        let next_dir = &pair[1];
        let info = match find_continuation(prev_dir, next_dir)? {
            Some(info) => info,
            None => continue,
        };

        let (moves, renames) = plan_moves(prev_dir, next_dir, &info);
        if moves.is_empty() && renames.is_empty() {
            continue;
        }

        apply_ops(&moves)?;
        apply_ops(&renames)?;

        transitions += 1;
        moved += moves.len();
        renamed += renames.len();
    }

    Ok(FixBatchesResult {
        transitions,
        moved,
        renamed,
    })
}

#[derive(Debug)]
struct ContinuationInfo {
    prev_last_seq: u32,
    cont: Vec<(PathBuf, u64, u32)>,
    next_items: Vec<(PathBuf, u32, u64)>,
}

fn list_date_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name,
            None => continue,
        };
        if is_date_dir(name) {
            dirs.push(path);
        }
    }
    dirs.sort();
    Ok(dirs)
}

fn is_date_dir(name: &str) -> bool {
    if name.len() != 10 {
        return false;
    }
    let bytes = name.as_bytes();
    for (idx, byte) in bytes.iter().enumerate() {
        match idx {
            4 | 7 => {
                if *byte != b'-' {
                    return false;
                }
            }
            _ => {
                if !byte.is_ascii_digit() {
                    return false;
                }
            }
        }
    }
    true
}

fn list_pngs(dir: &Path) -> Result<Vec<(PathBuf, u32, u64)>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(name) => name,
            None => continue,
        };
        if let Some((seq, seed)) = parse_file(name) {
            items.push((path, seq, seed));
        }
    }
    items.sort_by_key(|item| item.1);
    Ok(items)
}

fn parse_file(name: &str) -> Option<(u32, u64)> {
    let stem = name.strip_suffix(".png")?;
    let (seq_str, seed_str) = stem.split_once('-')?;
    if seq_str.len() != 5 || !seq_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if seed_str.is_empty() || !seed_str.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let seq = seq_str.parse::<u32>().ok()?;
    let seed = seed_str.parse::<u64>().ok()?;
    Some((seq, seed))
}

fn find_continuation(
    prev_dir: &Path,
    next_dir: &Path,
) -> Result<Option<ContinuationInfo>, String> {
    let prev_items = list_pngs(prev_dir)?;
    let next_items = list_pngs(next_dir)?;
    if prev_items.is_empty() || next_items.is_empty() {
        return Ok(None);
    }

    let (_, prev_last_seq, prev_last_seed) = prev_items[prev_items.len() - 1].clone();

    let mut next_by_seq: HashMap<u32, (PathBuf, u64)> = HashMap::new();
    for (path, seq, seed) in &next_items {
        next_by_seq.insert(*seq, (path.clone(), *seed));
    }

    if !next_by_seq.contains_key(&0) {
        return Ok(None);
    }

    let mut cont = Vec::new();
    let mut expected_seed = prev_last_seed + 1;
    let mut seq = 0u32;
    loop {
        let item = match next_by_seq.get(&seq) {
            Some(item) => item,
            None => break,
        };
        let (path, seed) = item;
        if *seed != expected_seed {
            break;
        }
        cont.push((path.clone(), *seed, seq));
        expected_seed += 1;
        seq += 1;
    }

    if cont.is_empty() {
        return Ok(None);
    }

    Ok(Some(ContinuationInfo {
        prev_last_seq,
        cont,
        next_items,
    }))
}

fn plan_moves(
    prev_dir: &Path,
    next_dir: &Path,
    info: &ContinuationInfo,
) -> (Vec<(PathBuf, PathBuf)>, Vec<(PathBuf, PathBuf)>) {
    let mut moves = Vec::new();
    let mut new_seq = info.prev_last_seq + 1;
    for (path, seed, _old_seq) in &info.cont {
        let new_name = format!("{:05}-{}.png", new_seq, seed);
        moves.push((path.clone(), prev_dir.join(new_name)));
        new_seq += 1;
    }

    let cont_count = info.cont.len() as u32;
    let mut remaining: Vec<(PathBuf, u32, u64)> = info
        .next_items
        .iter()
        .filter(|(_, seq, _)| *seq >= cont_count)
        .cloned()
        .collect();
    remaining.sort_by_key(|item| item.1);

    let mut renames = Vec::new();
    let mut new_seq = 0u32;
    for (path, _seq, seed) in remaining {
        let new_name = format!("{:05}-{}.png", new_seq, seed);
        renames.push((path, next_dir.join(new_name)));
        new_seq += 1;
    }

    (moves, renames)
}

fn apply_ops(ops: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut targets = HashSet::new();
    for (_, dst) in ops {
        if !targets.insert(dst.clone()) {
            return Err("Plan has duplicate targets; aborting.".to_string());
        }
    }

    for (src, dst) in ops {
        if src == dst {
            continue;
        }
        if dst.exists() {
            return Err(format!(
                "Refusing to overwrite existing file: {}",
                dst.display()
            ));
        }
    }

    for (src, dst) in ops {
        if src == dst {
            continue;
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::rename(src, dst).map_err(|err| err.to_string())?;
    }

    Ok(())
}
