# Agent stale confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLtoERD schema 교체와 Calendar 일정 수정이 confirmation 이후 stale 상태를 덮어쓰지 않게 한다.

**Architecture:** confirmation plan에 서버가 읽은 상태 token을 저장하고 각 도메인 transaction의 row lock 직후 compare-before-write를 수행한다. Agent adapter는 저장된 plan에서만 token을 복원하며 공개 HTTP API와 DB schema는 유지한다.

**Tech Stack:** NestJS, TypeScript, PostgreSQL transaction, Node.js assert 기반 회귀 스크립트

## Global Constraints

- DB migration을 추가하지 않는다.
- SQLtoERD는 revision과 model fingerprint 중 하나라도 다르면 거부한다.
- Calendar는 기존 `updatedAt`을 concurrency token으로 사용한다.
- stale이면 mutation, snapshot, operation, Activity Log, 외부 sync outbox를 만들지 않는다.
- 전체 test suite 대신 관련 스크립트와 App Server build만 실행한다.

---

### Task 1: SQLtoERD confirmation token과 transaction guard

**Files:**
- Create: `apps/app-server/src/modules/sql-erd/sql-erd-model-fingerprint.ts`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-table-focus.ts`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/sql-erd/sql-erd.service.ts`
- Test: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
- Test: `apps/app-server/scripts/sqltoerd/schema-mutation.test.mjs`

**Interfaces:**
- Produces: `createSqlErdModelFingerprint(modelJson: unknown): string`
- Produces: replace input의 `expectedSessionRevision: number`, `expectedModelFingerprint: string`
- Consumes: 현재 operations_v1 session row와 기존 agent operation idempotency ledger

- [ ] **Step 1: Agent plan과 domain stale 동작을 기대하는 실패 테스트를 작성한다.**

```js
assert.equal(plan.call.expectedSessionRevision, session.revision);
assert.equal(plan.call.expectedModelFingerprint, createSqlErdModelFingerprint(session.modelJson));
await assert.rejects(() => replace({ expectedSessionRevision: 4 }), /changed/);
```

- [ ] **Step 2: 두 SQLtoERD 스크립트를 실행해 token 누락 때문에 실패하는 RED를 확인한다.**

Run: `node apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
Run: `node apps/app-server/scripts/sqltoerd/schema-mutation.test.mjs`
Expected: expected token 또는 stale conflict assertion 실패

- [ ] **Step 3: fingerprint helper와 confirmation input을 최소 구현한다.**

```ts
call: {
  schemaSpec,
  currentSessionId: session.id,
  expectedSessionRevision: session.revision,
  expectedModelFingerprint: createSqlErdModelFingerprint(session.modelJson)
}
```

- [ ] **Step 4: idempotency 조회 뒤 transaction stale guard를 구현한다.**

```ts
if (
  Number(session.revision) !== expected.revision ||
  createSqlErdModelFingerprint(session.model_json) !== expected.modelFingerprint
) {
  throw conflict("sqltoerd session changed; review the schema again");
}
```

- [ ] **Step 5: 두 SQLtoERD 스크립트를 다시 실행해 GREEN을 확인한다.**

### Task 2: Calendar updatedAt confirmation guard

**Files:**
- Modify: `apps/app-server/src/modules/agent/tools/calendar-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/calendar/calendar.service.ts`
- Test: `apps/app-server/scripts/agent/calendar-tools.test.mjs`
- Test: `apps/app-server/scripts/calendar/test.mjs`

**Interfaces:**
- Produces: resolved update input의 `expectedUpdatedAt: string`
- Consumes: `CalendarService.updateEvent(..., { expectedUpdatedAt })`

- [ ] **Step 1: Agent plan 전달과 domain stale 거부 실패 테스트를 작성한다.**

```js
assert.equal(plan.call.expectedUpdatedAt, event.updatedAt);
await assert.rejects(
  () => service.updateEvent(userId, workspaceId, "1", changes, { expectedUpdatedAt: oldValue }),
  /changed/
);
```

- [ ] **Step 2: 두 Calendar 스크립트를 실행해 expected token 누락 때문에 실패하는 RED를 확인한다.**

Run: `node apps/app-server/scripts/agent/calendar-tools.test.mjs`
Run: `node apps/app-server/scripts/calendar/test.mjs`
Expected: expectedUpdatedAt 전달 또는 conflict assertion 실패

- [ ] **Step 3: Calendar tool이 저장된 plan에서 token을 복원하도록 구현한다.**

```ts
buildConfirmationInput: (plan) => ({
  eventId: plan.target.resourceId,
  changes: plan.after,
  expectedUpdatedAt: plan.call.expectedUpdatedAt
})
```

- [ ] **Step 4: Calendar transaction row lock 직후 updatedAt 비교를 구현한다.**

```ts
if (options?.expectedUpdatedAt !== undefined && this.toIsoString(existing.updated_at) !== options.expectedUpdatedAt) {
  throw conflict("Calendar event changed; review the latest event before updating");
}
```

- [ ] **Step 5: 두 Calendar 스크립트를 다시 실행해 GREEN을 확인한다.**

### Task 3: 계약 문서와 최소 통합 검증

**Files:**
- Modify: `docs/api/agent-api.md`
- Modify: `docs/api/sqltoerd-api.md`

**Interfaces:**
- Produces: stale confirmation의 server-owned token, fail-closed, no-side-effect 계약

- [ ] **Step 1: Agent와 SQLtoERD API 문서에 재검증 규칙을 반영한다.**
- [ ] **Step 2: 관련 네 스크립트만 실행한다.**

Run: `node apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
Run: `node apps/app-server/scripts/sqltoerd/schema-mutation.test.mjs`
Run: `node apps/app-server/scripts/agent/calendar-tools.test.mjs`
Run: `node apps/app-server/scripts/calendar/test.mjs`
Expected: 모두 exit 0

- [ ] **Step 3: App Server build를 한 번 실행한다.**

Run: `npm run build`
Expected: exit 0

