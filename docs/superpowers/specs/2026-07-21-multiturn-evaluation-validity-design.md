# Multi-turn Agent Evaluation Validity Design

## Goal

Produce a fixed, reproducible benchmark for Canvas-excluded PILO Agent multi-turn context resolution and Tool selection. A score is publishable only for the declared benchmark scope; it is not an operating-traffic success-rate claim.

## Fixed Evaluation Contract

The report has exactly two headline metrics.

- `multiTurnToolSelectionAccuracy`: the executed Tool names for every turn exactly match the expected Tool sequence. A missing Tool call, clarification, wait-for-user-input, or a different Tool is a failure.
- `multiTurnContextResolutionRate`: the Tool sequence passes, the expected follow-up selector/context gate passes, and the three-vote Judge returns a grounded `pass`.

The evaluator records the Tool-sequence result directly. It must never infer a Tool success from the absence of a failure code.

## Failure Classification

An Agent failure is a valid zero-score observation: wrong or missing Tool, clarification for an information-sufficient case, wait-for-user-input, selector mismatch, or grounded-answer failure.

A harness invalidity is independent of the Agent and blocks publication: an expected Tool is absent from the registry snapshot, an asserted selector is outside that Tool schema, a required context surface is missing, or fixture replay cannot supply the declared expected Tool result. Runtime failures caused by an Agent decision remain Agent failures; only deterministic evaluator/catalog contract violations invalidate a run.

## Preflight and Trace Data

Before LLM calls, validate every catalog expected Tool and asserted selector against the registry-bound `AgentRunJob`. Validate the declared `sql_erd` and `pr_review` context surfaces. A contract failure aborts the evaluation rather than producing a score.

Each serialized result contains only non-sensitive diagnostics: expected Tool sequence, executed Tool sequence, `toolSelectionPassed`, terminal reason, and failure classification. It does not serialize user prompts, Tool inputs, or fixture bodies.

## Scenario and Judge Validity

The frozen catalog uses supported Tool contracts and deterministic fixture facts. Representative Korean multi-turn cases must be reviewed against the product contract before freezing. Fixture data is desirable because it makes baseline/candidate comparisons reproducible; it must match the selector and context that the prior turn exposes.

The Judge remains temperature 0 with three votes and only receives minimised Tool facts. Before Judge-derived context metrics are used externally, two human reviewers independently label at least 18 of 72 conversations (25%). The stored calibration record contains only case ID, each reviewer label, Judge label, and disagreement code. At least 80% reviewer agreement and at least 80% Judge agreement with the adjudicated label are required. Until then, report and snapshot metadata set `judgeCalibrationStatus: "pending"`; the Judge-derived context metric is diagnostic only and must not be used as an external headline.

## Comparison Claim

Baseline and Candidate must use identical benchmark, evaluator, registry, model, Judge, date, timezone, and repetitions. The comparison uses paired conversations and a 95% confidence interval. The claim is allowed only when the lower confidence bound for both headline metric deltas is greater than zero.

## Acceptance Criteria

- Missing Tool calls are never counted as Tool-selection successes.
- Preflight rejects catalog/registry/context-surface contract mismatches before an LLM call.
- Reports distinguish Agent failures from harness invalidity without raw prompt or Tool-input leakage.
- Snapshot metadata identifies whether Judge calibration is pending or passed.
- Focused tests cover each rule, then the complete ai-worker pytest suite passes.
