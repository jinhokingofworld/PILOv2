# Single-turn Tool Selection Evaluation Design

## Goal

Measure only whether the Canvas-excluded PILO Agent selects the correct single Tool from one information-sufficient Korean user utterance. The benchmark is evidence for single-turn natural-language intent-to-Tool selection, not for multi-turn context resolution, Tool execution, final-answer quality, user task success, or overall Agent quality.

## Scope

- Six domains: Meeting, Calendar, Board, Drive, SQLtoERD, and PR Review.
- Exactly one primary metric: `singleTurnToolSelectionAccuracy`.
- Each evaluated request has no prior conversation, prior Tool result, fixture result, or response-generation Judge.
- The evaluator runs the production Router and Planner path, records the first selected Tool, and stops before Tool execution.
- A different Tool, no Tool, clarification, unsupported result, or more than one selected Tool is a failure.
- Canvas, multi-turn evaluation, Tool execution, final-answer evaluation, LLM Judge, latency, and user-task-success metrics are out of scope.

## Frozen Benchmark

The committed v1 catalog contains 120 supported, information-sufficient Korean requests: twenty per domain. Each case declares only a case ID, domain, user utterance, context surface where needed, and expected Tool name.

The 120 cases are stratified across:

- natural Korean paraphrases that do not name the Tool;
- operation and qualifier distinctions within a domain;
- cross-domain lexical collisions, such as document versus meeting report and issue versus PR review;
- negation and explicit domain switching; and
- semantically similar requests that require different Tools.

Every expected Tool must be present in the registry snapshot and reachable on the declared surface. Cases with insufficient selector information are excluded so that missing parameters cannot be confused with Tool-choice quality.

The catalog is a locked frozen benchmark: it is not changed while a baseline/candidate comparison is in progress. The expected Tool mapping is listed in the review artifact so the owning domain maintainers can verify product-contract correctness before external use.

## Evaluation Contract

For each attempt, the evaluator starts a clean Agent run with an empty planning context. It records the first Tool chosen by the real Router/Planner pipeline. The run succeeds only if exactly one Tool is selected and its name equals the case's expected Tool name.

The evaluator serializes only the case ID, expected Tool name, selected Tool name or terminal selection state, pass/fail, and non-sensitive failure category. It never needs Tool outputs, user answers, a fixture body, or a Judge verdict.

## Metric and Comparison

`singleTurnToolSelectionAccuracy` is the fraction of all supported frozen-benchmark attempts that meet the exact-selection contract.

Baseline and candidate use the same catalog SHA, registry snapshot, Agent model configuration, current date, timezone, repetition count, and pinned evaluator revision. The workflow runs each case five times and compares paired results clustered by the same 120 case IDs. Repetitions reduce model variance but do not increase the benchmark's effective case count. The report includes absolute accuracy, percentage-point delta, and a clustered paired 95% bootstrap confidence interval.

An external improvement claim is allowed only when the lower bound of the confidence interval is greater than zero. The permitted claim is limited to the frozen single-turn benchmark.

The committed catalog is a reproducible frozen benchmark, not a secret holdout: its case-level content must not be used to tune an Agent change. Results must identify the catalog version and state this scope. A separate access-controlled holdout is required for any claim about generalization beyond this benchmark.

## Evaluator Versioning

The evaluation harness is checked out once at a pinned evaluator SHA and runs against both target source revisions. The target revisions must not each supply their own evaluator implementation. This prevents an evaluator change from invalidating the comparison through an `evaluatorSha256` mismatch.

## Acceptance Criteria

- A successful result is based on the directly selected first Tool, not an inferred terminal message.
- No fixture, Tool execution result, final answer, or LLM Judge affects the metric.
- The catalog covers all six non-Canvas domains and the declared semantic ambiguity strata.
- Baseline/candidate comparison rejects non-identical benchmark, registry, model, or pinned evaluator inputs.
- Focused evaluator, catalog-validation, report, and comparison tests pass before the workflow is used for an external claim.
