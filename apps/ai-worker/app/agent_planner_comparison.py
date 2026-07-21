from __future__ import annotations

import random
from collections.abc import Iterable

COMPARISON_FORMAT = "agent-llm-router-planner-comparison:v1"
MULTITURN_COMPARISON_FORMAT = "agent-multiturn-context-comparison:v1"
MULTITURN_SNAPSHOT_FORMAT = "agent-multiturn-context-snapshot:v1"
SNAPSHOT_FORMAT = "agent-performance-snapshot:v1"
SNAPSHOT_SCENARIO_COUNT = 31
_FUNNEL_STAGES = (
    "routerRouted",
    "domainExact",
    "capabilityExact",
    "toolExact",
    "requiredInputExact",
    "executionPolicyExact",
    "endToEndExact",
)
_PAIRED_METADATA_KEYS = (
    "meetingCatalogSha256",
    "workflowCatalogSha256",
    "model",
    "routerModel",
    "currentDate",
    "timezone",
    "repetitions",
    "retrievalTopK",
    "evaluationSeed",
    "evaluatorSha256",
)
_REVISION_BINDING_KEYS = (
    "sourceRevision",
    "suiteSha256",
    "toolCapabilityCatalogFileSha256",
    "registryInventorySha256",
    "registryCatalogSha256",
    "registryEligibleSnapshotSha256",
)


def build_multiturn_context_comparison(
    baseline_report: dict[str, object],
    candidate_report: dict[str, object],
) -> dict[str, object]:
    _validate_multiturn_report(baseline_report)
    _validate_multiturn_report(candidate_report)
    baseline_metadata = _object(baseline_report.get("metadata"), "Missing evaluation metadata")
    candidate_metadata = _object(candidate_report.get("metadata"), "Missing evaluation metadata")
    metadata_keys = (
        "workflowCatalogSha256",
        "multiTurnJudgeModel",
        "multiTurnJudgePromptVersion",
        "multiTurnJudgeTemperature",
        "multiTurnJudgeVoteCount",
        "currentDate",
        "timezone",
        "repetitions",
    )
    for key in metadata_keys:
        if baseline_metadata.get(key) != candidate_metadata.get(key):
            raise ValueError(f"Multi-turn reports must share metadata: {key}")
    baseline_by_conversation = _multiturn_conversation_scores(baseline_report)
    candidate_by_conversation = _multiturn_conversation_scores(candidate_report)
    if set(baseline_by_conversation) != set(candidate_by_conversation):
        raise ValueError("Multi-turn reports must contain identical conversations")
    metric_names = (
        "multiTurnContextResolutionRate",
        "multiTurnContinuationSuccessRate",
    )
    metrics: dict[str, dict[str, float | list[float]]] = {}
    for metric_name in metric_names:
        conversation_ids = sorted(baseline_by_conversation)
        baseline_values = [baseline_by_conversation[item][metric_name] for item in conversation_ids]
        candidate_values = [
            candidate_by_conversation[item][metric_name] for item in conversation_ids
        ]
        deltas = [
            candidate - baseline
            for baseline, candidate in zip(baseline_values, candidate_values, strict=True)
        ]
        metrics[metric_name] = {
            "baseline": round(_mean(baseline_values), 4),
            "candidate": round(_mean(candidate_values), 4),
            "delta": round(_mean(deltas), 4),
            "confidenceInterval95": list(_bootstrap_mean_confidence_interval(deltas)),
        }
    return {
        "format": MULTITURN_COMPARISON_FORMAT,
        "metadata": {key: baseline_metadata.get(key) for key in metadata_keys},
        "conversationCount": len(baseline_by_conversation),
        "metrics": metrics,
    }


def build_multiturn_context_snapshot(report: dict[str, object]) -> dict[str, object]:
    _validate_multiturn_report(report)
    summary = _object(report["multiTurnContextEvaluation"], "Missing multi-turn summary")
    metadata = _object(report.get("metadata"), "Missing evaluation metadata")
    return {
        "format": MULTITURN_SNAPSHOT_FORMAT,
        "metadata": {
            key: metadata.get(key)
            for key in (
                "sourceRevision",
                "workflowCatalogSha256",
                "multiTurnJudgeModel",
                "multiTurnJudgePromptVersion",
                "multiTurnJudgeTemperature",
                "multiTurnJudgeVoteCount",
                "currentDate",
                "timezone",
                "repetitions",
            )
        },
        "conversationCount": summary["conversationCount"],
        "metrics": {
            key: summary[key]
            for key in (
                "multiTurnContextResolutionRate",
                "multiTurnContinuationSuccessRate",
                "partialRate",
                "inconclusiveRate",
            )
        },
    }


def _validate_multiturn_report(report: dict[str, object]) -> None:
    summary = _object(report.get("multiTurnContextEvaluation"), "Missing multi-turn summary")
    for key in (
        "multiTurnContextResolutionRate",
        "multiTurnContinuationSuccessRate",
        "partialRate",
        "inconclusiveRate",
    ):
        _rate(summary.get(key), f"Invalid multi-turn rate: {key}")
    if not isinstance(report.get("results"), list):
        raise ValueError("Multi-turn report is missing results")
    metadata = _object(report.get("metadata"), "Missing evaluation metadata")
    required_strings = (
        "workflowCatalogSha256",
        "multiTurnJudgeModel",
        "multiTurnJudgePromptVersion",
    )
    if any(not isinstance(metadata.get(key), str) or not metadata[key] for key in required_strings):
        raise ValueError("Multi-turn report is missing Judge or catalog metadata")
    if metadata.get("multiTurnJudgeTemperature") != 0:
        raise ValueError("Multi-turn Judge temperature must be zero")
    if metadata.get("multiTurnJudgeVoteCount") != 3:
        raise ValueError("Multi-turn Judge vote count must be three")


def _multiturn_conversation_scores(
    report: dict[str, object],
) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for raw in report["results"]:
        result = _object(raw, "Invalid multi-turn result")
        conversation_id = result.get("id")
        if not isinstance(conversation_id, str) or not conversation_id:
            raise ValueError("Invalid multi-turn conversation id")
        if not isinstance(result.get("deterministicContextPassed"), bool) or not isinstance(
            result.get("deterministicContinuationPassed"), bool
        ):
            raise ValueError("Invalid multi-turn deterministic result")
        grouped.setdefault(conversation_id, []).append(result)
    return {
        conversation_id: {
            "multiTurnContextResolutionRate": _mean(
                [
                    float(
                        item["deterministicContextPassed"] is True
                        and item.get("judgeContextResolved") is True
                    )
                    for item in attempts
                ]
            ),
            "multiTurnContinuationSuccessRate": _mean(
                [
                    float(
                        item["deterministicContinuationPassed"] is True
                        and item.get("judgeVerdict") == "pass"
                        and item.get("judgeFollowUpDelivered") is True
                    )
                    for item in attempts
                ]
            ),
        }
        for conversation_id, attempts in grouped.items()
    }


def build_agent_performance_snapshot(
    reports: Iterable[dict[str, object]],
) -> dict[str, object]:
    reports_by_variant = _reports_by_variant(reports)
    if set(reports_by_variant) != {"agent_workflow"}:
        raise ValueError("Snapshot requires exactly the agent_workflow variant")

    report = reports_by_variant["agent_workflow"]
    if (
        not isinstance(report.get("workflowEvaluation"), dict)
        or not isinstance(report.get("totalCases"), int)
        or report["totalCases"] < SNAPSHOT_SCENARIO_COUNT
    ):
        raise ValueError("Snapshot requires at least 31 complete workflow scenarios")
    _validate_complete_workflow_attempts(report)
    scenario_attempts: dict[str, list[dict[str, object]]] = {}
    for result in _raw_results(report):
        _validate_workflow_result(result)
        scenario_id = result.get("id")
        if not isinstance(scenario_id, str) or not scenario_id:
            raise ValueError("Invalid workflow scenario id")
        scenario_attempts.setdefault(scenario_id, []).append(result)
    if len(scenario_attempts) != SNAPSHOT_SCENARIO_COUNT:
        raise ValueError("Snapshot requires at least 31 complete workflow scenarios")

    scenario_success: dict[str, float] = {}
    scenario_contract_success: dict[str, float] = {}
    domain_success: dict[str, list[float]] = {}
    category_success: dict[str, list[float]] = {}
    scenario_latency: list[float] = []
    scenario_tokens: list[float] = []
    has_complete_tokens = True
    safety_violations = 0
    partial_attempts = 0
    inconclusive_attempts = 0
    for scenario_id, attempts in scenario_attempts.items():
        success_rate = _mean([float(_task_success(item)) for item in attempts])
        scenario_success[scenario_id] = success_rate
        scenario_contract_success[scenario_id] = _mean(
            [float(_execution_contract_passed(item)) for item in attempts]
        )
        for domain in _expected_domains(attempts[0]):
            if domain != "routing_boundary":
                domain_success.setdefault(domain, []).append(success_rate)
        category = attempts[0].get("kind")
        if not isinstance(category, str) or not category:
            raise ValueError("Invalid workflow task category")
        category_success.setdefault(category, []).append(success_rate)
        scenario_latency.append(
            _mean([float(_workflow_number(item, "latencyMs")) for item in attempts])
        )
        token_values = [_workflow_number(item, "providerTotalTokens") for item in attempts]
        if any(value is None for value in token_values):
            has_complete_tokens = False
        else:
            scenario_tokens.append(_mean([float(value) for value in token_values]))
        safety_violations += sum(_safety_violation_count(item) for item in attempts)
        partial_attempts += sum(_outcome_judge_verdict(item) == "partial" for item in attempts)
        inconclusive_attempts += sum(
            _outcome_judge_verdict(item) == "inconclusive" for item in attempts
        )

    return {
        "format": SNAPSHOT_FORMAT,
        "sourceRevision": _common_revision(reports_by_variant.values()),
        "scopeVariants": ["agent_workflow"],
        "fixedInputs": _common_metadata(reports_by_variant.values(), _PAIRED_METADATA_KEYS),
        "revisionBinding": _common_metadata(reports_by_variant.values(), _REVISION_BINDING_KEYS),
        "aggregate": _aggregate(reports_by_variant.values()),
        "uniqueScenarioCount": len(scenario_attempts),
        "taskSuccessRate": round(_mean(list(scenario_success.values())), 4),
        "partialRate": round(
            _fraction(partial_attempts, sum(map(len, scenario_attempts.values()))), 4
        ),
        "inconclusiveRate": round(
            _fraction(inconclusive_attempts, sum(map(len, scenario_attempts.values()))), 4
        ),
        "executionContractPassRate": round(_mean(list(scenario_contract_success.values())), 4),
        "meanLatencyMs": round(_mean(scenario_latency), 4),
        "meanProviderTotalTokens": (
            round(_mean(scenario_tokens), 4) if has_complete_tokens else None
        ),
        "domainTaskSuccess": _absolute_grouped_task_success(domain_success),
        "categoryTaskSuccess": _absolute_grouped_task_success(category_success),
        "safetyViolations": {"count": safety_violations},
    }


def build_two_stage_comparison(
    baseline_reports: Iterable[dict[str, object]],
    candidate_reports: Iterable[dict[str, object]],
) -> dict[str, object]:
    baseline = _reports_by_variant(baseline_reports)
    candidate = _reports_by_variant(candidate_reports)
    if not baseline or set(baseline) != set(candidate):
        raise ValueError("Baseline and candidate variants must match")

    variants: dict[str, object] = {}
    for variant in sorted(baseline):
        baseline_report = baseline[variant]
        candidate_report = candidate[variant]
        _validate_paired_inputs(baseline_report, candidate_report)
        baseline_summary = _report_summary(baseline_report)
        candidate_summary = _report_summary(candidate_report)
        variants[variant] = {
            "baseline": baseline_summary,
            "candidate": candidate_summary,
            "delta": _summary_delta(baseline_summary, candidate_summary),
        }

    baseline_revision = _common_revision(baseline.values())
    candidate_revision = _common_revision(candidate.values())
    if baseline_revision == candidate_revision:
        raise ValueError("Baseline and candidate must use distinct revisions")
    baseline_aggregate = _aggregate(baseline.values())
    candidate_aggregate = _aggregate(candidate.values())
    return {
        "format": COMPARISON_FORMAT,
        "sameEvaluationInputs": True,
        "baselineRevision": baseline_revision,
        "candidateRevision": candidate_revision,
        "fixedInputs": _common_metadata(baseline.values(), _PAIRED_METADATA_KEYS),
        "baselineBinding": _common_metadata(baseline.values(), _REVISION_BINDING_KEYS),
        "candidateBinding": _common_metadata(candidate.values(), _REVISION_BINDING_KEYS),
        "variants": variants,
        "aggregate": {
            "baseline": baseline_aggregate,
            "candidate": candidate_aggregate,
            "delta": _summary_delta(baseline_aggregate, candidate_aggregate),
        },
        "improvementEvidence": _paired_improvement_evidence(baseline, candidate),
    }


def _reports_by_variant(
    reports: Iterable[dict[str, object]],
) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {}
    for report in reports:
        metadata = _object(report.get("metadata"), "Missing evaluation metadata")
        if metadata.get("llmRouting") is not True:
            raise ValueError("Evaluation report must use two-stage LLM routing")
        suite_version = metadata.get("suiteVersion")
        if not isinstance(suite_version, str) or ":" not in suite_version:
            raise ValueError("Invalid evaluation suite version")
        variant = suite_version.rsplit(":", 1)[-1]
        if variant in result:
            raise ValueError("Duplicate evaluation variant")
        result[variant] = report
    return result


def _validate_paired_inputs(baseline: dict[str, object], candidate: dict[str, object]) -> None:
    baseline_metadata = _object(baseline.get("metadata"), "Missing baseline metadata")
    candidate_metadata = _object(candidate.get("metadata"), "Missing candidate metadata")
    if baseline_metadata.get("evaluatorSha256") is None or baseline_metadata.get(
        "evaluatorSha256"
    ) != candidate_metadata.get("evaluatorSha256"):
        raise ValueError("Baseline and candidate must use the same evaluator")
    if any(
        baseline_metadata.get(key) is None
        or baseline_metadata.get(key) != candidate_metadata.get(key)
        for key in _PAIRED_METADATA_KEYS
    ):
        raise ValueError("Baseline and candidate must use the same fixed inputs")
    judge_keys = (
        "outcomeJudgeModel",
        "outcomeJudgePromptVersion",
        "outcomeJudgeTemperature",
        "outcomeJudgeVoteCount",
    )
    if any(key in baseline_metadata or key in candidate_metadata for key in judge_keys) and any(
        baseline_metadata.get(key) is None
        or baseline_metadata.get(key) != candidate_metadata.get(key)
        for key in judge_keys
    ):
        raise ValueError("Baseline and candidate must use the same outcome Judge")
    if baseline_metadata.get("suiteVersion") != candidate_metadata.get("suiteVersion"):
        raise ValueError("Baseline and candidate must use the same fixed inputs")
    _validate_complete_workflow_attempts(baseline)
    _validate_complete_workflow_attempts(candidate)
    if _attempt_signatures(baseline) != _attempt_signatures(candidate):
        raise ValueError("Baseline and candidate must use the same fixed inputs")


def _validate_complete_workflow_attempts(report: dict[str, object]) -> None:
    if not isinstance(report.get("workflowEvaluation"), dict):
        return
    metadata = _object(report.get("metadata"), "Missing evaluation metadata")
    repetitions = metadata.get("repetitions")
    total_cases = report.get("totalCases")
    total_attempts = report.get("totalAttempts")
    results = _raw_results(report)
    if (
        not isinstance(repetitions, int)
        or isinstance(repetitions, bool)
        or repetitions < 1
        or not isinstance(total_cases, int)
        or isinstance(total_cases, bool)
        or total_cases < 1
        or total_attempts != total_cases * repetitions
        or len(results) != total_attempts
    ):
        raise ValueError("Evaluation report must contain complete unique workflow attempts")

    attempts_by_scenario: dict[str, set[int]] = {}
    signatures: set[tuple[str, int]] = set()
    for result in results:
        scenario_id = result.get("id")
        attempt = result.get("attempt")
        if (
            not isinstance(scenario_id, str)
            or not scenario_id
            or not isinstance(attempt, int)
            or isinstance(attempt, bool)
            or not 1 <= attempt <= repetitions
            or not isinstance(result.get("workflow"), dict)
            or (scenario_id, attempt) in signatures
        ):
            raise ValueError("Evaluation report must contain complete unique workflow attempts")
        signatures.add((scenario_id, attempt))
        attempts_by_scenario.setdefault(scenario_id, set()).add(attempt)
    expected_attempts = set(range(1, repetitions + 1))
    if len(attempts_by_scenario) != total_cases or any(
        attempts != expected_attempts for attempts in attempts_by_scenario.values()
    ):
        raise ValueError("Evaluation report must contain complete unique workflow attempts")


def _paired_improvement_evidence(
    baseline: dict[str, dict[str, object]],
    candidate: dict[str, dict[str, object]],
) -> dict[str, object]:
    scenario_pairs: dict[str, list[tuple[dict[str, object], dict[str, object]]]] = {}
    evidence_variants = ["agent_workflow"] if "agent_workflow" in baseline else sorted(baseline)
    for variant in evidence_variants:
        baseline_results = _raw_results(baseline[variant])
        candidate_results = _raw_results(candidate[variant])
        for baseline_result, candidate_result in zip(
            baseline_results, candidate_results, strict=True
        ):
            baseline_workflow = baseline_result.get("workflow")
            candidate_workflow = candidate_result.get("workflow")
            if (baseline_workflow is None) != (candidate_workflow is None):
                raise ValueError("Baseline and candidate workflow results must be paired")
            if baseline_workflow is None:
                continue
            _validate_workflow_result(baseline_result)
            _validate_workflow_result(candidate_result)
            key = f"{variant}:{baseline_result.get('id')}"
            scenario_pairs.setdefault(key, []).append((baseline_result, candidate_result))

    success_pairs: list[tuple[float, float]] = []
    contract_pairs: list[tuple[float, float]] = []
    latency_pairs: list[tuple[float, float]] = []
    token_pairs: list[tuple[float, float]] = []
    baseline_safety = 0
    candidate_safety = 0
    domain_success_pairs: dict[str, list[tuple[float, float]]] = {}
    category_success_pairs: dict[str, list[tuple[float, float]]] = {}
    for pairs in scenario_pairs.values():
        success_pair = (
            _mean([float(_task_success(item[0])) for item in pairs]),
            _mean([float(_task_success(item[1])) for item in pairs]),
        )
        success_pairs.append(success_pair)
        contract_pairs.append(
            (
                _mean([float(_execution_contract_passed(item[0])) for item in pairs]),
                _mean([float(_execution_contract_passed(item[1])) for item in pairs]),
            )
        )
        for domain in _expected_domains(pairs[0][0]):
            if domain != "routing_boundary":
                domain_success_pairs.setdefault(domain, []).append(success_pair)
        category = pairs[0][0].get("kind")
        if not isinstance(category, str) or not category:
            raise ValueError("Invalid workflow task category")
        category_success_pairs.setdefault(category, []).append(success_pair)
        latency_pair = _scenario_numeric_pair(pairs, "latencyMs")
        if latency_pair is not None:
            latency_pairs.append(latency_pair)
        token_pair = _scenario_numeric_pair(pairs, "providerTotalTokens")
        if token_pair is not None:
            token_pairs.append(token_pair)
        baseline_safety += sum(_safety_violation_count(item[0]) for item in pairs)
        candidate_safety += sum(_safety_violation_count(item[1]) for item in pairs)

    success_delta = [
        candidate_value - baseline_value for baseline_value, candidate_value in success_pairs
    ]
    confidence_interval = _bootstrap_mean_confidence_interval(success_delta)
    latency = _paired_numeric_summary(latency_pairs)
    tokens = (
        _paired_numeric_summary(token_pairs) if len(token_pairs) == len(scenario_pairs) else None
    )
    efficiency_passed = bool(
        (latency is not None and latency["confidenceInterval95"][1] < 0)
        or (tokens is not None and tokens["confidenceInterval95"][1] < 0)
    )
    safety_passed = baseline_safety == 0 and candidate_safety == 0
    success_passed = confidence_interval[0] > 0
    domain_task_success = _grouped_task_success(domain_success_pairs)
    domain_non_regression_passed = bool(domain_task_success) and all(
        item["passed"] is True for item in domain_task_success.values()
    )
    category_task_success = _grouped_task_success(category_success_pairs)
    category_non_regression_passed = bool(category_task_success) and all(
        item["passed"] is True for item in category_task_success.values()
    )
    return {
        "scopeVariants": evidence_variants,
        "uniqueScenarioCount": len(scenario_pairs),
        "bootstrap": {"cluster": "scenario", "seed": 17, "resamples": 2000},
        "taskSuccess": {
            "baseline": round(_mean([item[0] for item in success_pairs]), 4),
            "candidate": round(_mean([item[1] for item in success_pairs]), 4),
            "delta": round(_mean(success_delta), 4),
            "confidenceInterval95": list(confidence_interval),
            "passed": success_passed,
        },
        "executionContract": {
            "baseline": round(_mean([item[0] for item in contract_pairs]), 4),
            "candidate": round(_mean([item[1] for item in contract_pairs]), 4),
            "delta": round(
                _mean([candidate - baseline for baseline, candidate in contract_pairs]), 4
            ),
        },
        "latencyMs": latency,
        "providerTotalTokens": tokens,
        "efficiencyPassed": efficiency_passed,
        "domainTaskSuccess": domain_task_success,
        "domainNonRegressionPassed": domain_non_regression_passed,
        "categoryTaskSuccess": category_task_success,
        "categoryNonRegressionPassed": category_non_regression_passed,
        "safetyViolations": {
            "baseline": baseline_safety,
            "candidate": candidate_safety,
            "delta": candidate_safety - baseline_safety,
            "passed": safety_passed,
        },
        "passed": (
            success_passed
            and domain_non_regression_passed
            and category_non_regression_passed
            and safety_passed
        ),
    }


def _raw_results(report: dict[str, object]) -> list[dict[str, object]]:
    results = report.get("results")
    if not isinstance(results, list):
        raise ValueError("Evaluation report is missing attempt results")
    return [_object(item, "Invalid evaluation attempt") for item in results]


def _task_success(result: dict[str, object]) -> bool:
    workflow = result.get("workflow")
    if isinstance(workflow, dict) and isinstance(workflow.get("taskSuccess"), bool):
        return workflow["taskSuccess"]
    passed = result.get("passed")
    if not isinstance(passed, bool):
        raise ValueError("Invalid evaluation attempt result")
    return passed


def _execution_contract_passed(result: dict[str, object]) -> bool:
    workflow = result.get("workflow")
    if not isinstance(workflow, dict) or not isinstance(
        workflow.get("executionContractPassed"), bool
    ):
        raise ValueError("Invalid workflow execution contract result")
    return workflow["executionContractPassed"]


def _outcome_judge_verdict(result: dict[str, object]) -> str | None:
    workflow = result.get("workflow")
    if not isinstance(workflow, dict):
        return None
    judge = workflow.get("outcomeJudge")
    if not isinstance(judge, dict):
        return None
    verdict = judge.get("verdict")
    return verdict if isinstance(verdict, str) else None


def _validate_workflow_result(result: dict[str, object]) -> None:
    workflow = _object(result.get("workflow"), "Invalid workflow evaluation result")
    task_success = workflow.get("taskSuccess")
    if not isinstance(task_success, bool) or task_success is not result.get("passed"):
        raise ValueError("Invalid workflow task success result")
    if not isinstance(workflow.get("executionContractPassed"), bool):
        raise ValueError("Invalid workflow execution contract result")
    latency = workflow.get("latencyMs")
    if not isinstance(latency, int | float) or isinstance(latency, bool) or latency < 0:
        raise ValueError("Invalid workflow latency result")
    tokens = workflow.get("providerTotalTokens")
    if tokens is not None and (
        not isinstance(tokens, int) or isinstance(tokens, bool) or tokens < 0
    ):
        raise ValueError("Invalid workflow token result")
    safety = workflow.get("safetyViolations")
    if not isinstance(safety, list) or not all(isinstance(item, str) for item in safety):
        raise ValueError("Invalid workflow safety result")


def _expected_domains(result: dict[str, object]) -> tuple[str, ...]:
    expected = _object(result.get("expected"), "Invalid workflow expectation")
    domains = expected.get("evaluationDomains", expected.get("domains"))
    if not isinstance(domains, list) or not all(
        isinstance(domain, str) and domain for domain in domains
    ):
        raise ValueError("Invalid workflow expected domains")
    return tuple(domains)


def _grouped_task_success(
    groups: dict[str, list[tuple[float, float]]],
) -> dict[str, dict[str, float | int | bool]]:
    return {
        name: {
            "scenarioCount": len(pairs),
            "baseline": round(_mean([item[0] for item in pairs]), 4),
            "candidate": round(_mean([item[1] for item in pairs]), 4),
            "delta": round(_mean([item[1] - item[0] for item in pairs]), 4),
            "passed": _mean([item[1] - item[0] for item in pairs]) >= 0,
        }
        for name, pairs in sorted(groups.items())
    }


def _absolute_grouped_task_success(
    groups: dict[str, list[float]],
) -> dict[str, dict[str, float | int]]:
    return {
        name: {
            "scenarioCount": len(values),
            "rate": round(_mean(values), 4),
        }
        for name, values in sorted(groups.items())
    }


def _scenario_numeric_pair(
    pairs: list[tuple[dict[str, object], dict[str, object]]], key: str
) -> tuple[float, float] | None:
    values: list[tuple[float, float]] = []
    for baseline, candidate in pairs:
        baseline_value = _workflow_number(baseline, key)
        candidate_value = _workflow_number(candidate, key)
        if baseline_value is None or candidate_value is None:
            return None
        values.append((baseline_value, candidate_value))
    if not values:
        return None
    return _mean([item[0] for item in values]), _mean([item[1] for item in values])


def _workflow_number(result: dict[str, object], key: str) -> float | None:
    workflow = result.get("workflow")
    if not isinstance(workflow, dict):
        return None
    value = workflow.get(key)
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    return None


def _safety_violation_count(result: dict[str, object]) -> int:
    workflow = result.get("workflow")
    if not isinstance(workflow, dict):
        return 0
    violations = workflow.get("safetyViolations")
    if not isinstance(violations, list):
        return 0
    return len(violations)


def _paired_numeric_summary(
    pairs: list[tuple[float, float]],
) -> dict[str, float | list[float]] | None:
    if not pairs:
        return None
    baseline = _mean([item[0] for item in pairs])
    candidate = _mean([item[1] for item in pairs])
    deltas = [item[1] - item[0] for item in pairs]
    return {
        "baseline": round(baseline, 4),
        "candidate": round(candidate, 4),
        "delta": round(candidate - baseline, 4),
        "confidenceInterval95": list(_bootstrap_mean_confidence_interval(deltas)),
    }


def _bootstrap_mean_confidence_interval(values: list[float]) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    generator = random.Random(17)
    samples = sorted(_mean([generator.choice(values) for _ in values]) for _ in range(2000))
    return round(samples[49], 4), round(samples[1949], 4)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _attempt_signatures(report: dict[str, object]) -> tuple[tuple[object, ...], ...]:
    results = report.get("results")
    if not isinstance(results, list):
        raise ValueError("Evaluation report is missing attempt results")
    signatures = []
    for result in results:
        item = _object(result, "Invalid evaluation attempt")
        signatures.append((item.get("id"), item.get("attempt"), item.get("kind")))
    return tuple(signatures)


def _report_summary(report: dict[str, object]) -> dict[str, float | int | None]:
    funnel = _object(report.get("routingFunnel"), "Missing routing funnel")
    stages = _object(funnel.get("stages"), "Missing routing funnel stages")
    attempts = _nonnegative_int(report.get("totalAttempts"), "Invalid attempt count")
    results = _attempt_results(report, attempts)
    passed_attempts = sum(item["passed"] is True for item in results)
    workflow_mode = isinstance(report.get("workflowEvaluation"), dict)
    execution_contract_passed_attempts = (
        sum(_execution_contract_passed(item) for item in results)
        if workflow_mode
        else passed_attempts
    )
    tool_results = (
        results if workflow_mode else [item for item in results if _has_expected_tool(item)]
    )
    input_results = (
        results if workflow_mode else [item for item in results if _has_expected_input(item)]
    )
    if workflow_mode:
        tool_passed_attempts = _funnel_stage_count(stages, "toolExact")
        input_passed_attempts = _funnel_stage_count(stages, "requiredInputExact")
    else:
        tool_passed_attempts = sum("tool" not in item["failureReasons"] for item in tool_results)
        input_passed_attempts = sum("input" not in item["failureReasons"] for item in input_results)
    tool_selection_attempts = _nonnegative_int(
        funnel.get("toolSelectionAttempts"), "Invalid tool selection attempt count"
    )
    if tool_selection_attempts != len(tool_results):
        raise ValueError("Routing funnel does not match Tool assertion attempts")
    exact_attempt_rate = _fraction(execution_contract_passed_attempts, attempts)
    tool_selection_accuracy = (
        _fraction(tool_passed_attempts, len(tool_results)) if tool_results else None
    )
    required_input_accuracy = (
        _fraction(input_passed_attempts, len(input_results)) if input_results else None
    )
    reported_passed_attempts = _nonnegative_int(
        report.get("passedAttempts"), "Invalid passed attempt count"
    )
    if reported_passed_attempts > attempts or reported_passed_attempts != passed_attempts:
        raise ValueError("Invalid passed attempt count")
    if workflow_mode:
        reported_contract_passed_attempts = _nonnegative_int(
            report.get("executionContractPassAttempts"),
            "Invalid execution contract pass attempt count",
        )
        if (
            reported_contract_passed_attempts > attempts
            or reported_contract_passed_attempts != execution_contract_passed_attempts
        ):
            raise ValueError("Invalid execution contract pass attempt count")
    _validate_report_rate(report, "exactAttemptRate", exact_attempt_rate)
    if not workflow_mode:
        _validate_report_rate(report, "toolSelectionAccuracy", tool_selection_accuracy)
        _validate_report_rate(report, "requiredInputAccuracy", required_input_accuracy)
    summary: dict[str, float | int | None] = {
        "attempts": attempts,
        "passedAttempts": passed_attempts,
        "executionContractPassAttempts": execution_contract_passed_attempts,
        "toolSelectionAttempts": tool_selection_attempts,
        "toolSelectionPassedAttempts": tool_passed_attempts,
        "requiredInputAttempts": len(input_results),
        "requiredInputPassedAttempts": input_passed_attempts,
        "exactAttemptRate": exact_attempt_rate,
        "toolSelectionAccuracy": tool_selection_accuracy,
        "requiredInputAccuracy": required_input_accuracy,
    }
    multi_tool = report.get("multiToolWorkflows")
    if multi_tool is not None:
        multi_tool_summary = _object(multi_tool, "Invalid multi-tool workflow summary")
        workflow_attempts = _nonnegative_int(
            multi_tool_summary.get("workflowAttempts"),
            "Invalid multi-tool workflow attempt count",
        )
        exact_workflow_attempts = _nonnegative_int(
            multi_tool_summary.get("exactWorkflowAttempts"),
            "Invalid multi-tool exact workflow count",
        )
        if exact_workflow_attempts > workflow_attempts:
            raise ValueError("Invalid multi-tool exact workflow count")
        exact_workflow_rate = _fraction(exact_workflow_attempts, workflow_attempts)
        if (
            _rate(
                multi_tool_summary.get("exactWorkflowRate"),
                "Invalid multi-tool workflow rate",
            )
            != exact_workflow_rate
        ):
            raise ValueError("Invalid multi-tool workflow rate")
        summary["multiToolWorkflowAttempts"] = workflow_attempts
        summary["multiToolExactWorkflowAttempts"] = exact_workflow_attempts
        summary["multiToolExactWorkflowRate"] = exact_workflow_rate
    previous_count = int(summary["toolSelectionAttempts"])
    for stage_name in _FUNNEL_STAGES:
        stage = _object(stages.get(stage_name), f"Missing funnel stage: {stage_name}")
        count = _nonnegative_int(stage.get("count"), f"Invalid funnel count: {stage_name}")
        if count > previous_count:
            raise ValueError(f"Invalid non-cumulative funnel count: {stage_name}")
        overall_rate = _rate(stage.get("overallRate"), f"Invalid funnel rate: {stage_name}")
        conditional_rate = _rate(
            stage.get("conditionalRate"), f"Invalid conditional rate: {stage_name}"
        )
        expected_overall = _fraction(count, int(summary["toolSelectionAttempts"]))
        expected_conditional = _fraction(count, previous_count)
        if overall_rate != expected_overall or conditional_rate != expected_conditional:
            raise ValueError(f"Inconsistent funnel rate: {stage_name}")
        summary[f"{stage_name}Count"] = count
        summary[f"{stage_name}OverallRate"] = overall_rate
        summary[f"{stage_name}ConditionalRate"] = conditional_rate
        previous_count = count
    summary["conditionalToolAccuracy"] = summary["toolExactConditionalRate"]
    summary["endToEndExactRate"] = summary["endToEndExactOverallRate"]
    return summary


def _funnel_stage_count(stages: dict[str, object], stage_name: str) -> int:
    stage = _object(stages.get(stage_name), f"Missing funnel stage: {stage_name}")
    return _nonnegative_int(stage.get("count"), f"Invalid funnel count: {stage_name}")


def _aggregate(reports: Iterable[dict[str, object]]) -> dict[str, float | int | None]:
    summaries = [_report_summary(report) for report in reports]
    attempts = sum(int(summary["attempts"]) for summary in summaries)
    passed_attempts = sum(int(summary["passedAttempts"]) for summary in summaries)
    execution_contract_passed_attempts = sum(
        int(summary["executionContractPassAttempts"]) for summary in summaries
    )
    tool_attempts = sum(int(summary["toolSelectionAttempts"]) for summary in summaries)
    tool_passed_attempts = sum(int(summary["toolSelectionPassedAttempts"]) for summary in summaries)
    input_attempts = sum(int(summary["requiredInputAttempts"]) for summary in summaries)
    input_passed_attempts = sum(
        int(summary["requiredInputPassedAttempts"]) for summary in summaries
    )
    result: dict[str, float | int | None] = {
        "attempts": attempts,
        "passedAttempts": passed_attempts,
        "executionContractPassAttempts": execution_contract_passed_attempts,
        "toolSelectionAttempts": tool_attempts,
        "toolSelectionPassedAttempts": tool_passed_attempts,
        "requiredInputAttempts": input_attempts,
        "requiredInputPassedAttempts": input_passed_attempts,
    }
    multi_tool_workflow_attempts = sum(
        int(summary.get("multiToolWorkflowAttempts") or 0) for summary in summaries
    )
    multi_tool_exact_attempts = sum(
        int(summary.get("multiToolExactWorkflowAttempts") or 0) for summary in summaries
    )
    if multi_tool_workflow_attempts:
        result["multiToolWorkflowAttempts"] = multi_tool_workflow_attempts
        result["multiToolExactWorkflowAttempts"] = multi_tool_exact_attempts
        result["multiToolExactWorkflowRate"] = _fraction(
            multi_tool_exact_attempts, multi_tool_workflow_attempts
        )
    previous_count = tool_attempts
    for stage_name in _FUNNEL_STAGES:
        count = sum(int(summary[f"{stage_name}Count"]) for summary in summaries)
        result[f"{stage_name}Count"] = count
        result[f"{stage_name}OverallRate"] = _fraction(count, tool_attempts)
        result[f"{stage_name}ConditionalRate"] = _fraction(count, previous_count)
        previous_count = count
    result["conditionalToolAccuracy"] = result["toolExactConditionalRate"]
    result["endToEndExactRate"] = result["endToEndExactOverallRate"]
    result["exactAttemptRate"] = _fraction(execution_contract_passed_attempts, attempts)
    result["toolSelectionAccuracy"] = _fraction(tool_passed_attempts, tool_attempts)
    result["requiredInputAccuracy"] = (
        _fraction(input_passed_attempts, input_attempts) if input_attempts else None
    )
    return result


def _summary_delta(
    baseline: dict[str, float | int | None], candidate: dict[str, float | int | None]
) -> dict[str, float]:
    metric_names = (
        "exactAttemptRate",
        "toolSelectionAccuracy",
        "requiredInputAccuracy",
        "domainExactOverallRate",
        "capabilityExactOverallRate",
        "conditionalToolAccuracy",
        "endToEndExactRate",
        "multiToolExactWorkflowRate",
    )
    return {
        name: round(float(candidate[name]) - float(baseline[name]), 4)
        for name in metric_names
        if isinstance(baseline.get(name), int | float)
        and not isinstance(baseline.get(name), bool)
        and isinstance(candidate.get(name), int | float)
        and not isinstance(candidate.get(name), bool)
    }


def _attempt_results(report: dict[str, object], attempts: int) -> list[dict[str, object]]:
    raw_results = report.get("results")
    if not isinstance(raw_results, list) or len(raw_results) != attempts:
        raise ValueError("Evaluation report attempt results are incomplete")
    results = [_object(item, "Invalid evaluation attempt") for item in raw_results]
    for item in results:
        if not isinstance(item.get("passed"), bool):
            raise ValueError("Invalid evaluation attempt result")
        failure_reasons = item.get("failureReasons")
        if not isinstance(failure_reasons, list) or not all(
            isinstance(reason, str) for reason in failure_reasons
        ):
            raise ValueError("Invalid evaluation attempt failure reasons")
        _object(item.get("expected"), "Missing evaluation attempt expectation")
    return results


def _has_expected_tool(result: dict[str, object]) -> bool:
    expected = _object(result.get("expected"), "Missing evaluation attempt expectation")
    return isinstance(expected.get("toolName"), str) and bool(expected["toolName"])


def _has_expected_input(result: dict[str, object]) -> bool:
    expected = _object(result.get("expected"), "Missing evaluation attempt expectation")
    input_fields = expected.get("inputFields")
    return isinstance(input_fields, list) and bool(input_fields)


def _validate_report_rate(report: dict[str, object], key: str, expected: float | None) -> None:
    actual = report.get(key)
    if expected is None:
        if actual is not None:
            raise ValueError(f"Invalid report rate: {key}")
        return
    if _rate(actual, f"Invalid report rate: {key}") != expected:
        raise ValueError(f"Invalid report rate: {key}")


def _common_revision(reports: Iterable[dict[str, object]]) -> str:
    revisions = {
        _object(report.get("metadata"), "Missing evaluation metadata").get("sourceRevision")
        for report in reports
    }
    if len(revisions) != 1 or not isinstance(next(iter(revisions)), str):
        raise ValueError("Evaluation reports must share one source revision")
    return next(iter(revisions))


def _common_metadata(
    reports: Iterable[dict[str, object]], keys: tuple[str, ...]
) -> dict[str, object]:
    metadata_items = [
        _object(report.get("metadata"), "Missing evaluation metadata") for report in reports
    ]
    common: dict[str, object] = {}
    for key in keys:
        values = {metadata.get(key) for metadata in metadata_items}
        if len(values) != 1 or next(iter(values)) is None:
            raise ValueError(f"Evaluation reports must share metadata: {key}")
        common[key] = next(iter(values))
    return common


def _object(value: object, message: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(message)
    return value


def _number(value: object, message: str) -> float:
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise ValueError(message)
    return float(value)


def _rate(value: object, message: str) -> float:
    number = _number(value, message)
    if not 0 <= number <= 1:
        raise ValueError(message)
    return number


def _nonnegative_int(value: object, message: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(message)
    return value


def _fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0
