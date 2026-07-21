# SQLtoERD inspect 이후 Router 생략 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정상 SQLtoERD inspect→focus continuation의 두 번째 turn에서 LLM Router를 안전하게 생략한다.

**Architecture:** 첫 Planner가 flag 활성 상태에서 bounded continuation kind를 명시하고 기존 planner step output에 저장한다. 다음 turn은 기존 step/outbox metadata와 정상 inspect projection을 검증한 뒤 focus-only 또는 answer-only Planner 입력을 구성하며, 검증 실패 시 기존 Router 경로로 복귀한다.

**Tech Stack:** Python dataclass/pytest, PostgreSQL JSONB query, OpenAI strict JSON schema, NestJS Agent capability snapshot, CloudWatch structured latency log

## Global Constraints

- public API와 DB schema를 변경하지 않는다.
- feature flag 기본값은 `false`다.
- Router만 생략하고 Planner·App Server 실행/권한/정합성 검증은 유지한다.
- prompt, SQL, projection, raw UUID, token, provider payload를 새 로그나 continuation에 저장하지 않는다.
- 사용자가 요청한 범위에 맞춰 관련 테스트만 최소 실행한다.

---

### Task 1: Planner continuation 계약

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`
- Test: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Produces: `AgentPlannerDecision.continuation_kind: str | None`
- Produces: bounded planner output `continuation`

- [ ] **Step 1: flag ON의 focus/inspect-only Planner output과 flag OFF schema 동일성을 검증하는 실패 테스트를 작성한다.**
- [ ] **Step 2: 해당 pytest만 실행해 continuation 계약 부재로 실패하는지 확인한다.**
- [ ] **Step 3: flag가 활성화된 SQLtoERD inspect 계획에만 strict schema와 prompt의 continuation field를 추가한다.**
- [ ] **Step 4: 허용 kind, inspect tool, routing context 조합을 검증하고 bounded continuation만 output summary에 저장한다.**
- [ ] **Step 5: 관련 pytest를 실행해 통과시킨다.**

### Task 2: 저장된 continuation 재개 상태

**Files:**
- Modify: `apps/ai-worker/app/meeting_report_runtime.py`
- Test: `apps/ai-worker/tests/test_ai_job_runtime.py`

**Interfaces:**
- Produces: `AgentRunContext.routing_continuation`
- Consumes: 최신 completed Planner/tool step과 outbox reason

- [ ] **Step 1: 인접한 Planner→inspect metadata만 bounded continuation state로 매핑하는 실패 테스트를 작성한다.**
- [ ] **Step 2: 해당 repository pytest만 실행해 새 state 부재로 실패하는지 확인한다.**
- [ ] **Step 3: 최신 Planner/tool lateral query와 fail-closed continuation parser를 구현한다.**
- [ ] **Step 4: tool step 비인접, user_input reason, invalid JSON은 state를 만들지 않도록 검증한다.**
- [ ] **Step 5: 관련 pytest를 실행해 통과시킨다.**

### Task 3: Router bypass와 fallback

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`
- Test: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Consumes: `AgentRunContext.routing_continuation`
- Produces: focus-only 또는 answer-only `AgentPlanningRequest`

- [ ] **Step 1: 정상 focus에서 Router 두 번째 호출이 0회이고 Planner tool이 focus 하나인지 확인하는 실패 테스트를 작성한다.**
- [ ] **Step 2: inspect-only, flag OFF, invalid projection, intervening state, focus 부재가 기존 Router로 fallback하는 실패 테스트를 작성한다.**
- [ ] **Step 3: 해당 pytest만 실행해 기존 Router 재호출로 실패하는지 확인한다.**
- [ ] **Step 4: 모든 eligibility 조건을 한 helper에서 검사하고 정상 continuation에만 Router를 생략한다.**
- [ ] **Step 5: 동일 테스트를 실행해 통과시킨다.**

### Task 4: 운영 문서와 최소 검증

**Files:**
- Modify: `docs/infra/agent-sql-erd-latency-observability.md`

**Interfaces:**
- Documents: flag, 활성화 조건, CloudWatch 검증, rollback

- [ ] **Step 1: flag 기본 disabled와 AI Worker/Agent Worker 동시 rollout 조건을 문서화한다.**
- [ ] **Step 2: 두 번째 turn의 router stage 부재와 성공률 비교 절차를 추가한다.**
- [ ] **Step 3: 변경 파일 Black/Ruff, 관련 pytest와 App Server Agent catalog 테스트만 실행한다.**
- [ ] **Step 4: diff와 privacy/API/DB 영향 범위를 self-review한다.**
- [ ] **Step 5: 컨벤션에 맞춰 commit, push, dev 대상 PR을 생성한다.**
