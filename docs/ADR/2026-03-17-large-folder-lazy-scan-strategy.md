# ADR: Large-Folder Lazy Scan Strategy

Date: 2026-03-17
Status: Proposed

## Context
Current indexing is incremental at the database rebuild level (changed dates only), but each scan still walks the entire filesystem tree. With very large datasets, this full traversal is the dominant cost.

The requested behavior is to avoid rescanning existing files for very large folders and only ingest newly created images after the last scan.

## Decision
Introduce a folder-level lazy scan strategy with explicit assumptions, high-water marks, and safe fallbacks.

The strategy is:
- apply lazy scan only to folders above a threshold (default: `> 2000` files)
- ingest only new files in eligible folders using persisted scan state
- automatically fall back to full folder rescan when assumptions are violated

## Assumptions
Lazy scan is only considered safe if these hold:
- date-style folders (`YYYY-MM-DD`) are mostly append-only
- old folders are rarely edited, renamed, or deleted
- filenames remain parseable as `serial-seed.png`

If these assumptions are broken, fallback logic must restore correctness.

## Data Model
Add a new table (no behavior change without code path enabled):

`scan_folders`
- `folder_path TEXT PRIMARY KEY`
- `last_scan_ts INTEGER NOT NULL`
- `file_count INTEGER NOT NULL`
- `max_serial INTEGER`
- `max_seed INTEGER`
- `dir_mtime INTEGER`
- `strategy TEXT NOT NULL` (`full` | `lazy`)

Optional future table:
- `scan_events` for telemetry and debugging of fallback reasons

## Algorithm
1. Discover candidate folders under root.
2. For each folder:
- If file count is below threshold, use existing full scan behavior.
- If above threshold and folder has prior scan state, try lazy scan:
  - ingest files with `(serial, seed)` above saved high-water mark
  - update `scan_folders` state
3. Trigger full folder rescan when any guard fails:
- folder file count decreased
- directory mtime changed unexpectedly
- parse failures / sequence anomalies
- missing previous state
4. Continue using existing changed-date DB rebuild for correctness.

## Safety and Fallbacks
- Manual override: force full rescan from UI/menu.
- Automatic fallback: switch folder to `full` strategy for current run when checks fail.
- Optional periodic safety scan: full scan every N runs for lazy folders.

## Migration Strategy
Important current constraint:
- `DB_SCHEMA_VERSION` changes currently trigger destructive reset in `init_db`.

To avoid data loss (ratings/viewed/comparisons), migrate in two steps:
1. Implement non-destructive schema migration path in `db.rs`.
2. Add `scan_folders` table via migration.

Do not ship lazy scan before non-destructive migration is in place.

## Rollout Plan
Phase A:
- add table + write/read state (feature-flagged, off by default)

Phase B:
- enable lazy scan for very large folders only
- log fallback reasons

Phase C:
- tune threshold and fallback heuristics using observed scan timings

## Success Metrics
- scan time reduction for large roots
- unchanged correctness in group/image counts
- low fallback rate after warm-up

## Open Questions
- exact threshold: fixed (`2000`) vs configurable
- whether to scope lazy behavior only to older date folders
- whether to add filesystem watcher integration later
