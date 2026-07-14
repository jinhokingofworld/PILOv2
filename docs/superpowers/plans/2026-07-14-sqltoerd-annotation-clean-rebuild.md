# SQLtoERD Annotation Clean Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild #947 from current `origin/dev` without formatter churn while preserving complete note/frame annotation behavior.

**Architecture:** Canvas observers emit command-shaped layout patches only. The SQLtoERD panel applies every patch against the latest session layout in one functional state-update path, then schedules existing autosave. Tables, note/frame transforms, and annotation editing therefore cannot overwrite each other with stale full-layout snapshots.

**Tech Stack:** Next.js/React, TypeScript, tldraw, NestJS validation, Node assertion scripts.

## Global Constraints

- Base implementation on current `origin/dev`; do not reuse formatter-only hunks from #947.
- Keep SQLtoERD state and persistence in `src/features/sql-erd/`; do not import `features/canvas`.
- `links`, `notes`, and `frames` share one unique ID namespace.
- Server limits: notes 100, frames 100, note text 2,000 chars, frame title 200 chars.
- Publish the validated clean history to `feat/938-sqltoerd-canvas-annotations` using `--force-with-lease` only.

### Task 1: Define and test command-shaped layout patches

**Files:**
- Modify: `apps/frontend/src/features/sql-erd/types/index.ts`
- Modify: `apps/frontend/src/features/sql-erd/utils/model.ts`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [ ] Add failing runtime assertions for `applySqltoerdLayoutPatch(currentLayout, patch)` preserving simultaneous table and note/frame changes.
- [ ] Add `SqltoerdLayoutPatch` with `tablePositions`, `notesById`, `framesById`, `deleteNoteIds`, and `deleteFrameIds`.
- [ ] Implement the pure patch merge function; preserve unrelated annotations and distinguish deletion from empty text/title.
- [ ] Run `node scripts/sql-erd/test.mjs` and commit the model/test change.

### Task 2: Validate the shared annotation contract

**Files:**
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.validation.ts`
- Modify: `apps/app-server/scripts/sqltoerd/test.mjs`
- Modify: `docs/api/sqltoerd-api.md`

- [ ] Add failing tests for valid notes/frames, 101st item, invalid color, excessive text/title, and cross-array duplicate IDs.
- [ ] Implement strict `notes`/`frames` validation using the links ID set.
- [ ] Document the optional v1 fields, limits, and global ID namespace.
- [ ] Run `npm.cmd run build; node scripts/sqltoerd/test.mjs` and commit the server/doc change.

### Task 3: Add SQLtoERD-owned shapes and creation controls

**Files:**
- Create: `apps/frontend/src/features/sql-erd/shapes/sql-erd-note-shape.tsx`
- Create: `apps/frontend/src/features/sql-erd/shapes/sql-erd-frame-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/utils/canvas-selection.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [ ] Add failing source/runtime tests for registered shapes, selection, creation limits, and text length controls.
- [ ] Register note/frame shapes, render persisted entries, and emit create patches.
- [ ] Make frame interiors pass pointer events through; only the outline can select/drag a frame.
- [ ] Run frontend SQLtoERD tests and commit.

### Task 4: Route all edits and transforms through the latest-state patch function

**Files:**
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [ ] Add failing tests proving table and annotation patches are merged rather than replacing a full stale layout.
- [ ] Add one parent `applyLayoutPatch` callback using a functional latest-session update before the existing autosave action.
- [ ] Have table sync, annotation transform sync, and create/edit/delete UI emit only patches.
- [ ] Debounce transform observation and persist x/y/width/height for notes and unlocked frames.
- [ ] Run frontend lint/test and commit.

### Task 5: Complete annotation editing behavior and final verification

**Files:**
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [ ] Add failing tests for note edit/delete and frame title/color/unlock/delete commands.
- [ ] Implement note body editing/deletion and frame title/color/lock toggle/deletion with `maxLength` controls.
- [ ] Verify locked frames cannot move/resize and unlock restores movement/resize.
- [ ] Manually verify create, edit, transform, autosave, refresh, automatic layout, and SQL regeneration preserve notes/frames.
- [ ] Run frontend lint/test, app-server build/test, `git diff --check`, inspect file-level diff, then commit.

### Task 6: Replace PR #947 head safely

**Files:** none.

- [ ] Fetch `origin` immediately before publishing and confirm the PR head SHA.
- [ ] Push the verified clean branch to `feat/938-sqltoerd-canvas-annotations` with `git push --force-with-lease origin HEAD:feat/938-sqltoerd-canvas-annotations`.
- [ ] Confirm PR #947 still targets `dev`, has no conflicts, and contains no formatter-only files/hunks.
