# Agent Outcome Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure Canvas-excluded Agent task success with deterministic outcome gates and a report-only, evidence-grounded LLM Judge.

**Architecture:** The workflow evaluator remains the fixture/replay owner. It exposes expected fixture output only for task-critical input, records deterministic outcome and contract results independently, and passes a minimized evidence bundle to a separate Judge adapter. The comparison layer aggregates Judge verdicts and deterministic diagnostics without blocking CI.

**Tech Stack:** Python 3.12, existing provider client abstraction, pytest, JSON evaluation catalog, existing GitHub Actions snapshot/compare reporting.

## Global Constraints

- Keep the existing 31 scenarios and Canvas exclusion.
- Do not store raw prompts, final answers, Tool inputs, or Tool outputs in artifacts.
- Keep confirmation and safety violations as deterministic primary failures.
- Keep planner state, exact Tool structure, router/capability, and literal answer checks as contract diagnostics.
- Fix Judge model, prompt version, response JSON schema, temperature `0`, and vote count at `3` for a comparison run.
- Treat Judge error, malformed JSON, or a three-way split as `inconclusive`, never success.
- Report only: no CI or PR failure is introduced.

---

### Task 1: Finalize functional fixture outcome gates

**Files:**
- Modify: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Modify: `apps/ai-worker/evals/agent_workflow_catalog_v1.json`
- Test: `apps/ai-worker/tests/test_agent_workflow_evaluation.py`

**Interfaces:** `OutcomeInputAssertion`, `WorkflowOutcomeAssertions`, and replay handoff produce `task_critical_input` without exposing an expected fixture result after a mismatch.

- [ ] Add a failing test that submits a semantically matching query and a wrong query to the same fixture.
- [ ] Run `python -m pytest tests/test_agent_workflow_evaluation.py::test_workflow_hides_fixture_result_when_task_critical_input_is_wrong -q`; confirm failure before implementation where coverage is missing.
- [ ] Parse `outcomeInputAssertions` and scenario `outcome`; use normalized token containment only for declared task-critical input assertions.
- [ ] Keep strict full input equality in `executionContractPass`, not in primary task success.
- [ ] Add `outcome` and task-critical input assertions for each catalog case; mark cross-domain Drive cases as `routing_boundary`.
- [ ] Run `python -m pytest tests/test_agent_workflow_evaluation.py -q` and commit `refactor: Agent 결과 기반 fixture 평가 분리`.

### Task 2: Introduce a minimized Judge evidence contract

**Files:**
- Create: `apps/ai-worker/app/agent_outcome_judge.py`
- Modify: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Test: `apps/ai-worker/tests/test_agent_outcome_judge.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class OutcomeJudgeEvidence:
    user_task: str
    expected_outcome: str
    tool_facts: tuple[str, ...]
    final_answer: str
    terminal_state: str
    safety_passed: bool

@dataclass(frozen=True)
class OutcomeJudgeVerdict:
    task_fulfilled: bool
    grounded_in_tool_evidence: bool
    contains_material_error: bool
    verdict: Literal["pass", "partial", "fail", "inconclusive"]
    failure_codes: tuple[str, ...]
```

- [ ] Add a failing parser test for valid `pass`, malformed JSON, and an unsupported verdict.
- [ ] Run `python -m pytest tests/test_agent_outcome_judge.py -q`; confirm missing adapter failure.
- [ ] Implement strict schema parsing, evidence minimization, and prompt construction that tells the Judge to use supplied facts only.
- [ ] Implement a provider-injected Judge callable, so unit tests use a scripted callable and never make network calls.
- [ ] Run `python -m pytest tests/test_agent_outcome_judge.py -q` and commit `feat: Agent 결과 근거 Judge 추가`.

### Task 3: Add three-vote report-only adjudication

**Files:**
- Modify: `apps/ai-worker/app/agent_outcome_judge.py`
- Modify: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Test: `apps/ai-worker/tests/test_agent_outcome_judge.py`
- Test: `apps/ai-worker/tests/test_agent_workflow_evaluation.py`

**Interfaces:** `judge_outcome(evidence, judge) -> OutcomeJudgeVerdict` calls the Judge three times and returns the majority verdict; a three-way split becomes `inconclusive`.

- [ ] Add failing tests for pass-majority, fail-majority, partial-majority, three-way split, and a Judge exception.
- [ ] Run the focused adjudication test and confirm failure before implementation.
- [ ] Implement voting over verdict values. Record only aggregate verdict, booleans, and deduplicated failure codes.
- [ ] Make `taskOutcomeSuccess` require deterministic outcome success and Judge `pass`; `partial` and `inconclusive` remain non-success.
- [ ] Preserve a no-Judge test adapter for existing deterministic unit tests; production snapshot wiring must always provide the configured Judge.
- [ ] Run `python -m pytest tests/test_agent_outcome_judge.py tests/test_agent_workflow_evaluation.py -q` and commit `feat: Agent 작업 결과 Judge 다수결 판정 추가`.

### Task 4: Report outcome, partial, and inconclusive rates

**Files:**
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`
- Modify: `apps/ai-worker/app/agent_workflow_evaluation.py`

**Interfaces:** serialized workflow reports retain `taskSuccess` for compatibility and add `taskOutcomeSuccess`, Judge verdict fields, and assertion booleans. Snapshot comparison adds task success, partial, and inconclusive rates.

- [ ] Add a failing snapshot test proving `routing_boundary` is excluded from product-domain rates but counted in category rates.
- [ ] Add a failing test proving `partial` and `inconclusive` are reported but not counted as successful tasks.
- [ ] Implement aggregation and compare output; do not add a failure threshold or nonzero process exit due to score changes.
- [ ] Run `python -m pytest tests/test_agent_workflow_evaluation.py tests/test_agent_outcome_judge.py tests/test_agent_planner_comparison.py -q`.
- [ ] Run `python -m py_compile app/agent_workflow_evaluation.py app/agent_outcome_judge.py app/agent_planner_comparison.py`, `black --workers 1 --diff --check ...`, and `git diff --check`.
- [ ] Commit `refactor: Agent 작업 성공률 Judge 지표 보고 추가`.

### Task 5: Add calibration runbook and snapshot metadata

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-agent-outcome-evaluation-design.md`
- Modify: the existing snapshot workflow/configuration file discovered in Task 4
- Test: the existing snapshot/configuration test module, if present

- [ ] Record Judge model ID, prompt version, temperature, vote count, and catalog revision in snapshot metadata.
- [ ] Document the human calibration worksheet fields: scenario ID, evaluator verdict, reviewer success/failure label, disagreement reason, and failure code.
- [ ] Add a test that a snapshot cannot omit Judge metadata when Judge evaluation is enabled.
- [ ] Run focused metadata tests and full evaluator tests.
- [ ] Commit `docs: Agent 평가 calibration 기준 추가`.

## Plan Self-Review

- Deterministic safety and state gates are covered in Task 1 and remain independent of the Judge.
- Judge evidence, schema, deterministic test injection, retries, and three-vote consistency are covered by Tasks 2 and 3.
- Report-only aggregation, product-domain isolation, and reproducibility metadata are covered by Tasks 4 and 5.
- No task stores raw evaluation content or turns metric degradation into CI failure.
