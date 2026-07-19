# SQL ERD Focus Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQL ERD 집중 보기 도구 성공 run을 완료 상태로 저장하고, 현재 세션에서는 결과를 한 번 자동 적용하면서 수동 재적용 링크를 유지한다.

**Architecture:** App Server tool definition에 명시적인 post-execution disposition을 추가하고 기존 단일 트랜잭션의 step/run 상태 전이를 세 갈래로 확장한다. Frontend는 완료 run의 검증된 `table_focus` resource ref만 읽어 현재 세션과 일치할 때 idempotency key로 한 번 적용한다.

**Tech Stack:** NestJS/TypeScript, PostgreSQL transaction layer, Next.js/React, Node.js `assert` 기반 repository tests

## Global Constraints

- DB schema와 migration은 변경하지 않는다.
- direct FK, `sessionRevision`, `modelFingerprint` 검증은 유지한다.
- 다른 SQL ERD 세션으로 자동 이동하지 않는다.
- 전체 suite 대신 Agent/SQL ERD 동작을 직접 다루는 테스트만 실행한다.

---

### Task 1: App Server 실행 후 상태 계약

**Files:**
- Modify: `apps/app-server/src/modules/agent/types/agent-tool.types.ts`
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-logging.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-execution.service.ts`
- Modify: `apps/app-server/scripts/agent/logging.test.mjs`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

**Interfaces:**
- Produces: `AgentToolPostExecutionDisposition = "continue_planning" | "wait_for_user_input" | "complete_run"`
- Produces: `AgentToolDefinition.postExecutionDisposition?: AgentToolPostExecutionDisposition`
- Consumes: existing `completeToolStepAndAdvance` transaction and sanitized `resourceRefs`

- [ ] **Step 1: Write failing execution and transaction tests**

Update the focus execution fixture to declare `postExecutionDisposition: "complete_run"` and assert:

```js
assert.equal(result.status, "completed");
assert.equal(result.run.status, "completed");
assert.equal(completion.input.postExecutionDisposition, "complete_run");
assert.deepEqual(outboxPublisherService.calls, []);
```

Add a logging test with a focused resource ref and assert the single transaction completes the step and run, preserves the resource ref, records the final answer, and does not re-arm the outbox.

- [ ] **Step 2: Run focused tests and confirm the new assertions fail**

Run after the existing build artifact is available:

```powershell
npm.cmd run build
node scripts/agent/logging.test.mjs
node scripts/agent/execution.test.mjs
```

Expected: the new `complete_run` assertions fail because the boolean contract still produces `waiting_user_input`.

- [ ] **Step 3: Implement the explicit disposition contract**

Define the union and replace the boolean property:

```ts
export type AgentToolPostExecutionDisposition =
  | "continue_planning"
  | "wait_for_user_input"
  | "complete_run";

postExecutionDisposition?: AgentToolPostExecutionDisposition;
```

Set the SQL ERD focus definition to:

```ts
postExecutionDisposition: "complete_run",
```

Pass `postExecutionDisposition` into `completeToolStepAndAdvance`. In the same database transaction, the `complete_run` branch updates `agent_runs` to `completed`, stores the formatted answer in both `message` and `final_answer`, inserts the assistant message and `run_completed` log, and returns `queuedNextPlannerTurn: false`. Clarifications explicitly use `wait_for_user_input`; missing disposition retains `continue_planning` and the existing tool-call-limit fallback.

- [ ] **Step 4: Run the two focused App Server tests**

```powershell
npm.cmd run build
node scripts/agent/logging.test.mjs
node scripts/agent/execution.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the App Server change**

```powershell
git add apps/app-server/src/modules/agent/types/agent-tool.types.ts apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts apps/app-server/src/modules/agent/agent-logging.service.ts apps/app-server/src/modules/agent/agent-execution.service.ts apps/app-server/scripts/agent/logging.test.mjs apps/app-server/scripts/agent/execution.test.mjs
git commit -m "fix: SQL ERD 집중 보기 run을 완료한다"
```

### Task 2: 같은 SQL ERD 세션 자동 적용

**Files:**
- Modify: `apps/frontend/src/features/agent/resource-links.ts`
- Modify: `apps/frontend/src/features/agent/components/agent-chat-widget.tsx`
- Modify: `apps/frontend/src/features/agent/agent-feature.test.mjs`

**Interfaces:**
- Produces: `applyAgentSqlErdTableFocus(run, requestContext, appliedActionKeys, applyFocus): boolean`
- Consumes: `parseSqlErdAgentTableFocusResource` and `stageSqlErdAgentTableFocus`

- [ ] **Step 1: Write failing client-action tests**

Add tests that call the pure helper twice with the same completed run and same SQL ERD context, verifying the injected `applyFocus` callback runs once. Call it with a different session and verify zero applications. Retain the existing assertion that `getAgentResourceLinks` still returns `집중 보기 열기`.

```js
const appliedKeys = new Set();
const appliedFocuses = [];
applyAgentSqlErdTableFocus(run, sameSessionContext, appliedKeys, (focus) => appliedFocuses.push(focus));
applyAgentSqlErdTableFocus(run, sameSessionContext, appliedKeys, (focus) => appliedFocuses.push(focus));
assert.deepEqual(appliedFocuses, [expectedFocus]);
```

- [ ] **Step 2: Run the focused frontend test and confirm failure**

```powershell
node --experimental-strip-types src/features/agent/agent-feature.test.mjs
```

Expected: FAIL because `applyAgentSqlErdTableFocus` is not exported.

- [ ] **Step 3: Implement and wire the idempotent action**

The helper accepts only completed runs, only completed steps, validated focus refs, and matching `{ surface: "sql_erd", sessionId }`. Build the key as:

```ts
const actionKey = `${run.id}:${step.id}:${focus.modelFingerprint}`;
```

Call `applyFocus(focus)` before adding the key so a thrown application can retry. In `AgentChatWidget`, keep `useRef(new Set<string>())`, read the live browser request context, and call the helper from the existing `handleRunClientAction` before the Meeting action. Keep `AgentResourceLinks` rendering unchanged.

- [ ] **Step 4: Run the focused frontend test**

```powershell
node --experimental-strip-types src/features/agent/agent-feature.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the Frontend change**

```powershell
git add apps/frontend/src/features/agent/resource-links.ts apps/frontend/src/features/agent/components/agent-chat-widget.tsx apps/frontend/src/features/agent/agent-feature.test.mjs
git commit -m "fix: 현재 ERD에 집중 보기 결과를 자동 적용한다"
```

### Task 3: 사용자 문구와 API 계약

**Files:**
- Modify: `apps/app-server/src/modules/agent/agent-read-result-formatter.ts`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`
- Modify: `docs/api/agent-api.md`

**Interfaces:**
- Consumes: completed focus result and existing resource link contract
- Produces: neutral focus completion copy and documented completed-run behavior

- [ ] **Step 1: Change the formatter assertion first**

```js
assert.match(answer, /로그 관련 집중 보기 결과를 준비했습니다/);
assert.doesNotMatch(answer, /집중 표시했습니다/);
```

- [ ] **Step 2: Update the formatter and API text**

Use:

```ts
`${title ?? "현재 ERD"}에서 ${featureLabel ?? "요청한 기능"} 관련 집중 보기 결과를 준비했습니다.`
```

Document that successful `focus_sql_erd_tables` runs finish as `completed`, retain the step `resourceRefs`, auto-apply only for the current session, and preserve the link as fallback.

- [ ] **Step 3: Run only the final targeted checks**

```powershell
npm.cmd run build
node scripts/agent/logging.test.mjs
node scripts/agent/execution.test.mjs
node scripts/agent/sql-erd-tools.test.mjs
node --experimental-strip-types src/features/agent/agent-feature.test.mjs
```

Run the first four commands from `apps/app-server` and the last from `apps/frontend`. Expected: all PASS.

- [ ] **Step 4: Self-review and commit**

```powershell
git diff --check
git diff origin/dev...HEAD --stat
git add apps/app-server/src/modules/agent/agent-read-result-formatter.ts apps/app-server/scripts/agent/execution.test.mjs docs/api/agent-api.md docs/superpowers/plans/2026-07-20-sql-erd-focus-completion.md
git commit -m "docs: SQL ERD 집중 보기 완료 계약을 정리한다"
```
