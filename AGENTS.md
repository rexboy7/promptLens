# AGENTS.md

## Purpose
This document is the onboarding and working guide for the PromptGallery codebase.
It is intended for engineers new to the project and for AI coding agents.
It explains product intent, architecture, data model, core flows, conventions,
and the exact places in the code you should touch for common tasks.

The repository is a Tauri + React desktop application for browsing AI-generated
images at scale, using prompts and filenames to group, filter, and rank images
with a fast, keyboard-first workflow.

If you are joining the project, read this file end-to-end once, then use the
sections as a map for changes and bugfixes.

---

## Product Goals
- Handle large image libraries from AI image generators.
- Group by prompt (from PNG metadata) or by filename batches.
- Provide fast keyboard navigation and filtering.
- Support ranking between groups with an Elo-based system.
- Keep the application lightweight and offline.
- Avoid expensive rescans by using incremental indexing.

---

## High-Level Architecture
- **Frontend**: React, TypeScript, Vite.
- **Backend**: Tauri (Rust) for filesystem access, SQLite, and native menus.
- **Database**: SQLite stored via Tauri backend; accessed through commands.
- **State**: React hooks + context; data-layer functions call Tauri commands.

Major layers:
1. **UI components** (`src/components/*`)
2. **Controller hooks** (`src/app/*`)
3. **Data access** (`src/data/*`)
4. **Backend commands** (`src-tauri/src/lib.rs`)

---

## Quick Start (Dev)
- Install deps: `pnpm install`
- Run app: `pnpm tauri dev`

Note: Tauri requires Rust toolchain set up. If you see Rust errors, rebuild.

---

## Key Concepts

### 1) Image grouping
Images can be grouped by:
- Prompt only (`prompt`)
- Prompt + Date (`prompt_date`)
- Date + Prompt (`date_prompt`)
- Date only (`date`)
- Score (`score`, sorted by rating)
- Batch (fallback when no prompt)

### 2) Prompt extraction
- PNG metadata stores parameters under tEXt/iTXt key `parameters`.
- Only the **positive prompt** is stored.
- Anything after `Negative prompt:` is discarded.

### 3) Batch grouping (filename-based)
- Filenames are `serial-seed.png` (e.g., `01498-4109833704.png`).
- A new batch starts if serial or seed sequence breaks.
- Date is inferred from path segments like `YYYY-MM-DD`.

### 4) Ranking
- Elo style comparisons across groups.
- Two modes:
  - Pair: two groups, two images each (4 total).
  - Sequential: current full-screen + previous preview.
- Ratings are stored only for prompt groups (`p:`). Prompt-date groups (`pd:`) read from prompt ratings.
- Batch (`b:`) and date (`d:`) groups are excluded from ratings.

---

## Repository Map

### Frontend
- `src/App.tsx`:
  - Application layout and providers.
  - Renders toolbar, filters, group list, grid, viewer, ranking overlay.

- `src/App.css`:
  - Global layout and shared styling.
  - Group list, image grid, viewer, filters.

- `src/components/Toolbar.tsx`:
  - Top header toolbar with icon-only buttons.
  - Uses controller actions (scan, ranking, random, slideshow, delete).

- `src/components/Filters/Filters.tsx`:
  - Search, date filter, group mode selection.

- `src/components/GroupList/GroupList.tsx`:
  - Left pane with group thumbnails + metadata.
  - Shows score and matches if available.

- `src/components/ImageGrid/ImageGrid.tsx`:
  - Right pane grid of images for selected group.

- `src/components/Viewer/Viewer.tsx`:
  - Fullscreen image viewer.
  - Fullscreen toggles and metadata panel.

- `src/components/ImageMeta.tsx`:
  - Displays serial, date, prompt.

- `src/components/RankingPanel/RankingPanel.tsx`:
  - Ranking overlay UI, hotkeys, swap buttons, sequential preview.

- `src/components/RankingPanel/RankingPanel.css`:
  - Ranking overlay styling.

### State and Controllers
- `src/app/useGalleryController.ts`:
  - Core app controller: groups, images, selection, viewer, filters, root path.
  - Integrates ranking controller via `useRankingController(groups)`.
  - Handles recent roots, scanning, keyboard and menu events.

- `src/app/useRankingController.ts`:
  - Ranking logic: pairing, sequential selection, Elo submissions.
  - Maintains `ratingByGroupId` cache.
  - Tiered sampling to interleave new and older groups.

- `src/app/GalleryContext.tsx`:
  - Provides controller state/actions via `useGallery()`.

- `src/app/commands.ts`:
  - Defines command types for keyboard/menu dispatch.

- `src/hooks/useKeyboard.ts`:
  - Global keyboard shortcuts.

- `src/hooks/useMenuEvents.ts`:
  - Listens to Tauri menu events.

### Data Layer
- `src/data/galleryApi.ts`:
  - `invoke` wrappers for backend commands.

- `src/data/types.ts`:
  - Shared types (Group, GroupMode, RankingPair, RankingSequence, etc.)

### Backend
- `src-tauri/src/lib.rs`:
  - SQLite schema and migrations.
  - Tauri commands (scan, list groups, list images, delete, ranking).
  - PNG metadata parsing and prompt extraction.
  - Incremental scan logic.

- `src-tauri/tauri.conf.json`:
  - Title bar, window, and asset access configuration.

---

## Database Schema (SQLite)

Tables:
- `prompts`:
  - `id`, `text`
  - Unique prompt text

- `prompts_fts` (FTS5)
  - full-text search over `prompts`

- `batches`:
  - `id`, `date`, `first_serial`, `last_serial`, `first_seed`, `last_seed`,
    `representative_path`

- `images`:
  - `id`, `path`, `date`, `serial`, `seed`, `batch_id`, `mtime`, `prompt_id`

- `ratings`:
  - `group_id` (string key), `rating`, `matches`

- `comparisons`:
  - `id`, `group_a`, `group_b`, `winner`, `ts`

Group id encoding:
- Prompt: `p:<id>`
- Batch: `b:<id>`
- Date: `d:<YYYY-MM-DD>`
- Prompt+Date or Date+Prompt: `pd:<prompt_id>:<date>`

Notes:
- Ratings use group IDs, so they are stable across runs.
- `score` mode ordering uses ratings in SQL.

---

## Scanning and Indexing

### Current behavior (incremental)
- Walk filesystem under root path.
- Collect `path`, `date`, `serial`, `seed`, `mtime`.
- Compare against DB by `path` and `mtime`.
- Track **changed dates** only (new, updated, deleted).
- For each changed date:
  - delete images + batches for that date
  - rebuild batches and images for that date only

### Why it matters
- Avoids full rebuilds on each scan.
- Keeps prompts and ratings stable.
- Significantly faster on large libraries.

### Key function
- `build_index(conn, root_path)` in `src-tauri/src/lib.rs`

---

## Prompt Extraction

- Uses PNG parser to locate `parameters` text chunk.
- Extracts prompt until `Negative prompt:` substring.
- `extract_prompts` command updates `prompts` + `prompts_fts`.

---

## Ranking System

### Core mechanism
- Elo rating for group comparisons.
- `submit_comparison` updates ratings and stores history.
- Supports outcomes:
  - left/right winner
  - both good (small bonus to both)
  - both bad (small penalty to both)

### Modes
1. **Pair Mode**
   - Two groups, two images each
   - Choose left/right/both

2. **Sequential Mode** (default)
   - Fullscreen current image
   - Previous group in top-left
   - Click previous to preview fullscreen

### Sampling strategy
- Tiered selection by match count:
  - 60% low-match tier
  - 25% mid-match tier
  - 15% high-match tier
- Right/current group also weighted by rating distance

### Hotkeys
- `1`: choose left/previous
- `2`: choose right/current
- `3`: both good
- `4`: both bad
- `W`: reroll current
- `Cmd+W`: reroll previous (sequential)
- `Q`: toggle previous image preview

---

## UI Behavior (Key Points)

### Group list
- Left pane with thumbnails.
- Shows group type, count, score + matches.

### Image grid
- Right pane with focusable thumbnails.

### Viewer
- Fullscreen image view.
- Metadata panel shows date/serial/prompt.

### Toolbar
- Icon-only header.
- Buttons: scan, random, slideshow, delete, ranking.

---

## Keyboard Shortcuts (Global)

Navigation:
- Arrow keys: move within groups/images
- `Enter`: open selected image
- `Esc`: close viewer and stop slideshow

Random & slideshow:
- `R`: random image in category
- `Cmd+R`: random category + image
- `S`: slideshow within category
- `Cmd+S`: slideshow across categories

Delete:
- `Cmd+D`: delete image
- `Cmd+Opt+D`: delete category

Fullscreen:
- `F`: toggle fullscreen

Categories:
- `Cmd+Up/Down`: previous/next category

Ranking:
- Ranking-specific hotkeys above

---

## Group Modes

- `prompt`: groups by prompt
- `prompt_date`: prompt + date grouping
- `date_prompt`: date + prompt grouping
- `date`: date-only grouping
- `score`: prompt grouping sorted by rating

Score mode is backed by SQL ordering; it persists in localStorage.

---

## Assets and Styling

- Toolbar SVGs in `src/assets/toolbar/`
- CSS primarily in `src/App.css` and component CSS
- Ranking overlay styles in `src/components/RankingPanel/RankingPanel.css`

---

## Known Constraints

- Prompt is group label; no per-image prompt yet.
- Date metadata exists only if group mode yields it.
- Ranking uses prompt-based groups (not batch-only groups).
- No tests (intentionally minimal).

---

## Common Tasks

### Add a new group mode
1. Update `GroupMode` in `src/data/types.ts`.
2. Handle mode in `list_groups` SQL in `src-tauri/src/lib.rs`.
3. Update `Filters` UI.
4. Update `useGalleryController` to persist mode if needed.

### Update ranking UI
- Pair mode: `RankingPanel` left/right columns
- Sequential mode: `RankingPanel` overlay layout
- Hotkeys: inside `RankingPanel` keydown handler

### Add new toolbar action
- Add icon and button in `Toolbar.tsx`
- Add command in `commands.ts`
- Wire in `useGalleryController.dispatch`

---

## Performance Notes

- Incremental scan is critical for large datasets.
- FTS used for prompt search; fallback to LIKE if needed.
- Avoid blocking UI on long operations; use status updates.

---

## Troubleshooting

- **Images not loading**: check Tauri asset protocol config.
- **Score mode order wrong**: verify SQL in `list_groups`.
- **Ranking not updating**: ensure `submit_comparison` is called and ratings table exists.
- **Scan misses images**: confirm folder has `YYYY-MM-DD` in path and filename format `serial-seed.png`.

---

## Testing Guidelines

- This repo currently does not include formal tests.
- When adding tests, use Swift Testing conventions (see global instructions).

---

## Conventions

- Use `rg` for search.
- Avoid destructive git commands.
- Keep comments minimal and actionable.
- Prefer `apply_patch` for edits.

---

## Suggested Next Improvements

- Persist ranking mode (pair vs sequential).
- Allow score view for batch groups.
- Visualize rating confidence (matches count).
- Add lightweight export of rankings.

---

## Session Handoff

When leaving a session, update:
- `SESSION_SUMMARY.md` for quick context
- Mention latest commits and known issues

---

## End
If anything here seems stale, update this file as part of your change.
