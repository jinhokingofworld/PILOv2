# SQLtoERD Agent Table Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workspace Agent가 기능 관련 SQLtoERD 테이블을 분석하고 검증된 일회성 집중 보기를 SQLtoERD Canvas에 적용하도록 한다.

**Architecture:** App Server의 두 read-only Agent tool이 session 선택, 9,000자 이하 schema projection, revision 한정 table ref 검증과 resource metadata 생성을 담당한다. 기존 AI Worker planner가 projection을 근거로 primary/related table을 분류하고, Frontend는 검증된 metadata를 one-shot handoff로 전달해 model/layout을 바꾸지 않는 React focus context로 Canvas를 흐리게 표시한다.

**Tech Stack:** NestJS, TypeScript, Node.js assertion tests, Python 3.12/pytest, Next.js 16, React 19, tldraw 5

## Global Constraints

- 기준 branch는 Issue #1293 생성 뒤 최신 `origin/dev`의 `717e2db1`에서 분기한 `feat/1293-sqltoerd-table-focus`이다.
- `inspect_sql_erd_schema`와 `focus_sql_erd_tables`는 `riskLevel=low`, `executionMode=auto`인 read-only tool이다.
- session이 하나면 자동 선택하고, 여러 개면 최대 5개 후보를 반환해 사용자가 선택하게 한다.
- primary와 의미 있는 직접 FK related table만 집중 범위에 포함하며 기본 2-hop 확장은 하지 않는다.
- inspect output은 AI Worker planning context 12,000자 제한을 위해 최대 9,000자로 제한한다.
- SQL source, 전체 modelJson/layoutJson, Canvas raw shape, token, 비밀값을 output summary나 resource metadata에 넣지 않는다.
- focus 상태는 DB, SQLtoERD session, URL query/hash에 저장하지 않고 새로고침·session 이동·`전체 보기`에서 해제한다.
- 흐려진 table/relation의 selection과 편집은 막되 Canvas pan/zoom은 유지한다.
- read-only 조회·UI focus이므로 Activity Log를 기록하지 않는다.
- DB schema와 migration, Frontend/App Server 공통 영역은 변경하지 않는다.

---

### Task 1: App Server schema projection과 focus 검증

**Files:**
- Create: `apps/app-server/src/modules/agent/tools/sql-erd-table-focus.ts`
- Modify: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`

**Interfaces:**
- Produces: `buildSqlErdAgentSchemaProjection(modelJson, featureQuery)` returning a JSON-safe projection with `tables[{ref,name,...}]`, `edges[[fromRef,toRef]]`, and `truncated` under 9,000 characters.
- Produces: `resolveSqlErdAgentTableFocus(modelJson, input)` returning actual primary/related table IDs, selected relation IDs, and table names after revision-scoped ref validation.
- Consumes: SQLtoERD `modelJson.version=1`, table declaration order, FK relation endpoints.

- [ ] **Step 1: Write failing projection tests**

  Extend `sql-erd-tools.test.mjs` with a model containing `orders`, `payments`, `payment_attempts`, `users`, long comments, PK/FK columns and FK edges. Assert that refs are deterministic (`t1`...), relation endpoints use refs, PK/FK and query-matching columns are prioritized, `JSON.stringify(projection).length <= 9000`, and neither source SQL nor internal table/column IDs appear.

- [ ] **Step 2: Run the test to verify RED**

  Run: `npm.cmd run build; node scripts/agent/sql-erd-tools.test.mjs` in `apps/app-server`.

  Expected: FAIL because `dist/modules/agent/tools/sql-erd-table-focus.js` does not exist.

- [ ] **Step 3: Implement the bounded projection**

  Export these exact shapes and functions:

  ```ts
  export interface SqlErdAgentSchemaProjection {
    tables: Array<{
      ref: string;
      name: string;
      schemaName?: string;
      comment?: string;
      columns?: Array<{
        name: string;
        primaryKey: boolean;
        foreignKey: boolean;
        comment?: string;
      }>;
    }>;
    edges: Array<[string, string]>;
    truncated: boolean;
  }

  export function buildSqlErdAgentSchemaProjection(
    modelJson: Record<string, unknown>,
    featureQuery: string
  ): SqlErdAgentSchemaProjection;
  ```

  Validate model v1 locally, create refs from declaration order, add the compact table catalog and all FK edges first, and append optional descriptions/columns only while the 9,000-character serialized budget remains.

- [ ] **Step 4: Write failing focus validation tests**

  Assert that `primaryTableRefs=["t2"]` and directly connected `relatedTableRefs=["t1","t3"]` resolve to actual IDs; selected relation IDs are derived from the model; duplicate/overlapping refs, unknown refs, empty primary refs and related refs without direct primary FK throw a 400-style error.

- [ ] **Step 5: Run focus tests to verify RED**

  Run the same focused App Server command.

  Expected: FAIL because `resolveSqlErdAgentTableFocus` is not exported.

- [ ] **Step 6: Implement minimal focus validation and verify GREEN**

  Implement `resolveSqlErdAgentTableFocus` using the same table declaration order ref map. Include relations whose endpoints are both in the selected set, but require every related table to have at least one direct edge to a primary table. Re-run the focused test and expect `SQLtoERD Agent tool tests passed.`

- [ ] **Step 7: Commit Task 1**

  ```text
  test: SQLtoERD Agent 집중 보기 projection을 검증 (#1293)
  feat: SQLtoERD Agent 집중 보기 검증기를 추가 (#1293)
  ```

### Task 2: App Server Agent tool 등록과 session 선택

**Files:**
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`

**Interfaces:**
- Consumes: Task 1 `buildSqlErdAgentSchemaProjection` and `resolveSqlErdAgentTableFocus`.
- Produces: registered `inspect_sql_erd_schema` and `focus_sql_erd_tables` definitions.
- Produces: `sqltoerd/session` resource ref metadata `{version:1, view:"table_focus", sessionRevision, featureLabel, primaryTableIds, relatedTableIds, relationIds, confidence}`.

- [ ] **Step 1: Write failing tool definition and session resolution tests**

  Extend `FakeSqlErdService` with `listSessions` and realistic model payloads. Assert:

  ```js
  assert.equal(inspect.riskLevel, "low");
  assert.equal(inspect.executionMode, "auto");
  assert.equal(focus.riskLevel, "low");
  assert.equal(focus.executionMode, "auto");
  ```

  Cover explicit request-context session, exact session title, one-session auto-selection, zero-session clarification, and multiple-session clarification with at most five title/updatedAt/tableCount candidates.

- [ ] **Step 2: Run focused tests to verify RED**

  Run: `npm.cmd run build; node scripts/agent/sql-erd-tools.test.mjs`.

  Expected: FAIL because the registry only contains `generate_sql_erd`.

- [ ] **Step 3: Implement strict input schemas and inspect execution**

  Keep `generate_sql_erd` first for compatibility and add the two definitions. `inspect_sql_erd_schema` accepts only `featureQuery`, optional `sessionId`, and optional `sessionTitle`. Use explicit session ID, exact title among up to 100 active sessions, request-context session, then single active session in that priority. Return `needs_clarification` with a Korean question when selection is absent or ambiguous.

- [ ] **Step 4: Write failing focus resource tests**

  Assert a valid focus call re-loads the session, rejects a stale `sessionRevision`, maps compact refs, bounds every reason, derives relation IDs and produces no SQL/model payload. Assert metadata byte size remains below the Agent resource ref limit.

- [ ] **Step 5: Implement focus execution and verify GREEN**

  Validate `featureLabel` 1–100, unique primary/related refs, confidence enum and bounded reasons. Re-load with `SqlErdService.getSession`, compare revision, call Task 1 resolver, and return the verified summary/resource ref. Re-run App Server build and the focused tool test.

- [ ] **Step 6: Commit Task 2**

  ```text
  test: SQLtoERD Agent session 선택과 focus 도구를 검증 (#1293)
  feat: SQLtoERD 테이블 집중 보기 Agent 도구를 추가 (#1293)
  ```

### Task 3: AI Worker planner routing과 평가

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/tests/test_agent_processor.py`
- Modify: `apps/ai-worker/evals/agent_planner_korean_v1.json`
- Modify: `apps/ai-worker/tests/test_agent_planner_evaluation.py`

**Interfaces:**
- Consumes: completed `inspect_sql_erd_schema` planning context containing compact refs.
- Produces: first-turn inspect tool calls and second-turn `focus_sql_erd_tables` calls with primary/related refs and factual reasons.

- [ ] **Step 1: Write failing planner contract tests**

  Assert `_agent_planner_system_prompt()` contains both new tool names and rules to inspect first, never invent refs, distinguish primary/related, include only meaningful direct FK neighbors, avoid automatic 2-hop expansion and use revision from inspect output.

- [ ] **Step 2: Run focused pytest to verify RED**

  Run: `python -m pytest tests/test_agent_processor.py -q` in `apps/ai-worker` after installing `requirements-dev.txt` into an isolated environment.

  Expected: FAIL because the prompt does not mention the new tools.

- [ ] **Step 3: Add planner instructions**

  Add concise English system instructions next to the existing `generate_sql_erd` rules. Preserve existing generation behavior and explicitly tell the planner to return clarification when multiple sessions are reported.

- [ ] **Step 4: Add evaluation fixtures and tests**

  Register both tool schemas in `agent_planner_korean_v1.json` and add cases for “결제 관련 테이블만 보여줘”, explicit session title, and unsupported database execution remaining unsupported. Update evaluation assertions to expect inspect on the initial request and focus after completed projection context.

- [ ] **Step 5: Run AI Worker tests and commit**

  Run:

  ```text
  python -m pytest tests/test_agent_processor.py tests/test_agent_planner_evaluation.py -q
  ```

  Expected: all selected tests pass.

  Commit:

  ```text
  test: SQLtoERD 집중 보기 planner 평가를 추가 (#1293)
  feat: SQLtoERD 집중 보기 planner routing을 추가 (#1293)
  ```

### Task 4: Agent resource metadata의 one-shot handoff

**Files:**
- Create: `apps/frontend/src/features/sql-erd/utils/agent-table-focus.ts`
- Modify: `apps/frontend/src/features/agent/resource-links.ts`
- Modify: `apps/frontend/src/features/agent/components/agent-resource-links.tsx`
- Modify: `apps/frontend/src/features/agent/agent-feature.test.mjs`

**Interfaces:**
- Produces: `SqlErdAgentTableFocusPayload` and strict `parseSqlErdAgentTableFocusMetadata`.
- Produces: `stageSqlErdAgentTableFocus`, `consumeSqlErdAgentTableFocus`, and `dispatchSqlErdAgentTableFocus` keyed by session ID.
- Consumes: Task 2 resource metadata; preserves the existing exact allowlisted session URL.

- [ ] **Step 1: Write failing metadata and link tests**

  Add a completed focus resource ref and assert `getAgentResourceLinks` returns label `집중 보기 열기` plus the parsed payload. Reject wrong metadata version/view, stale types, duplicate IDs, overlap, empty primary IDs, unknown confidence, oversized feature labels and any unsafe URL/query/hash.

- [ ] **Step 2: Run Agent feature test to verify RED**

  Run: `node --experimental-strip-types src/features/agent/agent-feature.test.mjs` in `apps/frontend`.

  Expected: FAIL because focus metadata is ignored.

- [ ] **Step 3: Implement strict parser and one-shot storage**

  Define payload fields exactly as the resource metadata plus `sessionId`. Storage helpers accept a `Storage` argument for tests, serialize only validated payloads and remove the entry on consume. The event name is `sql-erd:agent-table-focus` and the dispatcher emits the validated payload.

- [ ] **Step 4: Wire the Agent link click**

  Extend `AgentResourceLink` with optional focus payload. On focus link click, stage the payload and dispatch the event before Next.js navigation. Keep normal generated-ERD links labeled `ERD 및 DDL 열기` and unchanged.

- [ ] **Step 5: Verify GREEN and commit**

  Re-run `agent-feature.test.mjs`; expect exit code 0.

  Commit:

  ```text
  test: SQLtoERD focus resource handoff를 검증 (#1293)
  feat: Agent focus metadata를 SQLtoERD로 전달 (#1293)
  ```

### Task 5: SQLtoERD Canvas focus rendering과 interaction guard

**Files:**
- Create: `apps/frontend/src/features/sql-erd/utils/table-focus.ts`
- Create: `apps/frontend/src/features/sql-erd/components/sql-erd-table-focus-context.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-table-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-relation-shape.tsx`
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`

**Interfaces:**
- Consumes: Task 4 one-shot payload and current loaded session revision.
- Produces: `getSqlErdTableFocusRole(tableId, focus)` and `getSqlErdRelationFocusRole(relationId, focus)` returning `primary | related | dimmed | normal`.
- Produces: React focus context read by table/relation shape renderers without changing tldraw shape props.

- [ ] **Step 1: Write failing pure focus role tests**

  Compile `utils/table-focus.ts` in the SQLtoERD test harness. Assert primary/related/dimmed table roles, selected/dimmed relation roles, inactive focus behavior and payload revision/session mismatch rejection.

- [ ] **Step 2: Run SQLtoERD frontend test to verify RED**

  Run: `node scripts/sql-erd/test.mjs` in `apps/frontend`.

  Expected: FAIL because the focus module does not exist.

- [ ] **Step 3: Implement focus context and renderer styles**

  Add a provider with inactive default. Primary tables keep full opacity and receive a blue emphasis ring; related tables keep full opacity with a weaker cyan ring; dimmed tables use `filter: blur(2px)`, opacity near `0.22` and disabled pointer events. Selected relations remain normal; dimmed relations use reduced opacity/blur and no hit-target pointer events.

- [ ] **Step 4: Write failing lifecycle and interaction contract tests**

  Add test assertions that `SqlErdPanel` consumes staged payload only after matching session revision, listens for same-session events, clears on session ID change, and renders a `전체 보기` control. Assert Canvas clears a selected table/relation when it becomes dimmed and blocks pointer selection for dimmed table/relation while leaving Tldraw pan/zoom active.

- [ ] **Step 5: Implement panel lifecycle, banner and guards**

  Keep focus in `SqlErdPanel` React state. Consume staged storage after current view session load, discard mismatched revision, and apply same-session events. Pass focus through `CanvasShell` and `SqlErdCanvas`; wrap `TldrawSurface` children with the provider; add a selection-clearing sync component and early pointer guards for dimmed IDs. Render the banner above Canvas with feature label, primary/related counts, confidence label and `전체 보기`.

- [ ] **Step 6: Verify GREEN and commit**

  Run `node scripts/sql-erd/test.mjs` and `npm.cmd run lint` in `apps/frontend`.

  Expected: SQLtoERD tests and TypeScript checks pass.

  Commit:

  ```text
  test: SQLtoERD Canvas focus 동작을 검증 (#1293)
  feat: SQLtoERD 테이블 집중 보기 UI를 추가 (#1293)
  ```

### Task 6: API 계약, 전체 검증과 PR

**Files:**
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/sqltoerd-api.md`

**Interfaces:**
- Documents: tool schemas, session clarification, compact refs, 9,000-character projection, resource metadata, transient UI behavior and read-only/Activity Log exclusion.

- [ ] **Step 1: Write failing contract assertions**

  Extend App Server SQLtoERD Agent tests to require both tool names, exact risk/execution modes, metadata version/view, direct-FK rule, revision stale behavior, `집중 보기 열기`, no URL focus params and no Activity Log side effect.

- [ ] **Step 2: Run contract test to verify RED**

  Run: `npm.cmd run build; node scripts/agent/sql-erd-tools.test.mjs`.

  Expected: FAIL because the API docs do not contain the required contract.

- [ ] **Step 3: Update current API documents**

  Update only `docs/api/agent-api.md` and `docs/api/sqltoerd-api.md`; do not edit `docs/api/incoming`. State that blur is not security, session data is unchanged, and malformed/stale focus falls back to the normal ERD view.

- [ ] **Step 4: Run focused and package verification**

  Run:

  ```text
  apps/app-server: npm.cmd run build
  apps/app-server: node scripts/agent/sql-erd-tools.test.mjs
  apps/app-server: npm.cmd test
  apps/app-server: npm.cmd run format:check
  apps/ai-worker: python -m pytest tests/test_agent_processor.py tests/test_agent_planner_evaluation.py -q
  apps/ai-worker: python -m ruff check app tests
  apps/frontend: node --experimental-strip-types src/features/agent/agent-feature.test.mjs
  apps/frontend: node scripts/sql-erd/test.mjs
  apps/frontend: npm.cmd run lint
  apps/frontend: npm.cmd run format:check
  repository root: git diff --check
  ```

  Install missing dependencies only from the checked-in lockfiles/requirements. Record any environment-only failure with the exact command and cause; do not report it as passing.

- [ ] **Step 5: Self review the complete diff**

  Check the approved design section by section, scan for secrets/raw SQL/model payloads, confirm no DB migration/Activity Log/common-area change, inspect `git diff origin/dev...HEAD`, and fix every actionable issue with a failing regression test first.

- [ ] **Step 6: Commit docs and fixes**

  ```text
  docs: SQLtoERD Agent 집중 보기 API 계약을 추가 (#1293)
  ```

- [ ] **Step 7: Push and create a Ready PR**

  Push `feat/1293-sqltoerd-table-focus` and create a non-draft PR to `dev` titled `feat(agent,sqltoerd): 기능별 테이블 집중 보기 도구 추가`. Include `Closes #1293`, exact verification results, API-contract impact, no DB/common-area change, and SQLtoERD owner review note.
