# SQLtoERD Editing Regressions Implementation Plan

> **For agentic workers:** Execute each task test-first and stop when a regression test fails for an unexpected reason.

**Goal:** SQLtoERD schema 편집, annotation resize, split SQL diff, Agent 결과 session 이동의 회귀를 수정하고 DDL semantic round trip을 안정화한다.

**Architecture:** 기존 normalized source snapshot 흐름을 유지한다. Pure dialect/default/diff helper를 테스트한 뒤 Canvas와 Panel에 연결하며, Agent link는 URL 생성 계약을 바꾸지 않고 session route의 query 반응성을 수정한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, tldraw 5, CodeMirror 6, `diff`, `node-sql-parser`, Node assertion tests

## Global Constraints

- 기준 branch는 최신 `origin/dev`에서 분기한 `fix/1424-sqltoerd-editing-regressions`이다.
- API, DB schema, migration, operation payload를 변경하지 않는다.
- 1~8번을 모두 구현하되 unrelated refactor는 하지 않는다.
- production code보다 실패 회귀 테스트를 먼저 작성한다.

### Task 1: Dialect 타입과 default round trip

**Files:**
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/utils/model-to-sql.ts`
- Modify: `apps/frontend/src/features/sql-erd/utils/ddl-parser.ts`
- Modify: `apps/frontend/src/features/sql-erd/utils/sql-diff-apply.ts`

- [ ] MySQL/SQLite UUID normalization과 boolean/null/current date/time default round-trip 실패 테스트를 추가한다.
- [ ] `node scripts/sql-erd/test.mjs`가 기대한 이유로 실패하는지 확인한다.
- [ ] normalized model과 SQL을 함께 반환하고 default AST formatter를 확장한다.
- [ ] SQLtoERD test를 다시 실행해 통과시킨다.

### Task 2: FK 삭제와 annotation resize

**Files:**
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/utils/canvas-selection.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-canvas.tsx`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-note-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-frame-shape.tsx`
- Modify: `apps/frontend/src/features/sql-erd/shapes/sql-erd-text-shape.tsx`

- [ ] relation Delete shortcut 및 resize contract 실패 테스트를 추가한다.
- [ ] relation 삭제를 기존 FK diff callback에 연결하고 tldraw 기본 삭제를 차단한다.
- [ ] note/frame/text에 `resizeBox`를 연결하고 locked frame guard를 유지한다.
- [ ] transform patch가 width/height를 저장하는 기존 회귀 테스트를 함께 실행한다.

### Task 3: Inspector lock UX, 저장 상태, split diff

**Files:**
- Modify: `apps/frontend/scripts/sql-erd/test.mjs`
- Modify: `apps/frontend/src/features/sql-erd/utils/sql-diff-apply.ts`
- Modify: `apps/frontend/src/features/sql-erd/components/sql-erd-panel.tsx`

- [ ] split row alignment, line number, operation sequence 비노출 테스트를 추가한다.
- [ ] Inspector/diff dialog에 source lock 상태와 Apply 비활성 이유를 표시한다.
- [ ] `Workspace operation N`과 `Workspace source operation N`을 사용자 친화적 저장 상태로 교체한다.
- [ ] 좌우 SQL diff를 구현하고 긴 diff truncation 안내를 한글화한다.

### Task 4: Agent result same-route navigation

**Files:**
- Modify: `apps/frontend/src/features/sql-erd/session-page.tsx`
- Modify: `apps/frontend/src/features/sql-erd/utils/session-navigation.ts`
- Modify: `apps/frontend/src/features/sql-erd/sql-erd-workspace-location.test.mjs`
- Modify: `apps/frontend/src/features/agent/agent-feature.test.mjs`

- [ ] 같은 pathname에서 query의 session ID가 바뀌는 회귀 테스트를 추가한다.
- [ ] session page가 `useSearchParams()`에서 현재 session ID를 파생하도록 수정한다.
- [ ] resource link sanitization 및 label 테스트가 그대로 통과하는지 확인한다.

### Task 5: Verification and PR

- [ ] `cd apps/frontend && node scripts/sql-erd/test.mjs`
- [ ] `cd apps/frontend && node src/features/agent/agent-feature.test.mjs`
- [ ] `cd apps/frontend && node src/features/sql-erd/sql-erd-workspace-location.test.mjs`
- [ ] `cd apps/frontend && node scripts/sql-erd-realtime.test.mjs`
- [ ] `cd apps/frontend && npm.cmd run lint`
- [ ] `cd apps/frontend && npm.cmd run format:check`
- [ ] `cd apps/frontend && npm.cmd test`
- [ ] `cd apps/frontend && npm.cmd run build`
- [ ] `git diff --check`와 self review를 수행한다.
- [ ] convention 형식으로 commit, push, `dev` 대상 PR을 생성한다.

