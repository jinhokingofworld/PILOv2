# SQLtoERD Annotation Controls Verification Record

**Issue:** #965
**Goal:** Remove the sticky-note card delete button and make frame unlock apply immediately while preserving the existing annotation autosave path.

## Scope and constraints

- No API contract, database schema, or shared frontend changes.
- A note is deleted only when it is selected and the user presses Delete or Backspace.
- Delete or Backspace in a note textarea remains normal text editing.
- A locked frame remains protected from move, resize, and deletion; unlocking it must update the visible tldraw shape immediately and persist through the existing layout patch route.

## Implementation record

- [x] Removed the note card trash button and its custom delete event.
- [x] Added selected-note keyboard deletion that removes the tldraw shape without adding history and emits `deleteNoteIds`.
- [x] Added regression checks for the absent card delete event and the selected-note key path.
- [x] Added a failing regression check for immediate frame-shape patching.
- [x] Updated the frame-change handler to merge the patch into the current tldraw frame shape with `history: "ignore"` before publishing `framesById`.
- [x] Preserved the parent layout-patch/autosave route as the canonical persisted state.

## Verification record

- [x] `node scripts/sql-erd/test.mjs`
- [x] `npm.cmd run lint`
- [x] `git diff --check`
- [ ] Manual browser verification: the supplied dev session returned `Load failed` / `Workspace session could not be loaded` in the agent browser, so this is explicitly deferred to PR review.

## Commits

- `fix: SQLtoERD 메모 삭제 조작 정리 (#965)`
- `fix: SQLtoERD frame 잠금 해제 동기화 (#965)`
