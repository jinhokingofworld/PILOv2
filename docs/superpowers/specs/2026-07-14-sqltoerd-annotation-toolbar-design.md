# SQLtoERD Annotation Toolbar Design

## Goal

Expose existing SQLtoERD note and frame annotations through a compact in-canvas toolbar without changing the persisted annotation contract.

## Accepted scope

- A left-side vertical toolbar provides select/drag, add note, add frame, frame color, and fit-to-screen actions.
- The frame color control is visible only while exactly one SQLtoERD frame is selected.
- New notes and frames are added at the visible viewport center, within the existing maximum count safeguards.
- Auto layout remains available as its existing separate action.

## Explicitly excluded

- Text annotations
- Freehand strokes and a stroke-only eraser
- Canvas Undo and Redo
- API contract, database schema, and shared Canvas feature changes

## Architecture

The toolbar is a SQLtoERD feature component rendered over the existing tldraw surface. It reads selection state from the SQLtoERD editor only; it does not import or reuse the freeform Canvas feature.

Add-note and add-frame actions retain `SqltoerdLayoutPatch.notesToAdd` and `SqltoerdLayoutPatch.framesToAdd`. Frame color selection dispatches the existing `SQLTOERD_FRAME_CHANGE_EVENT`, so `SqlErdCanvasAnnotationSync` performs its established immediate shape update and canonical `framesById` autosave patch.

## Interaction details

- Select/drag switches tldraw to `select.idle`.
- Note and frame actions remain disabled at the server-aligned limit of 100 entries.
- The color menu contains the existing frame colors: slate, blue, green, amber, and rose.
- Fit runs the existing SQLtoERD minimum-readable-zoom-aware fit helper.
- Toolbar controls are HTML buttons with accessible names and do not introduce a new keyboard history model.

## Verification

- Add source-level regression checks in `apps/frontend/scripts/sql-erd/test.mjs` for the toolbar actions, conditional color control, and reuse of existing patch/event paths.
- Run the SQLtoERD runtime test, frontend format check, frontend TypeScript check, and `git diff --check`.
- Manually verify note/frame creation, frame color change, fit, and autosave/reload in a loadable dev session.
