# ADR: Gallery Architecture Refactor Plan

Date: 2026-02-20
Status: Proposed

## Context
The project has grown beyond a single `App.tsx` and now includes keyboard shortcuts, toolbar commands, native menu actions, grouping modes, and prompt extraction. Logic is duplicated across UI handlers and keyboard/menu integrations. This increases risk of regressions and makes feature expansion harder.

## Decision
Refactor into a layered architecture with:
- a data access layer for Rust command calls
- a single gallery controller that owns state and command dispatch
- typed `GroupKey` parsing/formatting
- separate UI components for toolbar, filters, group list, image grid, and viewer

## Goals
- One command path for keyboard, toolbar, and native menu actions
- Predictable state handling and easier testing
- Reduced duplication and clearer separation between UI and domain logic

## Proposed Structure
```
src/
  app/
    AppShell.tsx
    AppState.ts
    useGalleryController.ts
    commands.ts
  components/
    Toolbar/
    GroupList/
    ImageGrid/
    Viewer/
    Filters/
  data/
    galleryApi.ts
    types.ts
    groupKey.ts
  hooks/
    useKeyboard.ts
    useMenuEvents.ts
  assets/
    toolbar/*.svg
```

## Migration Plan
Phase 1: Data Layer
- Create `src/data/types.ts` for `Group`, `Image`, `GroupKey`
- Create `src/data/groupKey.ts` with `parseGroupKey` and `formatGroupKey`
- Create `src/data/galleryApi.ts` wrapping Tauri `invoke` calls

Phase 2: Controller Layer
- Create `src/app/useGalleryController.ts` to own state + actions
- Create `src/app/commands.ts` for command dispatcher

Phase 3: UI Split
- Extract `Toolbar`, `Filters`, `GroupList`, `ImageGrid`, `Viewer`
- Keep components pure with props

Phase 4: Inputs
- Add `hooks/useKeyboard.ts`
- Add `hooks/useMenuEvents.ts`

## Consequences
- Short-term cost: restructure files and update imports
- Long-term gain: consistent actions, easier testing and feature expansion

## Notes
Schema reset approach remains for now; future work may add migrations.
