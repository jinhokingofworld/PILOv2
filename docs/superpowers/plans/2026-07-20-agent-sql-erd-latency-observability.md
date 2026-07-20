# SQLtoERD Agent Latency Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLtoERD 집중 보기 Agent 경로의 queue, Router, Planner, execution handoff, tool preparation/execution/advance 시간을 개인정보 안전한 CloudWatch structured log로 측정한다.

**Architecture:** AI Worker와 App Server의 Agent 모듈에 각각 작은 latency observer를 두고, 공통 `agent_latency` JSON 계약으로 stdout logger에 기록한다. observer는 SQLtoERD surface와 inspect/focus tool만 허용하고 raw 식별자는 해시된 `trace_key`로 대체하며, 로깅 실패는 기존 Agent 실행에 영향을 주지 않는다.

**Tech Stack:** Python 3 dataclass/logging/time.monotonic, pytest, NestJS/TypeScript Logger/performance.now, Node assertion scripts, CloudWatch Logs Insights

## Execution Status

- [x] Task 1: AI Worker privacy-safe latency observer
- [x] Task 2: AI Worker planning-stage instrumentation
- [x] Task 3: App Server tool-stage instrumentation
- [x] Task 4: CloudWatch runbook and focused regression verification

## Global Constraints

- API request/response, DB schema, migration, frontend 동작을 변경하지 않는다.
- 사용자 발화, SQL source/model, tool/provider payload, raw UUID, token을 로그에 넣지 않는다.
- latency logger 실패는 Agent 실행 결과, confirmation, 상태 전이, transaction 순서를 바꾸지 않는다.
- 새 이벤트는 `surface = sql_erd`와 `inspect_sql_erd_schema`/`focus_sql_erd_tables` 경로로 제한한다.
- 각 production 변경은 먼저 같은 동작을 요구하는 실패 테스트를 실행한다.
- Issue #1607의 체크리스트 단위로 커밋하고 PR base는 `dev`로 한다.

---

### Task 1: AI Worker privacy-safe latency observer

**Files:**
- Create: `apps/ai-worker/app/agent_latency.py`
- Create: `apps/ai-worker/tests/test_agent_latency.py`

**Interfaces:**
- Produces: `AgentLatencyObserver.start() -> float`
- Produces: `AgentLatencyObserver.observe(*, run_id, stage, outcome, started_at=None, elapsed_ms=None, turn_sequence=None, surface=None, tool_name=None, retrieval_mode=None, provider_*_tokens=None, failure_type=None) -> None`
- Produces: `agent_latency_trace_key(run_id: str) -> str`

- [ ] **Step 1: Write the failing observer contract tests**

Add tests that construct the observer with a fake monotonic clock and event sink, then assert:

```python
observer = AgentLatencyObserver(now=lambda: 1.25, emit=events.append)
observer.observe(
    run_id=RUN_ID,
    stage="router",
    outcome="success",
    started_at=1.0,
    turn_sequence=2,
    surface="sql_erd",
    retrieval_mode="llm_router",
    provider_total_tokens=21,
)
assert events == [{
    "event": "agent_latency",
    "component": "ai_worker",
    "stage": "router",
    "outcome": "success",
    "elapsed_ms": 250,
    "trace_key": agent_latency_trace_key(RUN_ID),
    "turn_sequence": 2,
    "surface": "sql_erd",
    "retrieval_mode": "llm_router",
    "provider_total_tokens": 21,
}]
```

Also assert non-SQLtoERD events are ignored, unsupported tool/stage/outcome/failure values are omitted or normalized to bounded values, raw UUID/prompt/token/payload sentinels are absent from serialized events, and an emit exception does not escape.

- [ ] **Step 2: Run the tests and verify RED**

Run: `C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests/test_agent_latency.py -q`

Expected: collection fails with `ModuleNotFoundError: No module named 'app.agent_latency'`.

- [ ] **Step 3: Implement the minimal observer**

Create a focused module with fixed allow-lists:

```python
SQL_ERD_SURFACE = "sql_erd"
SQL_ERD_TOOL_NAMES = frozenset({"inspect_sql_erd_schema", "focus_sql_erd_tables"})
STAGES = frozenset({"queue_wait", "router", "planner", "execution_handoff", "planning_turn"})
OUTCOMES = frozenset({"success", "failure", "fallback", "clarification"})

def agent_latency_trace_key(run_id: str) -> str:
    return sha256(run_id.encode("utf-8")).hexdigest()[:16]
```

`observe` builds a new allow-listed dict rather than copying caller kwargs, clamps elapsed/token values to non-negative integers, serializes only for the production logger, and wraps `emit` in `try/except Exception`.

- [ ] **Step 4: Run observer tests and verify GREEN**

Run: `C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests/test_agent_latency.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit the observer**

```bash
git add apps/ai-worker/app/agent_latency.py apps/ai-worker/tests/test_agent_latency.py
git commit -m "perf: Agent latency 로그 계약 추가 (#1607)"
```

### Task 2: AI Worker planning-stage instrumentation

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/app/meeting_report_runtime.py`
- Modify: `apps/ai-worker/tests/test_agent_processor.py`
- Modify: `apps/ai-worker/tests/test_ai_job_runtime.py`

**Interfaces:**
- Consumes: `AgentLatencyObserver` from Task 1
- Extends: `AgentRunContext.queue_wait_ms: int | None = None`
- Produces: SQLtoERD-only `queue_wait`, `router`, `planner`, `execution_handoff`, `planning_turn` events

- [ ] **Step 1: Write failing processor and repository tests**

Add a fake observer that records calls. Exercise a SQLtoERD `process_payload` using `requestContext.surface = "sql_erd"`, Router and Planner decisions with provider token counts, and a successful handoff. Assert the ordered stages include Router, Planner, handoff and planning turn with the same turn sequence and no raw run ID. Add clarification/failure assertions for Router and Planner. Add a repository fixture with `queue_wait_ms` and assert it is mapped onto `AgentRunContext`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests/test_agent_processor.py tests/test_ai_job_runtime.py -q`

Expected: failures because the processor constructor has no observer, `AgentRunContext` has no queue field, and no stage events are emitted.

- [ ] **Step 3: Add DB-clock queue wait projection**

Extend the existing outbox join query without a schema change:

```sql
CASE
  WHEN outbox.planning_started_at IS NULL THEN NULL
  ELSE GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - outbox.planning_started_at)) * 1000)
  )::bigint
END AS queue_wait_ms
```

Map the result to `AgentRunContext.queue_wait_ms`. This keeps the calculation on the database clock and avoids comparing clocks from separate processes.

- [ ] **Step 4: Instrument the processor minimally**

Add an optional observer dependency that defaults to the production observer. In `process_payload`, measure `planning_turn`; after loading context, emit `queue_wait` when available. Wrap Router call+normalization, Planner call+normalization, and `_handoff_execution` with `start`/`observe`. Use decision usage fields, `job.turn_sequence`, `self.tool_retrieval_mode`, and a bounded exception-to-failure taxonomy. Guarding remains inside the observer, so other surfaces emit nothing.

- [ ] **Step 5: Run focused and full AI Worker tests**

Run:

```powershell
C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests/test_agent_latency.py tests/test_agent_processor.py tests/test_ai_job_runtime.py -q
C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests -q
```

Expected: all tests pass; existing planner state transitions are unchanged.

- [ ] **Step 6: Commit AI Worker instrumentation**

```bash
git add apps/ai-worker/app/agent_processor.py apps/ai-worker/app/meeting_report_runtime.py apps/ai-worker/tests/test_agent_processor.py apps/ai-worker/tests/test_ai_job_runtime.py
git commit -m "perf: SQLtoERD planning 구간 latency 계측 (#1607)"
```

### Task 3: App Server tool-stage instrumentation

**Files:**
- Create: `apps/app-server/src/modules/agent/agent-latency-observer.ts`
- Create: `apps/app-server/scripts/agent/agent-latency-observer.test.mjs`
- Modify: `apps/app-server/src/modules/agent/agent.module.ts`
- Modify: `apps/app-server/src/modules/agent/agent-execution.service.ts`
- Modify: `apps/app-server/scripts/agent/execution.test.mjs`

**Interfaces:**
- Produces: injectable `AgentLatencyObserver.start() -> number`
- Produces: `AgentLatencyObserver.observe(input) -> void` with App Server stages `tool_preparation`, `tool_execution`, `tool_advance`, `tool_turn`
- Consumes: `runId`, verified `requestContext.surface`, registry tool name, and bounded outcome/failure taxonomy only

- [ ] **Step 1: Write failing observer tests**

The Node test imports the built module and verifies the pure event builder returns exactly allow-listed fields, hashes the run ID, ignores non-SQLtoERD/unknown tools, clamps elapsed time, and never throws when its logger sink fails.

- [ ] **Step 2: Build and run the observer test to verify RED**

Run:

```powershell
npm.cmd run build
node scripts/agent/agent-latency-observer.test.mjs
```

Expected: build or import fails because `agent-latency-observer` does not exist.

- [ ] **Step 3: Implement and register the observer**

Create a no-payload injectable observer using `performance.now()`, `createHash("sha256")`, and Nest `Logger.log(JSON.stringify(event))`. Build the event from an explicit input type and catch logger exceptions. Add it only to `AgentModule.providers`; do not touch app bootstrap or `src/common`.

- [ ] **Step 4: Run observer tests and verify GREEN**

Run:

```powershell
npm.cmd run build
node scripts/agent/agent-latency-observer.test.mjs
```

Expected: test exits 0.

- [ ] **Step 5: Write failing execution integration assertions**

Inject a fake observer through the existing execution-service test factory. For `inspect_sql_erd_schema`, assert preparation, execution and advance events; for `focus_sql_erd_tables`, assert the same stages and `tool_turn`. Assert a Calendar execution generates no latency event and a throwing observer does not change the existing result.

- [ ] **Step 6: Run execution tests and verify RED**

Run: `npm.cmd run build; node scripts/agent/execution.test.mjs`

Expected: assertions fail because `AgentExecutionService` does not call the observer.

- [ ] **Step 7: Instrument existing boundaries without changing state order**

Start preparation after parsing the planner candidate and finish it immediately before execution, including contextual `prepareExecution`. In `executeAutoTool`, time only `definition.execute`; start advance after the result and finish after the existing complete/defer/grounded-answer path. Wrap the public ready-run execution for `tool_turn`. Record failure taxonomy and rethrow or follow the exact existing catch path. Do not add DB writes or await logging.

- [ ] **Step 8: Run App Server regression tests**

Run:

```powershell
npm.cmd run build
node scripts/agent/agent-latency-observer.test.mjs
node scripts/agent/execution.test.mjs
node scripts/agent/agent-job.test.mjs
node scripts/agent/sql-erd-tools.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit App Server instrumentation**

```bash
git add apps/app-server/src/modules/agent/agent-latency-observer.ts apps/app-server/src/modules/agent/agent.module.ts apps/app-server/src/modules/agent/agent-execution.service.ts apps/app-server/scripts/agent/agent-latency-observer.test.mjs apps/app-server/scripts/agent/execution.test.mjs
git commit -m "perf: SQLtoERD tool 실행 구간 latency 계측 (#1607)"
```

### Task 4: CloudWatch runbook and final verification

**Files:**
- Create: `docs/infra/agent-sql-erd-latency-observability.md`
- Modify: `docs/superpowers/plans/2026-07-20-agent-sql-erd-latency-observability.md`

**Interfaces:**
- Documents: event fields, p50/p95/failure/token Logs Insights queries, dev smoke, rollback, unsupported frontend segment

- [ ] **Step 1: Write the runbook**

Document exact Logs Insights queries using `filter event = "agent_latency" and surface = "sql_erd"`, `stats count(*) as samples, pct(elapsed_ms, 50) as p50_ms, pct(elapsed_ms, 95) as p95_ms, max(elapsed_ms) as max_ms by component, stage`, plus tool comparison, retrieval fallback, token, and failure taxonomy queries. Include the six-step dev smoke from the design, state that frontend polling-to-canvas apply is not measured, and define rollback as reverting observer calls with no DB/API cleanup.

- [ ] **Step 2: Validate privacy and document completeness**

Run:

```powershell
rg -n "T[B]D|T[O]DO|F[I]XME|raw prompt|sourceText|providerRawResponse" docs/infra/agent-sql-erd-latency-observability.md
git diff --check
```

Expected: no placeholder hits and no whitespace errors. Mentions of forbidden data must be explanatory only, not fixture values or examples.

- [ ] **Step 3: Run the complete focused verification suite**

Run:

```powershell
cd apps/ai-worker
C:\PILO\apps\ai-worker\.venv\Scripts\python.exe -m pytest tests/test_agent_latency.py tests/test_agent_processor.py tests/test_ai_job_runtime.py -q
cd ../app-server
npm.cmd run build
node scripts/agent/agent-latency-observer.test.mjs
node scripts/agent/execution.test.mjs
node scripts/agent/agent-job.test.mjs
node scripts/agent/sql-erd-tools.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit the runbook**

```bash
git add docs/infra/agent-sql-erd-latency-observability.md docs/superpowers/plans/2026-07-20-agent-sql-erd-latency-observability.md
git commit -m "docs: Agent latency 운영 조회 절차 추가 (#1607)"
```

- [ ] **Step 5: Self-review and PR preparation**

Compare `git diff origin/dev...HEAD` against Issue #1607 and the design. Confirm no API/DB/frontend/env changes, no raw identifier in logs, the App Server change stays in `src/modules/agent`, and the PR body records tests, CloudWatch-only storage, rollback, and the unmeasured frontend segment.
