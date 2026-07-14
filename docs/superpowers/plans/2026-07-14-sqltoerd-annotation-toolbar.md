# SQLtoERD Annotation Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the accepted SQLtoERD annotation toolbar v1 while preserving the existing layout patch persistence contract.

**Architecture:** A feature-local toolbar receives SQLtoERD editor callbacks and uses tldraw selection observation only to reveal frame color controls. Annotation creation still emits `notesToAdd` or `framesToAdd`; color changes still travel through `SQLTOERD_FRAME_CHANGE_EVENT` to the existing immediate-update and autosave bridge.

**Tech Stack:** React, TypeScript, tldraw, lucide-react, existing SQLtoERD runtime source test.

## Global Constraints

- Modify only `apps/frontend/src/features/sql-erd/`, its SQLtoERD test script, and this work record.
- Do not modify API contracts, database schema, `src/shared/`, or `src/features/canvas/`.
- Do not add text annotations, strokes, an eraser, or canvas Undo/Redo.
- Keep the maximum 100-note and 100-frame safeguards.

---

### Task 1: Define the feature-local toolbar contract and regression test

**Files:**
- Create: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas-toolbar.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [x] **Step 1:** Add a failing source regression assertion that requires `SqlErdCanvasToolbar`, accessible select/note/frame/fit controls, and a conditional frame color menu driven by `isSqlErdFrameShape`.
- [x] **Step 2:** Run `node scripts/sql-erd/test.mjs` and verify it fails because the toolbar component is absent.
- [x] **Step 3:** Create `SqlErdCanvasToolbar` with the following props: `editor`, `onAddNote`, `onAddFrame`, `onFit`, and `onFrameColorChange`.
- [x] **Step 4:** Use `useValue` with `editor.getOnlySelectedShape()` to expose color controls only for a selected SQLtoERD frame. The color button calls `onFrameColorChange(frameId, color)` for slate, blue, green, amber, or rose.
- [x] **Step 5:** Run `node scripts/sql-erd/test.mjs` and commit the toolbar component and test with `feat: SQLtoERD annotation 도구 모음 추가 (#969)`.

### Task 2: Integrate the toolbar with existing SQLtoERD actions

**Files:**
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

- [x] **Step 1:** Add a failing source regression assertion that requires the toolbar to dispatch `SQLTOERD_FRAME_CHANGE_EVENT`, add notes and frames through existing patch keys, and call `fitSqlErdCanvas`.
- [x] **Step 2:** Run `node scripts/sql-erd/test.mjs` and verify it fails because the canvas does not render the toolbar.
- [x] **Step 3:** Render the toolbar as a feature-local overlay, replace the old add-note/add-frame buttons, and keep auto layout separately available.
- [x] **Step 4:** Calculate note and frame insertion positions from `editor.getViewportPageBounds()` so newly added annotations appear in the current view, then keep `notesToAdd` and `framesToAdd` as the persistence commands.
- [x] **Step 5:** Dispatch the existing frame-change custom event from the toolbar callback and use the existing `fitSqlErdCanvas` helper for fit.
- [x] **Step 6:** Run `node scripts/sql-erd/test.mjs`, `npm.cmd run format:check`, `npm.cmd run lint`, and `git diff --check`; commit with `feat: SQLtoERD annotation 도구 모음 연결 (#969)`.

### Task 3: Record verification and prepare the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-sqltoerd-annotation-toolbar.md`

- [x] **Step 1:** Review the final diff against `origin/dev` and confirm it is limited to the declared SQLtoERD frontend scope and work records.
- [x] **Step 2:** Re-run `node scripts/sql-erd/test.mjs`, `npm.cmd run format:check`, `npm.cmd run lint`, and `git diff --check` after all commits.
- [x] **Step 3:** Record completed automated verification and any unavailable manual check truthfully in this plan, then commit it with `docs: SQLtoERD annotation 도구 모음 검증 기록 (#969)`.
- [x] **Step 4:** Push `feat/969-sqltoerd-annotation-toolbar` and create a ready PR to `dev` with `Closes #969`.

## Verification result

- [x] `node scripts/sql-erd/test.mjs`
- [x] `npm.cmd run format:check`
- [x] `npm.cmd run lint`
- [x] `npm.cmd run build`
- [x] `git diff --check`
- [ ] Manual canvas verification is deferred because the agent does not have a loadable authenticated SQLtoERD session for this branch. The PR calls out the required review flow: add note, add frame, select frame and change color, fit, then reload after autosave.
