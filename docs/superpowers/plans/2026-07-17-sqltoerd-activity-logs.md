# SQLtoERD Activity Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLtoERD의 의미 있는 저장 결과 일곱 종류를 공통 append-only Activity Log에 원자적으로 기록한다.

**Architecture:** 공통 action registry와 Postgres enum을 먼저 확장하고, SQLtoERD 전용 pure builder가 안전한 metadata 및 note diff를 만든다. `SqlErdService`는 기존 domain transaction 안에서 builder 결과를 `ActivityLogService.append`로 전달한다.

**Tech Stack:** NestJS, TypeScript, PostgreSQL enum migration, Node.js assertion tests

## Global Constraints

- `ActivityLogService`만 사용하고 `activity_logs`에 직접 SQL을 쓰지 않는다.
- SQLtoERD 변경과 log append는 동일한 `DatabaseTransaction`에서 commit 또는 rollback된다.
- meetingId와 recordingId를 입력받거나 저장하지 않는다.
- SQL source, model/layout raw JSON, token, secret, OAuth payload를 metadata에 넣지 않는다.
- note 본문 projection은 공백 정규화 후 최대 500자이며 민감정보 감지 시 생략한다.
- 조회, polling, sync, lease, drag, resize, viewport, presence는 기록하지 않는다.

---

### Task 1: Registry and metadata builders

**Files:**
- Create: `apps/app-server/scripts/sqltoerd/activity-log.test.mjs`
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-activity-log.ts`
- Modify: `apps/app-server/src/common/activity-log.service.ts`
- Create: `db/migrations/085_add_sql_erd_activity_log_actions.sql`
- Modify: `docs/ActivityLogRegistry.md`
- Modify: `db/README.md`

**Interfaces:**
- Produces: `buildSqlErdSessionCreatedActivity`, `buildSqlErdSessionChangedActivities`, `buildSqlErdSessionDeletedActivity`, `buildSqlErdNoteActivities` returning `ActivityLogInput` values.

- [ ] Write tests that import the proposed builders and assert all seven registered actions, exact metadata keys, 500-character truncation, sensitive-content omission, and note diff filtering.
- [ ] Run `npm run build && node scripts/sqltoerd/activity-log.test.mjs` and verify RED because the builder module/actions do not exist.
- [ ] Add the seven values to `ACTIVITY_LOG_ACTIONS` and migration 085.
- [ ] Implement the pure builders with stable `sqltoerd:<action>:<targetId>:<revision>` keys.
- [ ] Register each action and exact metadata shape in `docs/ActivityLogRegistry.md` and add migration 085 to `db/README.md`.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Domain transaction integration

**Files:**
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.service.ts`
- Modify: `apps/app-server/scripts/sqltoerd/test.mjs`
- Modify: `apps/app-server/scripts/sqltoerd/operation-delivery.test.mjs`
- Modify: `apps/app-server/scripts/sqltoerd/source-snapshot.test.mjs`
- Modify: `apps/app-server/scripts/sqltoerd/schema-mutation.test.mjs`
- Modify: `apps/app-server/scripts/sqltoerd/concurrency.integration.test.mjs`

**Interfaces:**
- Consumes: Task 1 builder functions and `ActivityLogService.append(transaction, input)`.
- Produces: transactional Activity Log side effects for every approved SQLtoERD mutation path.

- [ ] Extend fake Activity Log services and tests to assert session create/rename/delete, schema publish, Agent create/replace, and note create/update/delete calls with the exact transaction object.
- [ ] Run the focused SQLtoERD tests and verify RED because `SqlErdService` does not append Activity Logs.
- [ ] Inject `ActivityLogService` into `SqlErdService`.
- [ ] Append session-created logs in normal/plural and Agent creation transactions; skip Agent retry ledger hits.
- [ ] Refactor snapshot `updateSession` into one locked transaction and append only actual schema/title/note changes.
- [ ] Append rename and delete logs after their successful updates.
- [ ] Append note diff logs after operations_v1 operation/outbox writes, skipping geometry-only patches and retry returns.
- [ ] Append schema logs after source publish and Agent replacement, using user and agent actors respectively.
- [ ] Re-run focused tests and verify GREEN, including an append failure that rejects the domain mutation callback.

### Task 3: Contract documentation and full verification

**Files:**
- Modify: `docs/api/sqltoerd-api.md`

**Interfaces:**
- Documents: Activity Log side effects without changing request/response payloads.

- [ ] Document the seven commit side effects, excluded interactions, user/agent actor rule, note 500-character projection, and absence of Meeting IDs.
- [ ] Run `npm run build` in `apps/app-server` and verify exit code 0.
- [ ] Run `node scripts/sqltoerd/activity-log.test.mjs`, `node scripts/sqltoerd/test.mjs`, and the affected SQLtoERD focused tests and verify all pass.
- [ ] Run `npm run format:check` and the full `npm test`; report any environment-only integration skip separately.
- [ ] Review `git diff --check`, `git status --short`, and the requirement checklist before completion.
