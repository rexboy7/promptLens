# AI Image Viewer Plan

Date: 2026-02-17
Owner: You

## Goal
Build a local-first image viewer optimized for AI-generated images. It should:
- Group images by prompt (when metadata is available).
- Fall back to fast filename-based grouping to avoid slow metadata scans.
- Provide a left panel of groups with a thumbnail representative.
- Provide a right panel grid of images for the selected group.
- Support search and filtering by prompt keywords and date folders.
- Support keyboard navigation within a group and between groups.

## Assumptions
- Images live in date-named folders like `YYYY-MM-DD/NNNNN-SEED.png`.
- Automatic1111 metadata stores prompt in PNG `parameters` text chunk.
- Initial performance is prioritized over immediate metadata extraction.

## Recommended Stack (adjustable)
- Desktop app to access local filesystem without browser limitations.
- UI: React (or similar), split-pane layout.
- Backend: Tauri (Rust) or Electron (Node).
- Index storage: SQLite (fast search + persistence). JSON is a simpler fallback.

## Phased Roadmap

### Phase 1 — Fast Index + Filename Grouping (MVP)
Goal: Usable viewer without metadata parsing.
- Scan root folder recursively.
- Parse `date` from folder name (`YYYY-MM-DD`).
- Parse filename `serial` and `seed` from `<serial>-<seed>.png`.
- Define a batch/group as consecutive serial and consecutive seed.
- Build index with:
  - `image_id`, `path`, `date`, `serial`, `seed`, `batch_id`, `thumb_path`.
- UI:
  - Left list shows each group with one thumbnail.
  - Right grid shows images in selected group.
  - Keyboard: prev/next image, prev/next group.

### Phase 2 — Metadata Extraction (Prompt Grouping)
Goal: Enrich index in background.
- Background task to read PNG `parameters` chunk.
- Parse prompt text and store in index.
- Grouping strategy:
  - If prompt known: `group_key = prompt_hash`.
  - Else: `group_key = batch_id`.
- UI shows truncated prompt on hover or in details panel.

### Phase 3 — Search + Filters
Goal: Discoverability.
- Keyword search on prompt text (case-insensitive).
- Date filter (single date or range) using folder name.
- Optional filters: `prompt_known`, `model_name` (if available).

### Phase 4 — Quality-of-Life
Goal: Smooth browsing.
- Lazy-loading thumbnails.
- File watcher for incremental updates (optional).
- Prefetch next/prev group thumbnails.

## Data Model (SQLite)
Tables:
- `images`:
  - `id`, `path`, `date`, `serial`, `seed`, `batch_id`, `prompt_id`, `thumb_path`, `mtime`
- `prompts`:
  - `id`, `text`, `hash`
- `groups` (optional materialized view):
  - `id`, `group_key`, `group_type`, `representative_image_id`

Indices:
- `images(path)` unique
- `images(date)`
- `images(batch_id)`
- `prompts(hash)` unique
- `prompts(text)` for search (or FTS)

## Grouping Logic (Filename)
- Sort images by serial.
- Start a new batch when:
  - `serial` is not previous + 1, OR
  - `seed` is not previous + 1.

## Performance Strategy
- Cache index, reuse on startup.
- Only rescan changed folders (compare mtime).
- Defer metadata scan to background.

## UI/UX Notes
- Left panel: list of groups with thumbnail + short prompt or batch label.
- Right panel: responsive grid.
- Detail view: selected image fits viewport, keyboard nav enabled.

## Risks
- Metadata parsing speed (mitigated by background task).
- Large folders (mitigated by lazy thumbnails and cached index).

## Open Decisions
1. Platform: Tauri vs Electron vs native (Swift/Qt).
2. Storage: SQLite vs JSON.
3. Grouping preference: prompt-first vs batch-first (when prompt known).

## Next Steps
1. Confirm platform + storage.
2. Define project skeleton.
3. Implement Phase 1 scanner + UI layout.
