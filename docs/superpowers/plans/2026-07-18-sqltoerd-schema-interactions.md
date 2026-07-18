# SQLtoERD Schema Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLtoERD에서 패널·Canvas selection을 안정화하고 table/column 편집을 검증된 SQL source snapshot으로 저장하며 FK source navigation과 Agent focus를 layout revision 변화에 안전하게 만든다.

**Architecture:** Frontend는 local selection에서 파생한 contextual relation highlight와 source navigation request를 사용하고, pure schema mutation을 기존 normalized SQL preview/source lock/source snapshot 흐름에 연결한다. App Server Agent tool은 session revision 대신 inspect 결과의 model fingerprint를 schema identity로 검증하며, CORS는 runtime을 추측으로 변경하지 않고 배포 smoke script로 관찰한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, tldraw 5, CodeMirror 6, NestJS/Fastify, Node.js assertion tests

## Global Constraints

- 기준 branch는 Issue #1388 생성 뒤 최신 `origin/dev`의 `a08ceaee`에서 분기한 `feat/1388-sqltoerd-interactions`이다.
- DB schema, migration, legacy SQLtoERD PATCH, 새 operation type을 추가하지 않는다.
- durable schema 변경은 기존 normalized SQL diff, parse round trip, source lock, `source_snapshot` publish를 사용한다.
- 원본 dump의 비-ERD statement와 서식을 자동 보존한다고 가정하지 않고 Apply 전 diff와 경고를 유지한다.
- Inspector handle과 UI는 `apps/frontend/src/features/sql-erd/**` 안에서 구현해 Frontend 공통 영역을 변경하지 않는다.
- App Server bootstrap CORS 설정은 현재 원격 dev에서 정상임이 확인됐으므로 근거 없이 수정하지 않는다.
- table focus는 model fingerprint가 같으면 layout-only revision mismatch를 허용하고 model 변경은 거부한다.
- 테스트는 production code보다 먼저 작성하고 기대한 이유로 실패하는 것을 확인한다.

---

### Task 1: Inspector handle과 첫 pointer gesture selection

**Files:**
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-table-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/utils/canvas-selection.ts`

**Interfaces:**
- Produces: `getSqlErdPointerSelectionIntent(...)` returning a table/column semantic selection without stopping the tldraw pointer sequence.
- Produces: SQLtoERD-local Inspector boundary button with `aria-label="상세 정보 패널 닫기"`.

- [ ] **Step 1: Write failing selection and markup contract tests**

  Extend the runtime harness to assert that a pointer-down on an unselected table returns selection for that shape before drag, a column pointer move beyond `COLUMN_CLICK_DRAG_THRESHOLD` does not replace semantic selection on click, and the Inspector open markup contains a middle boundary handle instead of relying on the top-right header button.

  ```js
  assert.deepEqual(
    getSqlErdPointerSelectionIntent({
      columnId: null,
      selectedShapeIds: ["shape:old"],
      shapeId: "shape:new",
      shiftKey: false
    }),
    { selectedShapeIds: ["shape:new"], selection: { type: "table" } }
  );
  ```

- [ ] **Step 2: Run RED test**

  Run: `node scripts/sql-erd/test.mjs` in `apps/frontend`.

  Expected: FAIL because the pointer intent helper and Inspector boundary handle do not exist.

- [ ] **Step 3: Implement minimal pointer-down selection**

  In `canvas-selection.ts`, add a pure helper that preserves Shift toggle rules and selects the hit table on pointer-down. In `SqlErdTableCard`, call the existing shape selection helper from `onPointerDownCapture` without `preventDefault` or `stopPropagation`; keep click responsible only for the final column/table semantic event when the pointer did not cross the drag threshold.

- [ ] **Step 4: Implement the Inspector boundary handle**

  Make the open Inspector `aside` relative and render:

  ```tsx
  <button
    aria-label="상세 정보 패널 닫기"
    className="absolute left-0 top-1/2 z-20 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background shadow-sm"
    onClick={onToggle}
    type="button"
  >
    <PanelRightClose className="size-4" />
  </button>
  ```

  Remove the conflicting header close control while preserving the collapsed open control.

- [ ] **Step 5: Verify GREEN and commit**

  Run `node scripts/sql-erd/test.mjs`; expect exit code 0.

  Commit: `fix: SQLtoERD 패널과 첫 drag 선택을 안정화 (#1388)`

### Task 2: Table-related FK highlight and CodeMirror source navigation

**Files:**
- Create: `apps/frontend/src/features/sql-erd/utils/source-navigation.ts`
- Create: `apps/frontend/src/features/sql-erd/components/sql-erd-selection-context.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-relation-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/utils/sql-source-map.ts`
- Modify: `apps/frontend/src/features/sql-erd/utils/sql-source-decoration.ts`

**Interfaces:**
- Produces: `getSqlErdContextRelationIds(modelJson, selection): Set<string>`.
- Produces: `resolveSqlErdSourceNavigationTarget(sourceMap, relationId, target)` where target is `constraint | from | to`.
- Produces: `SqlErdSourceNavigationRequest { id: number; range: SqltoerdSourceRange }`.

- [ ] **Step 1: Write failing pure highlight/navigation tests**

  Add tests for incoming, outgoing and self-reference relation IDs when a table is selected; relation selection must not create a contextual set. Assert `constraint` returns the FK declaration, `from` returns all referencing column ranges and `to` returns all referenced column ranges, and stale source text returns no target.

  ```js
  assert.deepEqual(
    [...getSqlErdContextRelationIds(model, {type:"table", tableId:"workspaces"})],
    ["membership_workspace_fk", "repository_workspace_fk"]
  );
  ```

- [ ] **Step 2: Run RED test**

  Run: `node scripts/sql-erd/test.mjs`.

  Expected: FAIL because the new modules/functions are absent.

- [ ] **Step 3: Add contextual relation rendering**

  Provide current `SqlErdSelection` through a Canvas-local React context. Extend `getSqlErdRelationVisualStyle` to accept `isContextHighlighted` and apply precedence `selected > contextual > hovered > default`; do not call `editor.select` for contextual relations.

- [ ] **Step 4: Write failing atomic editor synchronization tests**

  Extract a pure builder in `source-navigation.ts` that clamps selection and filters decoration/navigation ranges against the next document length. Test a 60,000-character source replaced by a 100-character source with old range `{from:54261,to:54280}` and assert no range or selection exceeds 100.

- [ ] **Step 5: Implement atomic CodeMirror synchronization and navigation**

  Keep current relation ranges in a ref. When external `value` changes, dispatch one transaction containing full replace, clamped selection and relation-decoration compartment reconfigure for the next document. Add a separate effect for valid navigation requests:

  ```ts
  view.dispatch({
    selection: { anchor: range.from, head: range.to },
    effects: EditorView.scrollIntoView(range.from, { y: "center" })
  });
  ```

  Selecting a relation sets source panel open and queues the constraint target. Inspector endpoint buttons queue from/to targets.

- [ ] **Step 6: Verify GREEN and commit**

  Run `node scripts/sql-erd/test.mjs` and `node scripts/sql-erd-realtime.test.mjs`.

  Commit: `feat: FK 강조와 SQL source 이동을 추가 (#1388)`

### Task 3: Pure table/column schema mutations

**Files:**
- Create: `apps/frontend/src/features/sql-erd/utils/schema-mutation.ts`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/utils/sql-diff-apply.ts`

**Interfaces:**
- Produces: `deleteSqlErdTable`, `deleteSqlErdColumn`, `renameSqlErdTable`, `renameSqlErdColumn`, `changeSqlErdColumnType` returning `SqlErdSchemaMutationResult`.
- Consumes: `SqltoerdModelJsonV1`; does not mutate the input object.
- Produces: affected constraint/relation counts for confirmation copy.

- [ ] **Step 1: Write failing delete tests**

  Test that table delete removes incoming/outgoing/self relations; column delete removes constraints and relations containing the column while leaving unrelated objects unchanged; deleting the last column returns `LAST_COLUMN`; missing IDs return `NOT_FOUND`.

- [ ] **Step 2: Run RED test**

  Run: `node scripts/sql-erd/test.mjs`.

  Expected: FAIL because `schema-mutation.ts` is missing.

- [ ] **Step 3: Implement immutable delete helpers**

  Return a discriminated union:

  ```ts
  type SqlErdSchemaMutationResult =
    | { ok: true; modelJson: SqltoerdModelJsonV1; removedConstraintCount: number; removedRelationCount: number }
    | { ok: false; reason: "NOT_FOUND" | "LAST_COLUMN" | "DUPLICATE_NAME" | "INVALID_NAME" | "INVALID_DATA_TYPE" };
  ```

  Clone only schema collections that change and recompute column `foreignKey`, `primaryKey` and `unique` flags from remaining relations/constraints.

- [ ] **Step 4: Write failing rename/type tests**

  Cover quoted-capable identifiers, trimmed duplicate names with dialect-appropriate case behavior, empty names, unsafe `;`, `--`, `/*` type input, relation/constraint identity preservation, and PostgreSQL/MySQL/SQLite generation/reparse.

- [ ] **Step 5: Implement rename/type helpers and semantic round trip guard**

  Add a comparison used by `applySqlErdNormalizedSqlPreview` to assert generated SQL reparses to the intended table/column/constraint/relation structure. Return an apply error instead of publishing if it diverges.

- [ ] **Step 6: Verify GREEN and commit**

  Run `node scripts/sql-erd/test.mjs`.

  Commit: `feat: SQLtoERD table과 column mutation을 추가 (#1388)`

### Task 4: Wire Canvas Delete and Inspector editing to source preview

**Files:**
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/utils/inspector.ts`

**Interfaces:**
- Consumes: Task 3 mutation helpers.
- Produces: `onRequestSchemaMutation` Canvas callback and Inspector edit/delete callbacks.
- Reuses: `createSqlErdNormalizedSqlPreview`, existing normalized diff dialog, `applySqlErdNormalizedSqlPreview`, source lock controller and source snapshot publish.

- [ ] **Step 1: Write failing Delete routing tests**

  Assert semantic column selection routes Delete to column mutation and table selection routes it to table mutation; annotation/note/frame/text/stroke behavior remains unchanged. Assert tldraw does not delete a table shape directly before model/source preview succeeds.

- [ ] **Step 2: Run RED test**

  Run: `node scripts/sql-erd/test.mjs`.

  Expected: FAIL because schema selection Delete has no mutation callback.

- [ ] **Step 3: Implement Canvas mutation request guard**

  Intercept Delete/Backspace only for a single semantic table/column selection, ignore editable input targets, prevent tldraw default deletion, and request mutation from `SqlErdPanel`. Keep focus-mode dimmed and protocol-mismatch guards.

- [ ] **Step 4: Write failing Inspector edit tests**

  Require table name and delete controls in table view, column name/type and delete controls in column view, validation messages, affected relation count confirmation and disabled controls when source edit is unavailable.

- [ ] **Step 5: Implement preview integration and Inspector controls**

  Centralize `previewSchemaMutation(result)` in `SqlErdPanel`: clear stale apply error, call `createSqlErdNormalizedSqlPreview` with current layout/settings, store model history and open existing diff preview. After Apply, existing source lock/snapshot code publishes canonical source/model and realtime refresh removes or renames shapes.

- [ ] **Step 6: Verify GREEN and commit**

  Run frontend SQLtoERD/realtime tests and `npm.cmd run lint`.

  Commit: `feat: Canvas와 Inspector schema 편집을 source에 연결 (#1388)`

### Task 5: Agent focus model fingerprint contract

**Files:**
- Modify: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/sqltoerd-api.md`

**Interfaces:**
- `inspect_sql_erd_schema` output adds `modelFingerprint`.
- `focus_sql_erd_tables` input requires `modelFingerprint` matching `^fnv1a32:[0-9a-f]{8}$` while retaining `sessionRevision` for metadata/diagnostics.

- [ ] **Step 1: Write failing Agent contract tests**

  Assert inspect output contains the current fingerprint. Focus with inspect revision 7/current revision 8 and the same model fingerprint succeeds; the same request with a changed current model fails with `SQLtoERD session revision changed; inspect the schema again`.

- [ ] **Step 2: Run RED test**

  Run: `npm.cmd run build; node scripts/agent/sql-erd-tools.test.mjs` in `apps/app-server`.

  Expected: FAIL because focus still compares revision equality and input rejects `modelFingerprint`.

- [ ] **Step 3: Implement fingerprint validation**

  Add the field to tool schemas and normalization. In `executeInspect`, return `createSqlErdModelFingerprint(session.modelJson)`. In `executeFocus`, compare current fingerprint to input and remove strict revision equality as the schema guard. Preserve current revision in output/resource metadata.

- [ ] **Step 4: Update API docs and verify GREEN**

  Document that compact refs are model-fingerprint scoped and layout-only revision changes are allowed. Run build and the focused Agent test.

- [ ] **Step 5: Commit**

  Commit: `fix: Agent table focus를 model fingerprint로 검증 (#1388)`

### Task 6: CORS smoke, full verification and PR

**Files:**
- Create: `apps/app-server/scripts/agent/cors-preflight-smoke.mjs`
- Modify: `docs/api/agent-api.md`

**Interfaces:**
- Script arguments: `--url`, `--origin`, optional `--method` defaulting to `POST`, optional `--headers` defaulting to `authorization,content-type`.
- Exit 0 only for 2xx preflight with exact allowed origin and requested method/headers.

- [ ] **Step 1: Write the smoke script self-test first**

  Add an in-process HTTP fixture mode covering a valid preflight, missing allow-origin, wrong origin and 502 response. Run with `node scripts/agent/cors-preflight-smoke.mjs --self-test` and expect failure before implementation.

- [ ] **Step 2: Implement the minimal read-only smoke client**

  Use Node `fetch` with `OPTIONS` and print only status and CORS headers. Never print authorization tokens or response bodies. Add usage and the exact dev command to `docs/api/agent-api.md`.

- [ ] **Step 3: Run focused verification**

  ```text
  apps/frontend: node scripts/sql-erd/test.mjs
  apps/frontend: node scripts/sql-erd-realtime.test.mjs
  apps/frontend: npm.cmd run lint
  apps/frontend: npm.cmd run format:check
  apps/app-server: npm.cmd run build
  apps/app-server: node scripts/agent/sql-erd-tools.test.mjs
  apps/app-server: node scripts/agent/cors-preflight-smoke.mjs --self-test
  repository root: git diff --check
  ```

- [ ] **Step 4: Run remote dev smoke**

  Run:

  ```text
  node scripts/agent/cors-preflight-smoke.mjs --url https://api.dev.pilo.my/api/v1/workspaces/26776b0e-897f-40d1-b39c-9e1f49387010/agent/runs --origin https://dev.pilo.my
  ```

  Record the observed status/headers in the PR. If external network is unavailable, mark only this check as not run.

- [ ] **Step 5: Self review**

  Compare the diff with the design and Issue #1388. Confirm no DB migration, common shell/bootstrap change, legacy PATCH path, raw SQL log, unrelated generated file or user worktree file. Test protocol mismatch/read-only and source-lock-disabled controls by contract.

- [ ] **Step 6: Commit docs/smoke and publish**

  Commit: `test: Agent CORS preflight 검증을 추가 (#1388)`

  Push `feat/1388-sqltoerd-interactions` and create a non-draft PR to `dev` titled `feat(sqltoerd,agent): ERD schema 편집과 탐색 흐름 개선`. The body must contain `Closes #1388`, exact tests, API contract impact, no DB/common-area change, UI behavior description and reviewer focus on source mutation/CodeMirror/fingerprint validation.
