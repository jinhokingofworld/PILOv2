# SQLtoERD Session Clarification Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 SQLtoERD session이 있는 Workspace에서 `inspect_sql_erd_schema`가 서버 예외 대신 후보와 selection token을 반환하고 사용자 입력을 기다리도록 한다.

**Architecture:** SQLtoERD tool의 기존 `prepareExecution()`을 공통 `AgentExecutionService`가 호출하도록 tool execution mode를 `contextual`로 맞춘다. 실제 registry와 execution service를 함께 사용하는 회귀 테스트로 `auto` 경로의 예외 노출을 재현한다. 후보의 `selectionToken`은 비밀 token이 아니라 session UUID이므로, Agent의 실행·저장·조회 안전 필터가 정확한 UUID 형식의 해당 키만 보존하도록 제한적으로 허용한다.

**Tech Stack:** NestJS, TypeScript, Node.js assertion tests

## Global Constraints

- 기준 branch는 최신 `origin/dev`의 `3bc32d7b97663206c7e537ae5c750cb87154b7ea`에서 분기한 `fix/1330-sqltoerd-session-clarification`이다.
- 관련 Issue는 `#1330`이다.
- `inspect_sql_erd_schema`는 read-only low-risk tool이며 confirmation을 만들지 않는다.
- session 선택 우선순위와 후보 payload는 `docs/api/agent-api.md`의 현재 계약을 유지한다.
- API 계약, DB schema, migration, Frontend는 변경하지 않는다.
- 일반 token과 비 UUID `selectionToken`은 기존처럼 Agent payload에서 제거하거나 거부한다.
- 여러 session 전체를 동시에 검색하는 기능은 이 수정 범위에 포함하지 않는다.

---

### Task 1: 실제 Agent 실행 경로의 다중 session 회귀 테스트

**Files:**
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

**Interfaces:**
- Consumes: `SqlErdAgentToolsService.listDefinitions()`과 `AgentToolRegistryService`의 실제 definition metadata.
- Produces: 여러 session에서 `AgentExecutionService.executeLatestPlannedTool()`이 `waiting_user_input`과 `multiple_sessions` 후보를 저장한다는 회귀 테스트.

- [ ] **Step 1: 실제 SQLtoERD tool을 smoke registry에 등록한다**

  `SqlErdAgentToolsService`를 import하고, 두 session을 반환하는 최소 `SmokeSqlErdService`를 만든다. planner fixture의 `executionMode`는 hard-code하지 않고 실제 inspect definition에서 읽는다.

- [ ] **Step 2: 다중 session clarification 기대값을 작성한다**

  다음 결과를 검증한다.

  ```js
  assert.equal(result.status, "waiting_user_input");
  assert.equal(result.run.status, "waiting_user_input");
  assert.equal(outputSummary.reason, "multiple_sessions");
  assert.equal(outputSummary.candidates.length, 2);
  assert.equal(outputSummary.candidates[0].selectionToken, SQL_ERD_SESSION_ID);
  ```

- [ ] **Step 3: RED를 확인한다**

  Run: `npm.cmd run build; node scripts/agent/execution.test.mjs` in `apps/app-server`.

  Expected: FAIL because the registered definition is `auto`, so `prepareExecution()` is skipped and the run becomes failed instead of `waiting_user_input`.

- [ ] **Step 4: 테스트 commit을 만든다**

  ```text
  test: SQLtoERD 다중 세션 실행 경로를 재현 (#1330)
  ```

### Task 2: Inspect tool execution mode 정합성 복구

**Files:**
- Modify: `apps/app-server/src/modules/agent/tools/sql-erd-agent-tools.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-execution.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent-logging.service.ts`
- Modify: `apps/app-server/src/modules/agent/agent.service.ts`
- Modify: `apps/app-server/scripts/agent/sql-erd-tools.test.mjs`
- Modify: `apps/app-server/scripts/agent/logging.test.mjs`
- Modify: `apps/app-server/scripts/agent/run-api.test.mjs`
- Modify: `apps/ai-worker/evals/agent_planner_korean_v1.json`

**Interfaces:**
- Changes: `inspect_sql_erd_schema.executionMode` from `auto` to `contextual`.
- Changes: exact `selectionToken` keys with UUID values survive execution sanitization, storage validation and run API sanitization.
- Preserves: `prepareExecution()`의 `execute | needs_clarification` 결과와 기존 input/output schema.

- [x] **Step 1: SQLtoERD definition 기대값을 contextual로 변경한다**

  ```js
  assert.equal(inspectDefinition.executionMode, "contextual");
  ```

- [x] **Step 2: selection token 저장 경계의 RED를 확인한다**

  Logging service에 UUID `selectionToken` 후보를 저장하는 테스트와 run API가 이를 반환하는 테스트를 추가한다. 기존 구현에서는 logging이 forbidden key로 거부하고 run API가 값을 제거하는지 확인한다.

- [x] **Step 3: 최소 production 수정을 적용한다**

  `inspectSqlErdSchemaDefinition()`에서 `executionMode: "contextual"`로 변경한다. Agent 실행·logging·run API sanitizer는 정확한 `selectionToken` 키와 UUID 값의 조합만 허용하며, 나머지 token key 정책은 유지한다. `executeInspect()`의 예외 처리는 건드리지 않는다.

- [x] **Step 4: GREEN과 회귀 범위를 확인한다**

  Run in `apps/app-server`:

  ```text
  npm.cmd run build
  node scripts/agent/execution.test.mjs
  node scripts/agent/sql-erd-tools.test.mjs
  node scripts/agent/logging.test.mjs
  node scripts/agent/run-api.test.mjs
  node scripts/agent/agent-job.test.mjs
  ```

  Expected: all commands exit 0; multiple sessions enter `waiting_user_input`, while direct selection and single-session inspection tests remain green.

- [x] **Step 5: 수정 commit을 만든다**

  ```text
  fix: SQLtoERD 다중 세션 clarification을 복구 (#1330)
  ```

### Task 3: 최종 검증과 PR

**Files:**
- Review only: `docs/api/agent-api.md`

**Interfaces:**
- Confirms: 구현이 기존 contextual 실행 및 SQLtoERD session 선택 계약과 일치하며 문서 변경이 필요하지 않다.

- [ ] **Step 1: 전체 변경을 self review한다**

  `git diff origin/dev...HEAD`, `git diff --check`, test fixture의 secret/raw model 노출 여부와 공통 영역 변경 유무를 확인한다.

- [ ] **Step 2: 최종 검증을 새로 실행한다**

  Run in `apps/app-server`:

  ```text
  npm.cmd run build
  node scripts/agent/execution.test.mjs
  node scripts/agent/sql-erd-tools.test.mjs
  npm.cmd run format:check
  ```

- [ ] **Step 3: Ready PR을 생성한다**

  Push `fix/1330-sqltoerd-session-clarification` and create a non-draft PR to `dev` titled `fix(agent,sqltoerd): 다중 세션 clarification 실행 복구`. Include `Closes #1330`, the root cause, exact verification results, no API/DB/common-area change, and the unperformed provider/browser E2E reason.
