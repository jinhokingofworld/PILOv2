# AI Worker 2단계 LLM Routing Implementation Plan

**Goal:** AI Worker의 규칙 기반 Tool shortlist를 `LLM Intent Router → LLM Tool Planner` 구조로 교체하고, App Server의 기존 검증·권한·confirmation·실행 경계는 유지한다.

**Architecture:** App Server는 모든 eligible Tool schema와 compact capability catalog를 Worker job에 전달한다. Worker의 첫 번째 LLM은 사용자 원문과 안전한 문맥으로 복수 domain과 capability를 분류하고, 두 번째 LLM은 선택된 domain의 Tool schema만 받아 Tool과 입력을 계획한다. 실제 실행은 기존 App Server handoff와 domain service를 사용한다.

**Tech Stack:** Python dataclass, OpenAI Responses API strict JSON schema, pytest, NestJS Agent execution handoff, Terraform ECS environment.

## Global Constraints

- Router에는 전체 Tool JSON schema를 전달하지 않고 compact capability catalog만 전달한다.
- Router와 Planner 모두 App Server가 만든 eligible Tool snapshot 밖의 Tool을 선택할 수 없다.
- 복합 요청을 위해 Router는 복수 domain을 지원한다.
- 낮은 confidence에서는 기존 규칙 기반 fallback이나 전체 Tool Planner를 사용하지 않고 사용자에게 clarification을 요청한다.
- write Tool의 confirmation, 사용자·Workspace 권한, selector 해소, 실행 직전 재검증은 App Server가 계속 담당한다.
- public API와 DB schema는 변경하지 않는다.
- DEV는 shadow 기간 없이 새 LLM Router 경로를 활성화하되, 기존 full-tool Planner 경로는 긴급 rollback 용도로 유지한다.

---

### Task 1: Intent Router 계약과 OpenAI client를 추가한다

**Primary files:**

- `apps/ai-worker/app/agent_processor.py`
- `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**

- `AgentRoutingRequest`
  - 사용자 프롬프트 원문
  - Workspace timezone과 현재 날짜
  - 검증된 `contextSurface`
  - bounded `planningContext`
  - compact capability catalog
- `AgentRoutingDecision`
  - `status`: `routed | needs_clarification | unsupported`
  - `domains`: 최대 3개의 domain 배열
  - `capabilityIds`: 최대 8개의 capability ID 배열
  - `intentSummary`: 두 번째 Planner에만 전달할 bounded 의도 요약
  - `confidence`: `high | medium | low`
  - `clarificationQuestion`: clarification일 때만 문자열
  - `unsupportedReason`: unsupported일 때만 bounded 문자열

- [x] Router request/decision dataclass와 client protocol을 추가한다.
- [x] OpenAI Responses API strict JSON schema를 사용하는 Router client를 추가한다.
- [x] Router system prompt가 domain 분류만 수행하고 Tool 이름·입력·내부 ID를 생성하지 못하게 제한한다.
- [x] `routed`는 1개 이상의 domain/capability와 `medium | high` confidence를 요구한다.
- [x] `low` confidence는 `needs_clarification`으로 정규화한다.
- [x] 존재하지 않는 domain/capability, domain-capability 불일치, 비활성 capability를 거부한다.
- [x] Router prompt에 raw request context ID, token, credential, 긴 원문 기록이 포함되지 않는지 검증한다.

---

### Task 2: Router 결과로 Planner Tool schema를 제한한다

**Primary files:**

- `apps/ai-worker/app/agent_tool_retrieval.py`
- `apps/ai-worker/app/agent_processor.py`

- [x] Router가 선택한 capability를 서버 소유 catalog에서 다시 조회한다.
- [x] 선택 capability의 prerequisite와 follow-up Tool chain을 포함한다.
- [x] 최초 eligible Tool snapshot과 교집합인 Tool만 Planner 후보로 유지한다.
- [x] job의 Tool 순서를 보존하면서 최대 8개 Tool과 8,000 schema token budget을 적용한다.
- [x] chain 누락, 비활성 Tool, budget 초과는 `AGENT_ROUTER_FAILED`로 안전하게 실패시킨다.
- [x] 기존 deterministic metadata selector를 runtime 기본 경로에서 제거한다.
- [x] offline 비교 및 긴급 rollback을 위해 기존 selector 구현은 유지한다.

---

### Task 3: 두 번째 LLM Planner를 routing-aware하게 변경한다

**Primary files:**

- `apps/ai-worker/app/agent_processor.py`
- `apps/ai-worker/tests/test_agent_processor.py`

- [x] `AgentPlanningRequest`에 검증된 routing 결과를 추가한다.
- [x] Planner에는 사용자 원문, routing의 intent/domain/capability, 날짜·timezone, 안전한 문맥, 선택된 Tool schema만 전달한다.
- [x] Planner의 기존 `tool_candidate | needs_clarification | completed | unsupported` 출력 계약을 유지한다.
- [x] Planner가 shortlist 밖 Tool을 반환하면 planning failure로 거부한다.
- [x] 지원 가능한 planner turn마다 Router와 Planner를 순서대로 호출한다.
- [x] Router가 clarification 또는 unsupported를 반환하면 Planner와 execution handoff를 호출하지 않는다.
- [x] Tool 결과 후 재개되는 planner turn에서도 최신 bounded context로 Router를 다시 호출한다.

---

### Task 4: App Server 실행 경계와 안전한 관측을 유지한다

- [x] Worker는 기존처럼 completed planner step을 저장하고 run ID만 execution handoff에 전달한다.
- [x] App Server가 Tool schema, Workspace 권한, selector, confirmation, 최신 resource 상태를 다시 검증하는 기존 경로를 유지한다.
- [x] public controller를 내부 HTTP로 호출하지 않고 기존 domain service를 실행한다.
- [x] planner step에는 routing status, domain, capability ID, confidence, catalog SHA, 선택 Tool 수만 기록한다.
- [x] 사용자 원문, `intentSummary`, raw provider response, 내부 resource ID는 routing 관측 데이터에 기록하지 않는다.
- [x] retryable Router provider 오류는 기존 SQS 재시도 경로로 보내고, non-retryable 출력 오류는 안전한 planning failure로 종료한다.

---

### Task 5: Runtime 설정과 DEV rollout을 적용한다

- [x] `OPENAI_AGENT_ROUTER_MODEL`을 추가하고 미설정 시 `OPENAI_AGENT_PLANNER_MODEL`을 사용한다.
- [x] `OPENAI_AGENT_ROUTER_TIMEOUT_MS`를 추가하고 미설정 시 Planner timeout을 사용한다.
- [x] `AGENT_TOOL_RETRIEVAL_MODE=llm_router`를 추가한다.
- [x] DEV ECS 환경에 `llm_router`를 설정해 새 2단계 경로를 즉시 활성화한다.
- [x] 빈 값이나 알 수 없는 mode는 기존 `shadow` full-tool Planner 경로로 안전하게 처리한다.
- [x] rollback은 ECS 환경 변수를 `shadow`로 변경하고 새 task definition을 배포하는 방식으로 문서화한다.

---

### Task 6: 회귀 테스트와 평가 체계를 확장한다

- [x] `오늘 일정 보여줘`가 `calendar → calendar.event.list → list_calendar_events`로 연결되고 `Asia/Seoul` 기준 오늘 범위를 생성하는지 검증한다.
- [x] Meeting과 Calendar를 함께 사용하는 복합 요청이 복수 domain과 필요한 Tool chain을 보존하는지 검증한다.
- [x] 낮은 confidence가 사용자 질문으로 끝나며 Planner와 execution handoff가 호출되지 않는지 검증한다.
- [x] unsupported, 알 수 없는 capability, domain 불일치, schema budget 초과가 Tool 실행으로 이어지지 않는지 검증한다.
- [x] Planner의 shortlist 탈출, schema 불일치, confirmation metadata 위조를 기존처럼 거부하는지 검증한다.
- [x] Router와 Planner의 retryable/non-retryable provider failure를 각각 검증한다.
- [x] bounded context가 후속 표현을 지원하면서 raw UUID·token·request context ID를 노출하지 않는지 검증한다.
- [x] provider evaluator를 2단계 호출로 확장해 domain/capability recall, Tool 선택·입력 정확도, 합산 token과 p50/p95 latency를 기록한다.
- [x] AI Worker 전체 pytest, App Server Agent job/execution 테스트, lint, format, build를 통과시킨다.

## Acceptance Criteria

- `오늘 일정 보여줘` 요청은 규칙 기반 문자열 점수 없이 Router와 Planner 두 번의 LLM 판단을 거쳐 Calendar 조회 Tool 후보가 된다.
- 복합 요청은 최대 3개의 domain을 유지하며 필요한 Tool chain을 Planner에 전달한다.
- 낮은 confidence와 잘못된 routing 결과는 Tool 추측 실행 없이 clarification 또는 안전한 실패로 끝난다.
- App Server의 권한·confirmation·재검증·domain service 실행 계약과 외부 API 응답은 변경되지 않는다.
- DEV AI Worker가 `llm_router`로 동작하고 `shadow`로 즉시 rollback할 수 있다.
