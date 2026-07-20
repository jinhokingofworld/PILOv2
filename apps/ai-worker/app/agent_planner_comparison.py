from __future__ import annotations

from collections.abc import Iterable

COMPARISON_FORMAT = "agent-llm-router-planner-comparison:v1"
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
    "model",
    "routerModel",
    "currentDate",
    "timezone",
    "repetitions",
    "retrievalTopK",
    "evaluationSeed",
)
_REVISION_BINDING_KEYS = (
    "sourceRevision",
    "suiteSha256",
    "toolCapabilityCatalogFileSha256",
    "registryInventorySha256",
    "registryCatalogSha256",
    "registryEligibleSnapshotSha256",
)


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

    baseline_aggregate = _aggregate(baseline.values())
    candidate_aggregate = _aggregate(candidate.values())
    return {
        "format": COMPARISON_FORMAT,
        "sameEvaluationInputs": True,
        "baselineRevision": _common_revision(baseline.values()),
        "candidateRevision": _common_revision(candidate.values()),
        "fixedInputs": _common_metadata(baseline.values(), _PAIRED_METADATA_KEYS),
        "baselineBinding": _common_metadata(baseline.values(), _REVISION_BINDING_KEYS),
        "candidateBinding": _common_metadata(candidate.values(), _REVISION_BINDING_KEYS),
        "variants": variants,
        "aggregate": {
            "baseline": baseline_aggregate,
            "candidate": candidate_aggregate,
            "delta": _summary_delta(baseline_aggregate, candidate_aggregate),
        },
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
    if any(
        baseline_metadata.get(key) is None
        or baseline_metadata.get(key) != candidate_metadata.get(key)
        for key in _PAIRED_METADATA_KEYS
    ):
        raise ValueError("Baseline and candidate must use the same fixed inputs")
    if baseline_metadata.get("suiteVersion") != candidate_metadata.get("suiteVersion"):
        raise ValueError("Baseline and candidate must use the same fixed inputs")
    if _attempt_signatures(baseline) != _attempt_signatures(candidate):
        raise ValueError("Baseline and candidate must use the same fixed inputs")


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
    tool_results = [item for item in results if _has_expected_tool(item)]
    input_results = [item for item in results if _has_expected_input(item)]
    tool_passed_attempts = sum("tool" not in item["failureReasons"] for item in tool_results)
    input_passed_attempts = sum("input" not in item["failureReasons"] for item in input_results)
    tool_selection_attempts = _nonnegative_int(
        funnel.get("toolSelectionAttempts"), "Invalid tool selection attempt count"
    )
    if tool_selection_attempts != len(tool_results):
        raise ValueError("Routing funnel does not match Tool assertion attempts")
    exact_attempt_rate = _fraction(passed_attempts, attempts)
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
    _validate_report_rate(report, "exactAttemptRate", exact_attempt_rate)
    _validate_report_rate(report, "toolSelectionAccuracy", tool_selection_accuracy)
    _validate_report_rate(report, "requiredInputAccuracy", required_input_accuracy)
    summary: dict[str, float | int | None] = {
        "attempts": attempts,
        "passedAttempts": passed_attempts,
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
        if _rate(
            multi_tool_summary.get("exactWorkflowRate"),
            "Invalid multi-tool workflow rate",
        ) != exact_workflow_rate:
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


def _aggregate(reports: Iterable[dict[str, object]]) -> dict[str, float | int | None]:
    summaries = [_report_summary(report) for report in reports]
    attempts = sum(int(summary["attempts"]) for summary in summaries)
    passed_attempts = sum(int(summary["passedAttempts"]) for summary in summaries)
    tool_attempts = sum(int(summary["toolSelectionAttempts"]) for summary in summaries)
    tool_passed_attempts = sum(int(summary["toolSelectionPassedAttempts"]) for summary in summaries)
    input_attempts = sum(int(summary["requiredInputAttempts"]) for summary in summaries)
    input_passed_attempts = sum(
        int(summary["requiredInputPassedAttempts"]) for summary in summaries
    )
    result: dict[str, float | int | None] = {
        "attempts": attempts,
        "passedAttempts": passed_attempts,
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
    result["exactAttemptRate"] = _fraction(passed_attempts, attempts)
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
