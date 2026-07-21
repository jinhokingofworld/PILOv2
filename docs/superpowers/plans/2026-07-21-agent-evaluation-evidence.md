# Agent Evaluation Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas를 제외한 고정 Agent 평가에서 실제 순차 Tool 결과 기반 task success와 paired 처리 효율을 비교한다.

**Architecture:** 기존 단일 Router/Planner 평가는 유지하고 `multi_tool`과 균형 잡힌 `agent_workflow` variant를 production `AgentRunProcessor`와 작은 in-memory Tool simulator로 실행한다. `agent_workflow`는 Canvas를 제외한 6개 도메인을 각각 최소 5개, 총 31개 scenario로 대표한다. comparison은 이 variant를 scenario 단위 bootstrap 표본으로 사용하고 도메인별 비회귀와 성공률·latency·token 차이의 95% 신뢰구간을 함께 판정한다.

**Tech Stack:** Python 3.12, pytest 8.3, GitHub Actions, 표준 라이브러리 `dataclasses`, `hashlib`, `random`, `statistics`.

## Global Constraints

- Canvas 평가와 Canvas 코드는 변경하지 않는다.
- API 계약, DB schema, Frontend, 배포 설정은 변경하지 않는다.
- 새 Python dependency를 추가하지 않는다.
- 실제 prompt와 Tool payload는 artifact에 저장하지 않는다.
- 아래에 명시한 필수 테스트 외 조합 테스트를 추가하지 않는다.

### Task 5: Canvas 제외 도메인 균형 평가

**Files:**
- Create: `apps/ai-worker/evals/agent_workflow_catalog_v1.json`
- Modify: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`
- Modify: `.github/workflows/evaluate-agent-planner.yml`

- [x] Meeting, Calendar, Board, Drive, SQLtoERD, PR Review를 각 최소 5개 scenario로 구성한다.
- [x] 단일 Tool, multi-Tool, clarification, unsupported, confirmation, grounded answer를 포함한다.
- [x] capability의 terminal Tool chain과 catalog fixture가 일치하는지 고정 snapshot으로 검증한다.
- [x] SQLtoERD와 PR Review의 `contextSurface`를 실제 Router/Planner 요청에 전달한다.
- [x] catalog hash를 baseline/candidate 고정 입력으로 검증한다.
- [x] `agent_workflow`만 전체 Agent 개선 근거로 사용해 Meeting 편향을 제거한다.
- [x] 평가 도메인별 task success 비회귀 gate를 추가한다.
- [x] 평가 작업 범주별 task success 비회귀 gate를 추가한다.
- [x] latency 또는 token의 95% 신뢰구간 전체가 개선 방향일 때만 효율 개선으로 판정한다.
- [x] 기존 Meeting Phase 4-E readiness 입력은 변경하지 않는다.

---

### Task 1: 실제 순차 multi-tool workflow

**Files:**
- Create: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Modify: `apps/ai-worker/app/agent_planner_evaluation.py`
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`
- Modify: `apps/ai-worker/evals/meeting_agent_capability_catalog_v1.json`
- Test: `apps/ai-worker/tests/test_agent_workflow_evaluation.py`

**Interfaces:**
- Produces: `WorkflowToolFixture`, `WorkflowScenario`, `WorkflowEvaluationResult`, `load_workflow_scenarios(...)`, `evaluate_workflow_suite(...)`, `build_workflow_evaluation_report(...)`.
- Consumes: `AgentRunProcessor`, `AgentRunContext`, `AgentRunJob`, `AgentPlannerClient`, `AgentRouterClient`.

- [ ] **Step 1: 첫 Tool의 실제 output이 다음 Planner context에 들어가는 실패 테스트 작성**

```python
def test_workflow_uses_actual_tool_output_in_next_planning_context():
    result = evaluate_workflow_suite(scripted_planner, scripted_router, job, (scenario,))
    assert 'tool list_meeting_reports: {"reports"' in scripted_planner.requests[1].planning_context
    assert result[0].task_success is True
```

- [ ] **Step 2: 실제 output 또는 최종 상태가 틀리면 실패하는 테스트 작성**

```python
def test_workflow_rejects_wrong_tool_output_or_terminal_state():
    result = evaluate_workflow_suite(scripted_planner, scripted_router, job, (bad_scenario,))[0]
    assert result.task_success is False
    assert "tool_output" in result.failure_reasons
```

- [ ] **Step 3: 두 테스트가 실패함을 확인**

Run: `python -m pytest -q tests/test_agent_workflow_evaluation.py`
Expected: FAIL because `app.agent_workflow_evaluation` does not exist.

- [ ] **Step 4: 최소 replay repository와 handoff simulator 구현**

```python
@dataclass(frozen=True)
class WorkflowToolFixture:
    tool_name: str
    input_contains: dict[str, object]
    output: dict[str, object]

@dataclass(frozen=True)
class WorkflowEvaluationResult:
    scenario_id: str
    attempt: int
    task_success: bool
    failure_reasons: tuple[str, ...]
    executed_tool_names: tuple[str, ...]
    latency_ms: float
    provider_total_tokens: int | None
    safety_violations: tuple[str, ...]
```

Repository는 `complete_planner_step()`의 실제 `toolName/input`을 저장하고 handoff는 다음 fixture와 대조한 뒤 `tool <name>: <actual output JSON>`을 context에 추가한다. runner는 terminal 상태 또는 `len(fixtures)+2` turn까지 `AgentRunProcessor.process_job()`을 반복한다.

- [ ] **Step 5: catalog의 6개 multi-tool workflow에 결정론적 `output`과 `finalAnswerContains` 추가**

각 Tool stage는 `output` object를 가져야 하며 completion 조건은 실제 output의 식별 가능한 제목을 포함해야 한다. 기대 Tool 이름으로 planning context를 만드는 기존 `_meeting_multi_tool_cases()` 경로는 multi-tool 실행에서 사용하지 않는다.

- [ ] **Step 6: CLI의 `multi_tool` variant를 새 workflow runner/report로 연결**

```python
if args.meeting_catalog and args.meeting_variant == "multi_tool":
    scenarios = load_workflow_scenarios(args.meeting_catalog)
    results = evaluate_workflow_suite(planner, router, suite.job, scenarios, ...)
    report = build_workflow_evaluation_report(results)
else:
    results = evaluate_suite(...)
```

- [ ] **Step 7: 신규 테스트와 기존 evaluator 테스트 통과 확인**

Run: `python -m pytest -q tests/test_agent_workflow_evaluation.py tests/test_agent_planner_evaluation.py tests/test_meeting_agent_regression_catalog.py`
Expected: PASS.

- [ ] **Step 8: 커밋**

```text
test: 실제 Tool 결과 기반 Agent workflow 평가 추가 (#1487)
```

### Task 2: case 실패 격리와 repair token 합산

**Files:**
- Modify: `apps/ai-worker/app/agent_planner_evaluation.py`
- Modify: `apps/ai-worker/app/agent_processor.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_evaluation.py`
- Modify: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Produces: `runtime_failure`가 포함된 `CaseEvaluationResult`와 모든 initial/repair 응답을 합산한 provider token fields.

- [ ] **Step 1: Router 오류 후 다음 case가 계속 실행되는 실패 테스트 작성**

```python
def test_evaluation_isolates_router_failure_and_continues():
    results = evaluate_suite(failing_once_planner, suite, router=failing_once_router, use_llm_routing=True)
    assert len(results) == len(suite.cases)
    assert results[0].runtime_failure == "router_output"
    assert results[1].passed is True
```

- [ ] **Step 2: Router와 Planner repair token이 합산되는 실패 테스트 작성**

기존 repair 테스트의 두 response에 각각 usage를 넣고 `provider_total_tokens`가 두 응답 합계인지 확인한다.

- [ ] **Step 3: 실패 확인 후 최소 구현**

`evaluate_suite()`는 case별 safe wrapper를 호출하고 `AgentRouterOutputError`, `AgentPlannerOutputError`, `InfrastructureError`를 제한된 분류로 변환한다. OpenAI client는 response마다 usage tuple을 누적하고 repair가 끝난 뒤 합계를 decision에 저장한다.

- [ ] **Step 4: 대상 테스트 통과 확인**

Run: `python -m pytest -q tests/test_agent_planner_evaluation.py tests/test_agent_processor.py -k "evaluation_isolates or repairs_malformed"`
Expected: PASS.

- [ ] **Step 5: 커밋**

```text
fix: Agent 평가 실패와 repair token을 정확히 기록 (#1487)
```

### Task 3: paired 개선 근거

**Files:**
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`

**Interfaces:**
- Produces: comparison `improvementEvidence` object with `uniqueScenarioCount`, `taskSuccess.delta`, `taskSuccess.confidenceInterval95`, `latencyMs.delta`, `providerTotalTokens.delta`, `safetyViolations`, `passed`.

- [ ] **Step 1: evaluator hash와 distinct revision 거부 테스트 작성**

```python
with pytest.raises(ValueError, match="distinct revisions"):
    build_two_stage_comparison(baseline, same_revision_candidate)
with pytest.raises(ValueError, match="same evaluator"):
    build_two_stage_comparison(baseline, changed_evaluator_candidate)
```

- [ ] **Step 2: scenario 단위 CI와 false-improvement 방지 테스트 작성**

```python
comparison = build_two_stage_comparison(baseline_reports, candidate_reports)
assert comparison["improvementEvidence"]["uniqueScenarioCount"] == 4
assert comparison["improvementEvidence"]["taskSuccess"]["confidenceInterval95"][0] <= 0
assert comparison["improvementEvidence"]["passed"] is False
```

- [ ] **Step 3: 표준 라이브러리 cluster bootstrap 구현**

attempt를 scenario ID로 묶어 scenario별 평균 delta를 만든 뒤 `random.Random(17)`로 2,000회 scenario resampling한다. CI는 정렬된 bootstrap delta의 2.5/97.5 percentile을 사용한다.

- [ ] **Step 4: evaluator/scorer hash metadata 추가**

`agent_planner_evaluation.py`, `agent_workflow_evaluation.py`, `agent_planner_comparison.py`, CLI script의 bytes를 순서 고정해 SHA-256으로 기록한다. comparison은 baseline/candidate 값이 같아야 한다.

- [ ] **Step 5: comparison 테스트 통과 확인 및 커밋**

Run: `python -m pytest -q tests/test_agent_planner_comparison.py`
Expected: PASS.

```text
test: Agent workflow 개선 근거에 paired 신뢰구간 추가 (#1487)
```

### Task 4: GitHub Actions와 최종 검증

**Files:**
- Modify: `.github/workflows/evaluate-agent-planner.yml`
- Modify: `apps/ai-worker/tests/test_agent_planner_workflow.py`
- Test: all targeted AI Worker tests.

**Interfaces:**
- Consumes: report `evaluatorSha256` and comparison `improvementEvidence`.

- [ ] **Step 1: immutable/distinct SHA와 failure artifact 테스트 작성**

Workflow source에 `baseline_sha`, `candidate_sha`, `fail-fast: false`, `if: always()`가 있고 기존 choice ref가 없음을 검증한다.

- [ ] **Step 2: workflow 최소 수정**

입력을 40자리 SHA로 받고 `git rev-parse --verify`, distinct comparison, trusted `main/dev` ancestry를 검증한다. matrix는 `fail-fast: false`; shard artifact는 `if: always()`로 업로드한다.

- [ ] **Step 3: 관련 테스트 실행**

Run: `python -m pytest -q tests/test_agent_workflow_evaluation.py tests/test_agent_planner_evaluation.py tests/test_agent_planner_comparison.py tests/test_phase4e_dev_readiness.py tests/test_agent_planner_workflow.py tests/test_meeting_agent_regression_catalog.py tests/test_agent_processor.py`
Expected: PASS.

- [ ] **Step 4: 정적 검증**

Run: `python -m ruff check app/agent_workflow_evaluation.py app/agent_planner_evaluation.py app/agent_planner_comparison.py scripts/evaluate_agent_planner.py tests/test_agent_workflow_evaluation.py tests/test_agent_planner_evaluation.py tests/test_agent_planner_comparison.py tests/test_agent_planner_workflow.py`
Expected: PASS.

Run: `python -m black --check` with the same Python files.
Expected: PASS.

Run: `git diff --check`
Expected: PASS.

- [ ] **Step 5: self-review 후 최종 커밋**

```text
ci: Agent 평가 revision과 artifact 조건 강화 (#1487)
```

- [ ] **Step 6: branch push 및 dev 대상 ready PR 생성**

PR 제목: `test(agent,ci): 사용자 작업 성공률 평가 근거 강화`

PR 본문에는 실제 provider 평가는 미수행이며, 현재 31개 대표 workflow는 운영 트래픽 전체나 모든 요청 유형의 개선을 의미하지 않는다고 명시한다.

### Task 5: main 절대 성능 snapshot

**Files:**
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Create: `apps/ai-worker/scripts/snapshot_agent_planner_evaluations.py`
- Modify: `.github/workflows/evaluate-agent-planner.yml`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_workflow.py`

**Interfaces:**
- Consumes: 단일 revision의 완전한 `agent_workflow` evaluation report.
- Produces: `build_agent_performance_snapshot(...)`, `agent-performance-snapshot:v1` JSON artifact.

- [x] **Step 1: 단일 report 절대 지표 실패 테스트 작성 및 RED 확인**

source revision, 31개 고유 scenario 성공률, scenario 평균 latency/token, 도메인·작업 범주 성공률,
안전 위반 건수를 기대하고 `passed`가 없음을 검증한다.

- [x] **Step 2: 최소 snapshot builder와 CLI 구현**

`agent_workflow` variant 하나만 허용하고 report 완전성을 기존 comparison validator로 검증한다.
CLI는 유효한 report를 JSON으로 저장하면 성능값과 무관하게 0을 반환한다.

- [x] **Step 3: workflow를 snapshot/compare mode로 분리**

snapshot은 실행 시점의 current main `target_sha`를 받고 `agent_workflow` 하나만 실행한다.
compare는 기존 baseline/candidate ancestry와 paired 개선 gate를 유지한다.

- [x] **Step 4: 최소 관련 테스트와 정적 검사 실행**

Run: `python -m pytest -q tests/test_agent_planner_comparison.py tests/test_agent_planner_workflow.py`
Expected: PASS.

Run: `python -m ruff check app/agent_planner_comparison.py scripts/snapshot_agent_planner_evaluations.py tests/test_agent_planner_comparison.py tests/test_agent_planner_workflow.py`
Expected: PASS.
