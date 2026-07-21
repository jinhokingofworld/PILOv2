# Multi-turn Agent Context Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broad single-turn Agent workflow evaluation with a frozen multi-turn benchmark measuring context resolution and continuation success.

**Architecture:** A new evaluator owns one replay session per conversation, appends later user turns to the same context, and records a private trace. Deterministic checks validate Tool sequences, prior-result references, and constraints; a separate fixed LLM Judge evaluates free-form context resolution and result delivery. The report and workflow contain only the two resulting metrics and diagnostics.

**Tech Stack:** Python 3.12, pytest, JSON catalog, OpenAI Responses API, existing GitHub Actions evaluation workflow.

## Global Constraints

- Preserve normal AI Worker unit, Tool safety, and runtime tests.
- Remove the legacy `agent_workflow` evaluation catalog, evaluator, snapshot aggregation, and GitHub Actions variant.
- Freeze multi-turn prompts, Tool fixtures, and labels in committed JSON; never generate them during an evaluation run.
- Do not serialize raw conversation text, Tool inputs, Tool outputs, or final answers.
- Judge uses a separate fixed model, temperature `0`, fixed prompt version, and exactly three votes.
- Judge provider/parsing errors, contradictory passes, and three-way splits are `inconclusive`, never success.
- CI reports metrics only and must not fail a PR because scores decline.

---

### Task 1: Define and validate the frozen multi-turn catalog

**Files:**
- Create: `apps/ai-worker/evals/agent_multiturn_context_v1.json`
- Create: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

**Interfaces:** Each `conversations[]` item has `id`, `turns`, and per-turn `expectedTools`, `expectedContext`, `fixtures`, and `expectedOutcome`. `expectedContext` has `referenceKind`, `contextRef`, and `constraints`.

- [ ] Write a failing loader test that rejects a follow-up turn without `expectedContext.contextRef` and accepts a two-turn conversation with immutable fixture outputs.
- [ ] Run `python -m pytest tests/test_agent_multiturn_context_evaluation.py::test_catalog_requires_context_reference_for_follow_up_turn -q`; expect a missing-module failure.
- [ ] Add the catalog with 72 fixed conversations, 12 per non-Canvas domain, including reference, refinement, correction, and domain-switch families.
- [ ] Implement strict catalog validation; require unique conversation IDs, at least two turns, non-empty expected Tool sequences, and structured follow-up context.
- [ ] Run the focused loader tests; commit `test: Multi-turn Agent benchmark catalog 정의`.

### Task 2: Implement persistent replay and deterministic continuation gates

**Files:**
- Create: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class MultiTurnEvaluationResult:
    conversation_id: str
    attempt: int
    deterministic_context_passed: bool
    deterministic_continuation_passed: bool
    failure_reasons: tuple[str, ...]
```

- [ ] Write a failing test where turn 2 selects the right Tool but uses a context reference from a different turn; assert `context_reference` failure.
- [ ] Run the focused test; expect failure because the evaluator is absent.
- [ ] Reuse the Agent processor replay primitives, but preserve one repository/session across all conversation turns. Collect raw trace only in memory.
- [ ] Implement deterministic checks for Tool sequence, prior-result context reference, structured constraint fields, unexpected Tools, and confirmation policy.
- [ ] Run all multi-turn evaluator tests; commit `feat: Multi-turn Agent replay 평가 추가`.

### Task 3: Add context and delivery Judge adjudication

**Files:**
- Modify: `apps/ai-worker/app/agent_outcome_judge.py`
- Modify: `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
- Modify: `apps/ai-worker/tests/test_agent_outcome_judge.py`
- Modify: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

**Interfaces:** `MultiTurnJudgeEvidence` contains the private conversation history, trace, expected context transition, and final answer. `MultiTurnJudgeVerdict` returns `contextResolved`, `followUpDelivered`, `verdict`, and failure codes.

- [ ] Write failing tests for a pass majority, a provider error, a contradictory pass, and a three-way split.
- [ ] Run the focused tests; expect the new multi-turn Judge fields to be missing.
- [ ] Implement a strict JSON schema and three-vote adjudicator. Reuse the existing OpenAI client only through a provider-injected interface for unit tests.
- [ ] Require deterministic context gates before the Judge can produce a primary success.
- [ ] Run Judge and evaluator tests; commit `feat: Multi-turn 맥락 Judge 판정 추가`.

### Task 4: Replace the legacy report, comparison, and CI path

**Files:**
- Delete: `apps/ai-worker/evals/agent_workflow_catalog_v1.json`
- Delete: `apps/ai-worker/app/agent_workflow_evaluation.py`
- Delete: `apps/ai-worker/tests/test_agent_workflow_evaluation.py`
- Modify: `apps/ai-worker/app/agent_planner_comparison.py`
- Modify: `apps/ai-worker/scripts/evaluate_agent_planner.py`
- Modify: `apps/ai-worker/scripts/snapshot_agent_planner_evaluations.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_comparison.py`
- Modify: `apps/ai-worker/tests/test_agent_planner_workflow.py`
- Modify: `.github/workflows/evaluate-agent-planner.yml`

**Interfaces:** Reports expose `multiTurnContextResolutionRate`, `multiTurnContinuationSuccessRate`, `partialRate`, `inconclusiveRate`, and non-raw diagnostic counts. Snapshot comparison pairs by conversation and includes a 95% conversation-clustered bootstrap interval.

- [ ] Write failing report tests that prove only the two primary rates are emitted, `inconclusive` is not success, and mismatched benchmark/Judge metadata is rejected.
- [ ] Run focused report tests; expect legacy report field assertions to fail.
- [ ] Replace legacy aggregation and workflow dispatch inputs with `multi_turn_context`; remove old broad variant artifacts, comparison arguments, and snapshot artifact names.
- [ ] Keep current deterministic Tool retrieval, prompt-security, and Phase 4-E release checks unchanged.
- [ ] Run evaluator, comparison, workflow, and CI YAML tests; commit `refactor: Multi-turn Agent 평가로 교체`.

### Task 5: Verify reproducibility and calibration documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-multiturn-context-evaluation-design.md`
- Test: `apps/ai-worker/tests/test_agent_multiturn_context_evaluation.py`

- [ ] Write a failing metadata test that rejects missing catalog SHA, Judge model, prompt version, temperature, vote count, or repetitions.
- [ ] Run it and confirm failure before implementation.
- [ ] Record catalog SHA and all fixed Judge inputs in snapshot metadata; document the 25% two-reviewer calibration worksheet in the design spec.
- [ ] Run `python -m pytest tests/test_agent_multiturn_context_evaluation.py tests/test_agent_outcome_judge.py tests/test_agent_planner_comparison.py tests/test_agent_planner_workflow.py -q`.
- [ ] Run `ruff check app tests scripts`, `black --check app tests scripts`, `python -m py_compile` on changed app/scripts, and `git diff --check`.
- [ ] Commit `docs: Multi-turn Agent 평가 calibration 기준 추가`.

## Plan Self-Review

- Tasks 1 and 2 implement the frozen multi-turn session benchmark and deterministic context/Tool gates.
- Task 3 adds the narrowly-scoped Judge and makes evaluator failure safe.
- Task 4 removes the legacy broad performance path and leaves unrelated safety/runtime checks intact.
- Task 5 binds baseline/candidate to identical inputs and documents the required human calibration process.
