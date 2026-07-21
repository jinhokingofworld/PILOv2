# Single-turn Tool Selection Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible 120-case benchmark that measures only whether the production PILO Agent chooses the one correct first Tool for a sufficient Korean one-turn request, excluding Canvas.

**Architecture:** A frozen evaluator checkout owns the catalog, measurement rules, report format, and comparison code. It imports the production Router/Planner runtime from each target checkout, records the first Tool handed off, and blocks every Tool execution. Snapshot and comparison workflows use this evaluator checkout for every target, so baseline and candidate reports have the same evaluator and catalog revision.

**Tech Stack:** Python 3.12, existing `AgentRunProcessor`/Router/Planner clients, pytest, GitHub Actions, JSON evaluation artifacts.

## Global Constraints

- Measure only `singleTurnToolSelectionAccuracy`; do not add task-success, Tool input, Tool execution, latency, multi-turn, final-answer, abstention, or LLM-Judge metrics.
- Canvas is out of scope. The frozen v1 catalog has exactly 120 supported, information-sufficient Korean cases: 20 each for Meeting, Calendar, Board, Drive, SQLtoERD, and PR Review.
- A pass requires exactly one first selected Tool and its name must equal the case's expected Tool. No Tool, a clarification/unsupported decision, a different Tool, or multiple selected Tools fails.
- Use empty planning context and stop at `mark_tool_execution_ready`/handoff. The harness must never call a real Tool, App Server, or fixture response.
- Exercise the production two-stage Router and Planner with the fixed model, date, timezone, registry snapshot, catalog revision, and repetition count. No LLM Judge is used.
- Keep the catalog frozen after the baseline is recorded. It is a reproducible public benchmark, not a secret holdout; do not tune changes against individual prompt IDs. Any generalization claim requires a separately access-controlled holdout.
- Comparison repeats every case five times but estimates the paired delta by resampling 120 case-level means, not 600 independent calls. Permit an external benchmark-improvement claim only if the paired clustered 95% CI lower bound is greater than zero.
- Comparison must allow an unmerged candidate SHA when the baseline SHA is its ancestor. It must not require the candidate to already be on `main` or `dev`.
- Both target registries must satisfy a preflight equality check. A registry change is a different experiment, not a Router/Planner selection comparison.

---

## Task 1: Rebase the feature worktree onto the current `origin/dev` evaluation runtime

**Files:** no product-file change expected; update the isolated worktree branch only.

- [ ] Fetch `origin/dev` and inspect the merge base of `codex/single-tool-selection-evaluation` and `origin/dev`.
- [ ] Rebase the two design-document commits onto the current `origin/dev`; resolve only conflicts in the two design documents, preserving current `dev` product changes.
- [ ] Confirm the modern evaluation files exist after the rebase:
  - `apps/ai-worker/app/agent_multiturn_context_evaluation.py`
  - `apps/ai-worker/app/agent_planner_comparison.py`
  - `apps/ai-worker/scripts/evaluate_agent_planner.py`
  - `.github/workflows/evaluate-agent-planner.yml`
- [ ] Run `git diff --check` and `git status --short` before proceeding.

## Task 2: Define and validate the frozen 120-case catalog

**Files:**
- Create: `apps/ai-worker/evals/agent_single_tool_selection_v1.json`
- Create: `apps/ai-worker/evaluation_harness/single_tool_selection_catalog.py`
- Create: `apps/ai-worker/tests/test_single_tool_selection_catalog.py`

- [ ] Write the failing tests first. Cover: valid catalog loads; exactly versioned 120 unique IDs; 20 cases for each allowed domain; Canvas is rejected; each expected Tool exists once in the supplied registry snapshot; and malformed/duplicate/unsupported/insufficient cases raise a deterministic `ValueError`.
- [ ] Define a catalog schema with only `id`, `domain`, `prompt`, `expectedToolName`, and optional `contextSurface`. Do not add fixture output, expected final text, input assertions, or outcome/Judge fields.
- [ ] Add the 120 Korean prompts. Within each domain, distribute the 20 prompts across paraphrase, within-domain operation/qualifier distinction, cross-domain lexical collision, negation/domain-switch language, and semantically similar but different-Tool requests. Do not place literal Tool names in the prompts.
- [ ] Implement `load_single_tool_selection_catalog(path)` and `validate_single_tool_selection_catalog(catalog, tool_names)` in `evaluation_harness/single_tool_selection_catalog.py`. Validation must reject every Tool name absent from the target's registry snapshot.
- [ ] Run:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_single_tool_selection_catalog.py -q
  ```

## Task 3: Execute the real Router/Planner path while intercepting before Tool execution

**Files:**
- Create: `apps/ai-worker/evaluation_harness/single_tool_selection_runtime.py`
- Create: `apps/ai-worker/tests/test_single_tool_selection_runtime.py`
- Reuse without changing behavior: `apps/ai-worker/app/agent_processor.py`

- [ ] Write failing runtime tests using fake Router and Planner clients plus a recording repository/handoff. Verify the runtime supplies an empty planning context and sends the original prompt with the case's optional surface.
- [ ] Verify success only when `AgentRunProcessor` produces one `tool_candidate` whose first handoff Tool equals `expectedToolName`.
- [ ] Verify a Planner clarification, unsupported response, completion without a Tool, a different Tool, a malformed Planner result, and any second selected Tool each produce a failed result with a stable failure code.
- [ ] Implement a minimal repository compatible with `AgentRunProcessor`: `complete_planner_step` records the decision, `mark_tool_execution_ready` records readiness, and a handoff raises a private sentinel or records an intercepted handoff. Neither path may call an external Tool service.
- [ ] Implement `evaluate_single_tool_selection_case(...)` and `evaluate_single_tool_selection_suite(...)`. Instantiate the real `AgentRunProcessor` with the production Router/Planner clients, `tool_retrieval_mode="llm_router"`, fixed current-date provider, clean context, and one process cycle per attempt.
- [ ] Run:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_single_tool_selection_runtime.py -q
  ```

## Task 4: Produce an auditable report and a clustered paired comparison

**Files:**
- Create: `apps/ai-worker/evaluation_harness/single_tool_selection_report.py`
- Create: `apps/ai-worker/tests/test_single_tool_selection_report.py`

- [ ] Write failing report tests for a 120-by-5 complete result grid, exact numerator/denominator accuracy, case/attempt signature uniqueness, stable sorted result serialization, and required metadata.
- [ ] Report only `singleTurnToolSelectionAccuracy`, case count, attempt count, passed-attempt count, the per-case/per-attempt selected Tool and pass state, failure-code counts, and reproducibility metadata: evaluator SHA, catalog SHA/version, source revision, model/router model, date, timezone, repetitions, and registry inventory/catalog SHA.
- [ ] Write failing comparison tests that reject mismatched evaluator/catalog/model/date/timezone/repetitions/registry metadata; reject incomplete or unmatched `(caseId, attempt)` grids; and accept different baseline/candidate `sourceRevision` values.
- [ ] Implement `build_single_tool_selection_comparison(baseline, candidate)`. For every case, average its five paired binary deltas, bootstrap these 120 case means with a fixed seed and 2,000 resamples, and report baseline accuracy, candidate accuracy, percentage-point delta, and `pairedClusteredConfidenceInterval95`.
- [ ] Add `externalClaimAllowed: true` only when the confidence interval lower bound is strictly greater than zero. Include the fixed benchmark-scope statement in the report, never an overall-Agent claim.
- [ ] Run:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_single_tool_selection_report.py -q
  ```

## Task 5: Add a frozen-evaluator command-line entry point

**Files:**
- Create: `apps/ai-worker/scripts/evaluate_single_tool_selection.py`
- Create: `apps/ai-worker/tests/test_evaluate_single_tool_selection_script.py`

- [ ] Write command tests that require catalog, target source root, registry snapshot, model/router model, fixed date/timezone, repetitions, and output path; reject missing OpenAI credentials before any evaluation attempt.
- [ ] Make the script resolve the catalog relative to the evaluator checkout, but insert only `--target-root/apps/ai-worker` ahead of imports for `app.agent_processor` and production Router/Planner clients. This ensures the evaluator's logic is pinned while the Agent being measured comes from baseline or candidate.
- [ ] Hash the evaluator script plus `evaluation_harness/` sources and catalog. Record that hash as `evaluatorSha256`; do not obtain it from the target checkout.
- [ ] Read the target registry snapshot, run catalog/registry preflight before issuing an LLM request, execute the full 120×5 suite, serialize the report, and return nonzero only for invalid evaluator input or incomplete execution—not for a low score.
- [ ] Run:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_evaluate_single_tool_selection_script.py -q
  ```

## Task 6: Add a dedicated snapshot/compare GitHub Actions workflow

**Files:**
- Create: `.github/workflows/evaluate-agent-single-tool-selection.yml`
- Create or extend: `apps/ai-worker/tests/test_single_tool_selection_workflow_contract.py`

- [ ] Add `workflow_dispatch` inputs: `mode` (`snapshot`/`compare`), `current_date`, `repetitions` (default and allowed value `5`), `baseline_sha`, `candidate_sha`, and `target_sha`.
- [ ] In `prepare`, checkout an immutable `evaluator` source at the workflow dispatch SHA and target source(s) separately. In snapshot mode, require the requested SHA to equal the current `main` revision. In compare mode, require valid distinct 40-character SHAs and verify `baseline_sha` is an ancestor of `candidate_sha`; do not require candidate reachability from `main`/`dev`.
- [ ] Build/export each target's Tool registry snapshot. Before evaluation, compare their inventory and capability catalog hashes in compare mode; fail clearly if they differ. Copy no catalog from a target checkout—the catalog always comes from `evaluator`.
- [ ] For each target, install target AI-worker dependencies, obtain the existing read-only OpenAI secret through OIDC, then invoke the evaluator checkout's script with `--target-root` and that target's registry snapshot. Retain individual reports even when a score is low.
- [ ] In compare mode, invoke the evaluator checkout's comparison implementation on both reports. In snapshot mode, emit a single absolute-metric artifact. Upload reports and the comparison/snapshot JSON for 30 days.
- [ ] Test the workflow contract by asserting: an evaluator checkout is present; target source roots are passed explicitly; compare ancestry is baseline→candidate; the candidate is not checked against `main`/`dev`; evaluator/catalog hashes are preflighted; and no Tool fixture/E2E/Judge command is invoked.
- [ ] Run:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_single_tool_selection_workflow_contract.py -q
  ```

## Task 7: Verify the minimal implementation and document use boundaries

**Files:**
- Modify: `docs/superpowers/specs/2026-07-21-single-tool-selection-evaluation-design.md`
- Modify only if needed: `apps/ai-worker/README.md` or the existing evaluation usage documentation discovered in the rebased tree.

- [ ] Add the exact invocation examples for a snapshot and a baseline-vs-unmerged-candidate comparison, plus the interpretation rule: report the benchmark-specific percentage-point delta and CI; never label it overall Agent success, Tool execution success, or multi-turn quality.
- [ ] Run formatting before final tests:
  ```powershell
  cd apps/ai-worker
  black app tests scripts evaluation_harness
  ```
- [ ] Run focused tests, then the affected AI Worker test suite and formatter check:
  ```powershell
  cd apps/ai-worker
  PYTHONPATH=. pytest tests/test_single_tool_selection_catalog.py tests/test_single_tool_selection_runtime.py tests/test_single_tool_selection_report.py tests/test_evaluate_single_tool_selection_script.py tests/test_single_tool_selection_workflow_contract.py -q
  PYTHONPATH=. pytest tests/test_agent_planner_evaluation.py tests/test_agent_planner_comparison.py -q
  black --check app tests scripts evaluation_harness
  ```
- [ ] Run `git diff --check`, inspect the changed-file list, and verify no unrelated multi-turn, Judge, fixture, or API-contract changes were introduced.

## Plan Review Checklist

- [x] The plan has one primary metric and explicitly excludes all unrelated evaluation dimensions.
- [x] The 120-case, six-domain, Canvas-excluded population and five-repeat clustered comparison are exact.
- [x] The evaluator is pinned independently from baseline/candidate target code, addressing the earlier cross-revision evaluator mismatch.
- [x] Tests cover catalog validity, runtime interception, report integrity, comparison validity, CLI wiring, and workflow revision rules before implementation.
- [x] The plan distinguishes a public frozen benchmark from a secret holdout and constrains external wording accordingly.
