# Korean Multi-turn Holdout Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas 제외 6개 도메인의 Private S3 한국어 2~4턴 holdout을 follow-up turn 기준으로 채점하고, human-calibrated Judge와 paired 95% 신뢰구간으로 비교한다.

**Architecture:** 기존 Router/Planner replay를 유지하되 catalog v2와 follow-up turn trace를 추가한다. Private holdout과 calibration record는 evaluate job이 AWS OIDC로 직접 내려받고 artifact에 포함하지 않는다. Report는 대화 단위 주 지표와 follow-up 진단값만 저장한다.

**Tech Stack:** Python 3.12, pytest, OpenAI Responses API, GitHub Actions, AWS CLI/S3, JSON

## Global Constraints

- 실제 holdout은 저장소에 커밋하지 않는다.
- Holdout은 120개, 6개 도메인별 20개, 대화당 2~4턴, `ko-KR`이어야 한다.
- 각 non-clarification turn은 단일 Tool만 기대하며 family 라벨과 실제 clarification/topic-return 구조가 일치해야 한다.
- 첫 turn은 고정 fixture로 정상 setup하고 headline metric에서 제외한다.
- Judge는 temperature 0, 3표 다수결을 유지한다.
- S3 입력 SHA, evaluator SHA, registry/model/date/timezone/repetitions가 다른 비교는 거부한다.
- 사용자 요청에 따라 test-first TDD는 생략하고 변경 경계별 최소 회귀 테스트만 수행한다.
- AWS 객체 생성과 업로드는 기존 읽기 전용 권한 범위 밖이므로 이 계획에서 수행하지 않는다.

---

### Task 1: Catalog v2와 follow-up 정답 계약

**Files:**
- Modify: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Create: `apps/ai-worker/evals/agent_multiturn_context_ko_dev_v2.json`
- Modify: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

**Interfaces:**
- Consumes: 기존 `MultiTurnCatalog`, `MultiTurnConversation`, `MultiTurnTurn`
- Produces: `ExpectedContext.source_turn`, `forbidden_tools`, `required_clarification_fields`, strict `validate_korean_multiturn_holdout_catalog()`

- [ ] `ExpectedContext`와 conversation metadata를 다음 계약으로 확장한다.

```python
@dataclass(frozen=True)
class ExpectedContext:
    reference_kind: str
    context_ref: str | None
    constraints: FrozenMapping
    source_turn: int | None = None
    forbidden_tools: tuple[str, ...] = ()
    required_clarification_fields: tuple[str, ...] = ()
    source_constraints: FrozenMapping | None = None

@dataclass(frozen=True)
class MultiTurnConversation:
    conversation_id: str
    turns: tuple[MultiTurnTurn, ...]
    context_surface: str | None
    domain: str | None = None
    scenario_family: str | None = None
```

- [ ] v1 catalog는 기존 기본값으로 계속 읽고, `agent-korean-multiturn-holdout:v2`에는 `language=ko-KR`, 120개, 도메인별 20개, 2~4턴, 한국어 발화, scenario family 분포를 강제한다.
- [ ] `sourceTurn < currentTurn`, `sourceConstraints` fixture 근거, clarification의 빈 Tool/fixture와 필수 질문 필드를 preflight에서 검증한다.
- [ ] 저장소에는 도메인별 2개인 12개 한국어 개발 사례만 추가하고 파일 이름과 metadata에 `dev`를 명시한다.
- [ ] 최소 검증을 실행한다.

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py -q`

Expected: catalog v1 호환, v2 source turn, clarification, 3턴 복귀 검증이 모두 PASS.

### Task 2: Follow-up turn 채점과 운영 context parity

**Files:**
- Modify: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/app/agent_outcome_judge.py`
- Modify: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/tests/test_agent_outcome_judge.py`

**Interfaces:**
- Consumes: Task 1의 `source_turn`과 clarification 계약
- Produces: `MultiTurnFollowUpResult`, conversation success, 세 가지 신규 지표

- [ ] follow-up 결과를 다음 구조로 기록한다.

```python
@dataclass(frozen=True)
class MultiTurnFollowUpResult:
    turn_index: int
    tool_selection_passed: bool
    context_argument_applicable: bool
    context_argument_passed: bool
    deterministic_passed: bool
    judge_verdict: OutcomeJudgeLabel | None
    judge_context_resolved: bool | None
    failure_reasons: tuple[str, ...]
```

- [ ] 첫 turn은 fixture와 기대 fact로 setup하고, 각 follow-up 직후 해당 turn의 Tool trace, source fixture, terminal state와 최종 답변을 채점한다. clarification은 Tool 미호출과 `waiting_user_input`을 결정적으로 확인한다.
- [ ] replay `planningContext`에 `user`, `tool`, `assistant`를 운영 형식으로 누적하고 3턴 이상에서 이전 turn으로 복귀할 수 있게 한다.
- [ ] report에 `koreanMultiTurnContextTaskSuccessRate`, `followUpToolSelectionAccuracy`, `priorContextArgumentAccuracy`를 추가한다. 기존 전체 sequence 값은 diagnostic으로 유지한다.
- [ ] 최소 검증을 실행한다.

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py tests/test_agent_outcome_judge.py -q`

Expected: follow-up 채점, clarification, source turn, Judge fail-closed가 PASS.

### Task 3: Judge-human calibration 계산

**Files:**
- Create: `apps/ai-worker/app/agent_multiturn_calibration.py`
- Create: `apps/ai-worker/tests/test_agent_multiturn_calibration.py`
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`

**Interfaces:**
- Consumes: Private calibration JSON, catalog SHA, Judge model/prompt
- Produces: `JudgeCalibrationResult(status, reviewer_agreement, judge_agreement, kappa, sha256)`

- [ ] calibration JSON format을 고정한다.

```json
{
  "format": "pilo-agent-multiturn-calibration:v1",
  "catalogSha256": "64 lowercase hex characters",
  "judgeModel": "gpt-5.4",
  "judgePromptVersion": "agent-multiturn-context-judge:v1",
  "records": [
    {
      "conversationId": "meeting_ko_01",
      "domain": "meeting",
      "reviewerA": "pass",
      "reviewerB": "pass",
      "adjudicated": "pass",
      "judge": "pass"
    }
  ]
}
```

- [ ] 정확히 30개, 도메인별 5개, catalog ID 존재, model/prompt/SHA 일치를 검증한다.
- [ ] adjudicated `pass`/non-pass를 각각 최소 5개 요구하고 reviewer raw agreement, Judge raw agreement, Judge-vs-adjudicated Cohen's kappa를 계산해 각각 0.9, 0.9, 0.8 이상일 때만 `passed`로 만든다.
- [ ] `evaluate_agent_planner.py`는 calibration path를 필수로 받고 계산 결과와 calibration SHA를 metadata에 기록한다. 수동 status 입력은 허용하지 않는다.
- [ ] 최소 검증을 실행한다.

Run: `python -m pytest tests/test_agent_multiturn_calibration.py -q`

Expected: threshold 경계, 분포 오류, SHA/model 불일치가 PASS.

### Task 4: Snapshot/Comparison 계약 갱신

**Files:**
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`
- Modify: `apps/ai-worker/scripts/snapshot_agent_planner_evaluations.py`

**Interfaces:**
- Consumes: Task 2 report와 Task 3 calibration metadata
- Produces: paired 신규 지표 delta와 conversation-clustered 95% CI

- [ ] report validator가 신규 지표, `language=ko-KR`, holdout SHA와 calibration SHA/status를 요구하도록 한다.
- [ ] baseline/candidate의 세 지표를 conversation별 5회 평균으로 묶어 seed 17, 2,000회 paired bootstrap CI를 계산한다.
- [ ] 주 지표 CI 하한 `> 0`, 보조 지표 delta `>= 0`, calibration `passed`를 improvement evidence에 기록한다.
- [ ] 최소 검증을 실행한다.

Run: `python -m pytest tests/test_agent_planner_comparison.py -q`

Expected: 동일 입력 비교, SHA 불일치 거부, CI 판정이 PASS.

### Task 5: Private S3 workflow 연결

**Files:**
- Modify: `.github/workflows/evaluate-agent-planner.yml`
- Modify: `apps/ai-worker/tests/test_agent_planner_workflow.py`

**Interfaces:**
- Consumes: `PILO_AGENT_MULTITURN_HOLDOUT_S3_URI`, `PILO_AGENT_MULTITURN_CALIBRATION_S3_URI`
- Produces: runner 임시 경로의 private JSON 입력; artifact에는 report만 포함

- [ ] evaluate job이 AWS credential 설정 후 두 URI를 non-empty 검증하고 `$RUNNER_TEMP/private-evaluation`으로 `aws s3 cp`한다.
- [ ] private JSON을 prepared-input artifact에 포함하지 않고 평가 command에 `--multiturn-catalog`, `--multiturn-calibration`으로 전달한다.
- [ ] workflow contract test가 S3 변수, AWS 다운로드, private artifact 제외와 calibration 인자를 검사한다.
- [ ] 최소 검증을 실행한다.

Run: `python -m pytest tests/test_agent_planner_workflow.py -q`

Expected: workflow private-input contract가 PASS.

### Task 6: 최소 통합 검증과 handoff

**Files:**
- Verify only: 변경된 Python, JSON, workflow 파일

**Interfaces:**
- Consumes: Task 1~5 전체 결과
- Produces: CI에 올릴 수 있는 clean branch와 S3 운영 prerequisite 목록

- [ ] 다음 focused suite만 실행한다.

```powershell
python -m pytest `
  tests/test_agent_multiturn_context_evaluation.py `
  tests/test_agent_outcome_judge.py `
  tests/test_agent_multiturn_calibration.py `
  tests/test_agent_planner_comparison.py `
  tests/test_agent_planner_workflow.py -q
```

- [ ] 변경 Python 파일에만 Ruff와 Black check를 실행하고 `python -m py_compile`을 실행한다.
- [ ] `git diff --check`와 JSON parse를 확인한다.
- [ ] 실제 S3 평가 실행 전 필요한 두 repository variable, OIDC Role의 `s3:GetObject`, 120개 holdout 객체와 30개 calibration 객체를 handoff에 명시한다.
