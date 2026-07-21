# Multi-turn Evaluation Validity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Canvas-excluded multi-turn benchmark calculate Tool selection from executed traces, reject only catalog/evaluator contract defects, and expose calibration state without treating Agent failures as harness invalidity.

**Architecture:** The evaluator validates the frozen catalog against the registry-bound Agent job before any LLM call. Per-attempt results carry a direct Tool-sequence verdict and non-sensitive executed Tool sequence. The report and comparator consume that direct verdict; a separate calibration metadata value prevents Judge-derived context scores from being presented as externally calibrated until reviewers provide a valid record.

**Tech Stack:** Python 3.12, pytest, GitHub Actions, frozen JSON catalog.

## Global Constraints

- Canvas remains excluded.
- Tool inputs, user prompts, and fixture bodies must not be serialized in reports.
- Router/planner clarification, wait-for-user-input, wrong Tool, and missing Tool are Agent failures, not benchmark invalidity.
- Only deterministic catalog/registry/context/fixture contract failures abort a run.
- No model, benchmark, evaluator, or Judge configuration changes are allowed within a baseline/candidate comparison.

---

### Task 1: Add direct Tool-trace verdicts and catalog preflight

**Files:**
- Modify: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Test: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

**Interfaces:**
- Produces `tool_selection_passed: bool`, `expected_tool_sequence: tuple[str, ...]`, and `executed_tool_sequence: tuple[str, ...]` on `MultiTurnEvaluationResult`.
- Produces `validate_multiturn_catalog_against_job(conversations, job) -> None`.

- [ ] **Step 1: Write failing tests**

```python
def test_missing_tool_call_is_not_a_tool_selection_success() -> None:
    result = evaluate_deterministic_continuation(conversation, ())
    assert result.tool_selection_passed is False
    assert result.executed_tool_sequence == ()

def test_preflight_rejects_a_selector_not_in_the_registered_tool_schema() -> None:
    with pytest.raises(ValueError, match="selector"):
        validate_multiturn_catalog_against_job((conversation,), job)
```

- [ ] **Step 2: Run the two tests and verify they fail**

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py -q`

Expected: failure because the new direct verdict and preflight validator do not exist.

- [ ] **Step 3: Implement the minimal direct verdict and preflight**

```python
expected_tool_sequence = tuple(
    tool_name for turn in conversation.turns for tool_name in turn.expected_tools
)
executed_tool_sequence = tuple(call.tool_name for call in tool_calls)
tool_selection_passed = expected_tool_sequence == executed_tool_sequence
```

Validate each expected Tool against `job.tools`, each constraint key against that Tool's `input_schema["properties"]`, each fixture Tool against the declared expected sequence, and `sql_erd`/`pr_review` context surfaces before LLM execution. Raise `ValueError` for a contract defect.

- [ ] **Step 4: Run focused tests and commit**

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py -q`

Expected: PASS.

Commit: `git commit -m "fix: 다중 턴 Tool trace 평가 보강"`

### Task 2: Make reports and comparisons consume direct verdicts

**Files:**
- Modify: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`

**Interfaces:**
- Report result rows add `toolSelectionPassed`, `expectedToolSequence`, `executedToolSequence`, and `failureClassification`.
- `multiTurnToolSelectionAccuracy` is the mean of `toolSelectionPassed` only.

- [ ] **Step 1: Write failing report/comparison tests**

```python
def test_report_counts_missing_tool_as_tool_selection_failure() -> None:
    report = build_multiturn_context_report((missing_tool_result,))
    assert report["multiTurnContextEvaluation"]["multiTurnToolSelectionAccuracy"] == 0.0

def test_comparison_uses_direct_tool_selection_verdict() -> None:
    assert comparison["metrics"]["multiTurnToolSelectionAccuracy"]["baseline"] == 0.0
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py tests/test_agent_planner_comparison.py -q`

Expected: failure because current code infers success from missing failure codes.

- [ ] **Step 3: Implement minimal report fields and comparator use**

Serialize only Tool names and classification (`agent_failure` or `harness_invalid`); do not serialize prompts, inputs, or fixture output. Update snapshot validation to require the direct boolean.

- [ ] **Step 4: Run focused tests and commit**

Run: `python -m pytest tests/test_agent_multiturn_context_evaluation.py tests/test_agent_planner_comparison.py -q`

Expected: PASS.

Commit: `git commit -m "fix: 다중 턴 성능 지표 집계 수정"`

### Task 3: Bind calibration state and CI metadata

**Files:**
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/scripts/snapshot_agent_planner_evaluations.py`
- Modify: `.github/workflows/evaluate-agent-planner.yml`
- Test: `apps/ai-worker/tests/test_agent_planner_comparison.py`

**Interfaces:**
- Evaluation metadata has `judgeCalibrationStatus` with `pending` or `passed`.
- Snapshot includes the same status; a pending Judge metric remains diagnostic.

- [ ] **Step 1: Write failing metadata tests**

```python
def test_multiturn_snapshot_preserves_pending_calibration_status() -> None:
    assert snapshot["metadata"]["judgeCalibrationStatus"] == "pending"
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest tests/test_agent_planner_comparison.py -q`

Expected: failure because no calibration status exists.

- [ ] **Step 3: Implement the metadata-only pending status**

Set `judgeCalibrationStatus` to `pending` until a separately reviewed calibration record is introduced. Require status equality in baseline/candidate comparison and include it in the snapshot. Do not manufacture human labels.

- [ ] **Step 4: Run tests and commit**

Run: `python -m pytest tests/test_agent_planner_comparison.py -q`

Expected: PASS.

Commit: `git commit -m "feat: 다중 턴 Judge calibration 상태 기록"`

### Task 4: Full verification and manual calibration handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-multiturn-evaluation-validity-design.md`

- [ ] **Step 1: Run formatting and targeted checks**

Run:

```powershell
ruff format app/agent_multiturn_context_evaluation.py app/agent_planner_comparison.py scripts/evaluate_agent_planner.py tests/test_agent_multiturn_context_evaluation.py tests/test_agent_planner_comparison.py
ruff check app/agent_multiturn_context_evaluation.py app/agent_planner_comparison.py scripts/evaluate_agent_planner.py tests/test_agent_multiturn_context_evaluation.py tests/test_agent_planner_comparison.py
python -m pytest
git diff --check
```

Expected: all ai-worker tests pass and no whitespace errors.

- [ ] **Step 2: Document the external-use gate**

State that a snapshot with `judgeCalibrationStatus: pending` may diagnose regression but cannot headline the Judge-derived context metric. Two reviewers must label at least 18 conversation IDs before external use.

- [ ] **Step 3: Commit and request review**

Commit: `git commit -m "docs: 다중 턴 평가 외부 사용 기준 명시"`
