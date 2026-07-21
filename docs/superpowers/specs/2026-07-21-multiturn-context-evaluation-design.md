# PILO Agent Multi-turn Context Evaluation Design

## Goal

Replace the broad single-turn `agent_workflow` performance evaluation with a frozen multi-turn benchmark that measures only:

1. whether the Agent resolves the user’s conversational context and follows it across turns; and
2. whether it chooses and executes the corresponding Tool sequence, then delivers the follow-up result to the user.

The benchmark excludes Canvas. It is a report-only CI measurement and never blocks a PR.

## Scope

The replacement removes the legacy cross-domain workflow catalog, workflow evaluator, workflow snapshot aggregation, and the `agent_workflow` branch of the evaluation GitHub Actions workflow.

It preserves normal AI Worker unit tests, Tool safety checks, runtime code, and non-evaluation CI checks. No API contract or DB schema changes are required.

## Frozen Benchmark

The benchmark is created once and committed as versioned JSON. A run never generates prompts, fixture records, or labels dynamically.

Each conversation has two or three turns. The first turn creates an observable result set; a later user turn refers to, narrows, corrects, or switches that context. Every turn records:

- the user utterance;
- the expected Tool sequence;
- the expected target/context reference and constraints;
- deterministic replay Tool outputs; and
- the expected user-visible follow-up outcome.

The initial v1 benchmark contains 72 conversations, 12 per supported domain: Meeting, Calendar, Board, Drive, SQLtoERD, and PR Review. At least half contain a two-turn reference, and the rest contain condition refinement, correction, or domain switching. Each task family has three distinct Korean surface forms.

The benchmark file’s revision and SHA-256 are recorded in every report. A development catalog may be used for debugging, but the frozen benchmark used for comparison cannot be changed after baseline collection. A separately governed holdout catalog is required before using the result in an external presentation.

## Evaluation Flow

The evaluator runs one persistent replay session per conversation. It does not start a fresh Agent run for later turns.

```text
turn 1 user utterance -> Router/Planner -> replay Tool result/context
turn 2 user utterance -> same session + prior Tool result -> Router/Planner -> replay Tool result
turn 3, if present -> same session + full prior history -> Router/Planner
```

The replay repository keeps the actual Tool outputs, context references, executed Tool inputs, final answers, and a turn trace in memory. Raw user text, Tool input, Tool output, and final answer are supplied to the Judge but are never serialized in CI artifacts.

## Deterministic Gates

Each follow-up turn must satisfy all of these before Judge evaluation:

- expected Tool names occur in the expected order;
- the resolved context reference or target ID belongs to the correct prior result set;
- target, date/time, state, assignee, exclusion, or correction constraints match the scenario’s structured expectations;
- no unexpected Tool is invoked; and
- confirmation/safety policy is respected.

These gates report diagnostic failure categories such as `tool_sequence`, `context_reference`, `constraint`, `unexpected_tool`, and `confirmation_policy`.

## LLM Judge

The Judge evaluates only what cannot be determined from the structured Tool trace: whether free-form references and corrections were understood and whether the user received the relevant follow-up result.

The Judge receives the conversation history, executed Tool trace, deterministic expected context transition, and final answer. Its strict JSON output is:

```json
{
  "contextResolved": true,
  "followUpDelivered": true,
  "containsMaterialError": false,
  "verdict": "pass",
  "failureCodes": []
}
```

It uses a separate fixed model, temperature 0, fixed prompt version, and three independent votes. A malformed response, provider error, contradictory pass, or three-way split is `inconclusive`, never success. Only verdict booleans and failure codes are serialized.

## Metrics

The report has exactly two primary metrics:

- **Multi-turn Context Resolution Rate**: deterministic gates pass and the Judge confirms that the current utterance correctly resolves prior conversational context.
- **Multi-turn Continuation Success Rate**: context resolution passes, the required Tool sequence and constraints are correct, and the Judge confirms that the resulting information was delivered to the user.

`partialRate`, `inconclusiveRate`, Tool sequence failures, context-reference failures, and constraint failures are diagnostics. Latency and tokens may be retained as non-primary operational diagnostics.

The old broad `taskSuccessRate`, domain success tables, and execution-contract score are removed from the evaluation report and presentation. Tool selection is still observable inside the continuation-success gate and its failure breakdown.

## Comparison and Claims

Baseline and Candidate must run the same benchmark SHA, Tool catalog SHA, Agent model configuration, Judge model configuration, current date, timezone, and repetitions. Results are paired by conversation, not by individual turn. The comparison reports absolute rates, percentage-point deltas, conversation count, and a conversation-clustered 95% bootstrap confidence interval.

An improvement claim requires the lower bound of the confidence interval to be above zero on the frozen benchmark. The valid presentation claim is limited to the named multi-turn benchmark; it does not claim all production requests or all Agent abilities improved.

## Judge Calibration

Before external use, two reviewers independently label a stratified sample of at least 25% of the holdout conversations. Store only scenario ID, reviewer labels, Judge verdict, and disagreement code. If Judge agreement is below the predeclared threshold, do not use Judge-derived primary metrics until the rubric is revised and recalibrated.

## Completion Criteria

- Legacy broad workflow evaluation code, catalog, snapshot aggregation, and GitHub Actions variant are removed.
- A frozen multi-turn v1 catalog executes in a persistent replay session.
- Both primary metrics and diagnostic breakdowns are emitted without raw conversation data.
- Judge error and contradictory output cannot produce a success.
- Baseline/Candidate comparison rejects non-identical benchmark or Judge inputs.
- Focused unit tests, workflow tests, formatting, lint, and static compilation pass.
