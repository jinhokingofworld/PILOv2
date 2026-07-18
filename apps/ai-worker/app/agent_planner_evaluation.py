from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from pathlib import Path
from time import perf_counter
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from app.agent_processor import (
    AGENT_RUN_REQUESTED_JOB_TYPE,
    AgentPlannerClient,
    AgentPlanningRequest,
    AgentRunJob,
    AgentToolSchema,
    NormalizedPlannerDecision,
    normalize_agent_planner_decision,
    parse_agent_run_job_payload,
)
from app.agent_tool_retrieval import (
    ToolRetrievalResult,
    parse_tool_capability_catalog,
    retrieve_tool_shortlist,
)

EVALUATION_RUN_ID = "00000000-0000-4000-8000-000000000001"
EVALUATION_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002"
EVALUATION_USER_ID = "00000000-0000-4000-8000-000000000003"


def build_evaluation_input_hashes(
    tool_snapshot_path: Path,
    meeting_catalog_path: Path | None = None,
    tool_capability_catalog_path: Path | None = None,
) -> dict[str, str]:
    hashes = {
        "suiteSha256": hashlib.sha256(tool_snapshot_path.read_bytes()).hexdigest(),
    }
    if meeting_catalog_path:
        hashes["meetingCatalogSha256"] = hashlib.sha256(
            meeting_catalog_path.read_bytes()
        ).hexdigest()
    if tool_capability_catalog_path:
        hashes["toolCapabilityCatalogFileSha256"] = hashlib.sha256(
            tool_capability_catalog_path.read_bytes()
        ).hexdigest()
    return hashes


@dataclass(frozen=True)
class EvaluationExpectation:
    status: str
    tool_name: str | None
    input_contains: dict[str, object]
    requires_confirmation: bool | None
    missing_fields: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    prompt: str
    kind: str
    expectation: EvaluationExpectation


@dataclass(frozen=True)
class EvaluationSuite:
    version: str
    job: AgentRunJob
    cases: tuple[EvaluationCase, ...]


@dataclass(frozen=True)
class CaseEvaluationResult:
    case_id: str
    attempt: int
    prompt: str
    kind: str
    passed: bool
    failure_reasons: tuple[str, ...]
    expected: EvaluationExpectation
    actual: NormalizedPlannerDecision
    retrieval: ToolRetrievalResult | None
    shortlist_tool_names: tuple[str, ...]
    shortlist_schema_bytes: int
    retrieval_latency_ms: float
    planner_latency_ms: float
    shortlist_violation: bool


class PlannerEvaluator(Protocol):
    def plan(self, request: AgentPlanningRequest): ...


def attach_tool_capability_catalog(suite: EvaluationSuite, catalog_path: Path) -> EvaluationSuite:
    try:
        raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid tool capability catalog JSON: {catalog_path}") from error
    catalog = parse_tool_capability_catalog(raw, {tool.name for tool in suite.job.tools})
    if catalog is None:
        raise ValueError("Tool capability catalog is required")
    return replace(suite, job=replace(suite.job, tool_capability_catalog=catalog))


def load_evaluation_suite(path: Path) -> EvaluationSuite:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid evaluation suite JSON: {path}") from error

    if not isinstance(raw, dict):
        raise ValueError("Evaluation suite must be an object")

    version = _require_string(raw, "version")
    tools = raw.get("tools")
    cases = raw.get("cases")
    if not isinstance(tools, list) or not isinstance(cases, list):
        raise ValueError("Evaluation suite must include tools and cases arrays")

    job = parse_agent_run_job_payload(
        {
            "jobType": AGENT_RUN_REQUESTED_JOB_TYPE,
            "runId": EVALUATION_RUN_ID,
            "workspaceId": EVALUATION_WORKSPACE_ID,
            "requestedByUserId": EVALUATION_USER_ID,
            "toolSchemaVersion": _require_string(raw, "toolSchemaVersion"),
            "tools": tools,
            "toolCapabilityCatalog": raw.get("toolCapabilityCatalog"),
        }
    )

    parsed_cases = tuple(_parse_case(item) for item in cases)
    if not parsed_cases:
        raise ValueError("Evaluation suite must include at least one case")
    if len({case.case_id for case in parsed_cases}) != len(parsed_cases):
        raise ValueError("Evaluation suite contains duplicate case IDs")

    return EvaluationSuite(version=version, job=job, cases=parsed_cases)


def load_meeting_regression_suite(
    catalog_path: Path,
    tool_snapshot_path: Path,
    variant: str,
) -> EvaluationSuite:
    if variant not in {"canonical", "held_out", "counterexample"}:
        raise ValueError(
            "Meeting regression variant must be canonical, held_out, or counterexample"
        )

    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid meeting regression catalog JSON: {catalog_path}") from error
    if not isinstance(catalog, dict):
        raise ValueError("Meeting regression catalog must be an object")

    prefixes = catalog.get("canonicalPrefixes")
    capabilities = catalog.get("capabilities")
    if (
        not isinstance(prefixes, list)
        or not all(isinstance(prefix, str) for prefix in prefixes)
        or not isinstance(capabilities, list)
    ):
        raise ValueError("Meeting regression catalog has invalid capability variants")

    base_suite = load_evaluation_suite(tool_snapshot_path)
    capability_by_id = {
        _require_string(capability, "id"): capability
        for capability in capabilities
        if isinstance(capability, dict)
    }
    cases: list[EvaluationCase] = []
    for capability in capabilities:
        if not isinstance(capability, dict):
            raise ValueError("Meeting regression capability must be an object")
        capability_id = _require_string(capability, "id")
        if variant == "canonical":
            expectation = _meeting_regression_expectation(capability)
            seeds = capability.get("canonicalSeeds")
            if not isinstance(seeds, list) or not all(
                isinstance(seed, str) and seed for seed in seeds
            ):
                raise ValueError("Meeting regression canonicalSeeds must be a string array")
            prompts = [f"{prefix}{seed}".strip() for prefix in prefixes for seed in seeds]
            prompt_expectations = [(prompt, expectation) for prompt in prompts]
        elif variant == "held_out":
            expectation = _meeting_regression_expectation(capability)
            prompts = capability.get("heldOutParaphrases")
            if not isinstance(prompts, list) or not all(
                isinstance(prompt, str) and prompt for prompt in prompts
            ):
                raise ValueError("Meeting regression heldOutParaphrases must be a string array")
            prompt_expectations = [(prompt, expectation) for prompt in prompts]
        else:
            counterexamples = capability.get("counterexamples")
            if not isinstance(counterexamples, list):
                raise ValueError("Meeting regression counterexamples must be an array")
            prompt_expectations = []
            for item in counterexamples:
                if not isinstance(item, dict):
                    raise ValueError("Meeting regression counterexample must be an object")
                expected_capability = capability_by_id.get(
                    _require_string(item, "expectedCapability")
                )
                if expected_capability is None:
                    raise ValueError("Meeting regression counterexample capability is unknown")
                prompt_expectations.append(
                    (
                        _require_string(item, "prompt"),
                        _meeting_regression_expectation(expected_capability),
                    )
                )

        for index, (prompt, expectation) in enumerate(prompt_expectations, start=1):
            cases.append(
                EvaluationCase(
                    case_id=f"{capability_id}:{variant}:{index}",
                    prompt=prompt,
                    kind=variant,
                    expectation=expectation,
                )
            )

    if not cases:
        raise ValueError("Meeting regression catalog must produce at least one case")
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError("Meeting regression catalog produced duplicate case IDs")

    return EvaluationSuite(
        version=f"{_require_string(catalog, 'version')}:{variant}",
        job=base_suite.job,
        cases=tuple(cases),
    )


def _meeting_regression_expectation(capability: dict[str, object]) -> EvaluationExpectation:
    raw = capability.get("currentExpectation")
    if not isinstance(raw, dict):
        raise ValueError("Meeting regression capability must include currentExpectation")
    tool_name = raw.get("toolName")
    if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
        raise ValueError("Meeting regression currentExpectation toolName must be a string")
    return EvaluationExpectation(
        status=_require_string(raw, "status"),
        tool_name=tool_name,
        input_contains={},
        requires_confirmation=None,
        missing_fields=(),
    )


def evaluate_suite(
    planner: AgentPlannerClient,
    suite: EvaluationSuite,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
    use_shadow_retrieval: bool = False,
    shadow_top_k: int = 8,
) -> tuple[CaseEvaluationResult, ...]:
    if repetitions < 1:
        raise ValueError("Evaluation repetitions must be at least 1")

    return tuple(
        evaluate_case(
            planner,
            suite.job,
            case,
            current_date,
            timezone,
            attempt,
            use_shadow_retrieval=use_shadow_retrieval,
            shadow_top_k=shadow_top_k,
        )
        for attempt in range(1, repetitions + 1)
        for case in suite.cases
    )


def evaluate_case(
    planner: AgentPlannerClient,
    job: AgentRunJob,
    case: EvaluationCase,
    current_date: str,
    timezone: str,
    attempt: int,
    *,
    use_shadow_retrieval: bool = False,
    shadow_top_k: int = 8,
) -> CaseEvaluationResult:
    tools = job.tools
    retrieval = None
    retrieval_latency_ms = 0.0
    if use_shadow_retrieval:
        retrieval_started = perf_counter()
        tools, retrieval = select_shadow_planner_tools(job, case.prompt, top_k=shadow_top_k)
        retrieval_latency_ms = (perf_counter() - retrieval_started) * 1000

    planner_started = perf_counter()
    decision = planner.plan(
        AgentPlanningRequest(
            run_id=str(uuid5(NAMESPACE_URL, f"agent-planner-evaluation:{case.case_id}:{attempt}")),
            prompt=case.prompt,
            timezone=timezone,
            current_date=current_date,
            tool_schema_version=job.tool_schema_version,
            tools=tools,
        )
    )
    planner_latency_ms = (perf_counter() - planner_started) * 1000
    shortlist_tool_names = tuple(tool.name for tool in tools)
    shortlist_violation = bool(
        retrieval
        and not retrieval.low_confidence
        and decision.tool_name
        and decision.tool_name not in shortlist_tool_names
    )
    actual = normalize_agent_planner_decision(
        decision,
        replace(job, tools=tools),
        prompt=case.prompt,
        current_date=current_date,
    )
    failures = _compare(case.expectation, actual)
    if shortlist_violation:
        failures.append("shortlist_tool")
    return CaseEvaluationResult(
        case_id=case.case_id,
        attempt=attempt,
        prompt=case.prompt,
        kind=case.kind,
        passed=not failures,
        failure_reasons=tuple(failures),
        expected=case.expectation,
        actual=actual,
        retrieval=retrieval,
        shortlist_tool_names=shortlist_tool_names,
        shortlist_schema_bytes=_tool_schema_bytes(tools),
        retrieval_latency_ms=retrieval_latency_ms,
        planner_latency_ms=planner_latency_ms,
        shortlist_violation=shortlist_violation,
    )


def select_shadow_planner_tools(
    job: AgentRunJob, prompt: str, top_k: int = 8
) -> tuple[tuple[AgentToolSchema, ...], ToolRetrievalResult | None]:
    catalog = job.tool_capability_catalog
    if catalog is None:
        return job.tools, None

    retrieval = retrieve_tool_shortlist(prompt, catalog, top_k=top_k)
    if retrieval.low_confidence:
        return job.tools, retrieval

    selected_names = set(retrieval.tool_names)
    return tuple(tool for tool in job.tools if tool.name in selected_names), retrieval


def build_evaluation_report(results: tuple[CaseEvaluationResult, ...]) -> dict[str, object]:
    tool_cases = [result for result in results if result.expected.tool_name]
    input_cases = [result for result in results if result.expected.input_contains]
    confirmation_cases = [
        result for result in results if result.expected.requires_confirmation is not None
    ]
    clarification_cases = [result for result in results if result.expected.missing_fields]
    cases_by_id: dict[str, list[CaseEvaluationResult]] = {}
    for result in results:
        cases_by_id.setdefault(result.case_id, []).append(result)

    case_summaries = [
        _case_summary(case_id, case_results)
        for case_id, case_results in sorted(cases_by_id.items())
    ]
    retrieval_results = [result for result in results if result.retrieval is not None]
    retrieval_tool_cases = [result for result in retrieval_results if result.expected.tool_name]
    adjacent_negative_results = [
        result for result in retrieval_tool_cases if result.kind == "counterexample"
    ]

    return {
        "totalCases": len(case_summaries),
        "totalAttempts": len(results),
        "passedCases": sum(summary["exactRate"] == 1.0 for summary in case_summaries),
        "passedAttempts": sum(result.passed for result in results),
        "exactAttemptRate": _exact_rate(results),
        "statusAccuracy": _accuracy(results, "status"),
        "toolSelectionAccuracy": _accuracy(tool_cases, "tool"),
        "requiredInputAccuracy": _accuracy(input_cases, "input"),
        "confirmationAccuracy": _accuracy(confirmation_cases, "confirmation"),
        "clarificationAccuracy": _accuracy(clarification_cases, "missing_fields"),
        "planner": {
            "latencyMs": _latency_summary([result.planner_latency_ms for result in results]),
            "averageEstimatedToolSchemaTokens": _average(
                [(result.shortlist_schema_bytes + 3) // 4 for result in results]
            ),
        },
        "retrieval": {
            "attempts": len(retrieval_results),
            "toolRecall": _retrieval_recall(retrieval_tool_cases),
            "adjacentNegativeRoutingAccuracy": _retrieval_recall(adjacent_negative_results),
            "averageShortlistSize": _average(
                [len(result.shortlist_tool_names) for result in retrieval_results]
            ),
            "averageEstimatedToolSchemaTokens": _average(
                [(result.shortlist_schema_bytes + 3) // 4 for result in retrieval_results]
            ),
            "fallbackTaxonomy": _fallback_taxonomy(retrieval_results),
            "shortlistViolations": sum(result.shortlist_violation for result in retrieval_results),
            "retrievalLatencyMs": _latency_summary(
                [result.retrieval_latency_ms for result in retrieval_results]
            ),
            "plannerLatencyMs": _latency_summary(
                [result.planner_latency_ms for result in retrieval_results]
            ),
        },
        "flakyCaseIds": [
            summary["id"] for summary in case_summaries if 0.0 < summary["exactRate"] < 1.0
        ],
        "caseSummaries": case_summaries,
        "results": [
            {
                "id": result.case_id,
                "attempt": result.attempt,
                "kind": result.kind,
                "expected": _privacy_safe_expected(result.expected),
                "passed": result.passed,
                "classification": _classification(result),
                "failureReasons": list(result.failure_reasons),
                "failureCategoryCandidates": _failure_category_candidates(result),
                "actual": _privacy_safe_actual(result.actual),
                "retrieval": _retrieval_output(result),
            }
            for result in results
        ],
    }


def _parse_case(value: object) -> EvaluationCase:
    if not isinstance(value, dict):
        raise ValueError("Evaluation case must be an object")
    expected = value.get("expected")
    if not isinstance(expected, dict):
        raise ValueError("Evaluation case must include expected")
    input_contains = expected.get("inputContains", {})
    if not isinstance(input_contains, dict):
        raise ValueError("Evaluation expected inputContains must be an object")
    missing_fields = expected.get("missingFields", [])
    if not isinstance(missing_fields, list) or not all(
        isinstance(field, str) and field for field in missing_fields
    ):
        raise ValueError("Evaluation expected missingFields must be a string array")
    requires_confirmation = expected.get("requiresConfirmation")
    if requires_confirmation is not None and not isinstance(requires_confirmation, bool):
        raise ValueError("Evaluation expected requiresConfirmation must be a boolean")

    tool_name = expected.get("toolName")
    if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
        raise ValueError("Evaluation expected toolName must be a string")

    return EvaluationCase(
        case_id=_require_string(value, "id"),
        prompt=_require_string(value, "prompt"),
        kind=_optional_kind(value),
        expectation=EvaluationExpectation(
            status=_require_string(expected, "status"),
            tool_name=tool_name,
            input_contains=dict(input_contains),
            requires_confirmation=requires_confirmation,
            missing_fields=tuple(missing_fields),
        ),
    )


def _compare(
    expected: EvaluationExpectation,
    actual: NormalizedPlannerDecision,
) -> list[str]:
    failures: list[str] = []
    summary = actual.output_summary
    if actual.status != expected.status:
        failures.append("status")
    if expected.tool_name and summary.get("toolName") != expected.tool_name:
        failures.append("tool")
    if expected.requires_confirmation is not None and (
        summary.get("requiresConfirmation") is not expected.requires_confirmation
    ):
        failures.append("confirmation")
    actual_input = summary.get("input", {})
    if not isinstance(actual_input, dict) or not _contains(actual_input, expected.input_contains):
        failures.append("input")
    actual_missing = summary.get("missingFields", [])
    if expected.missing_fields and not set(expected.missing_fields).issubset(actual_missing):
        failures.append("missing_fields")
    return failures


def _contains(actual: dict[str, object], expected: dict[str, object]) -> bool:
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, dict):
            if not isinstance(actual_value, dict) or not _contains(actual_value, expected_value):
                return False
        elif actual_value != expected_value:
            return False
    return True


def _accuracy(results: list[CaseEvaluationResult], category: str) -> float | None:
    if not results:
        return None
    return round(
        sum(category not in result.failure_reasons for result in results) / len(results), 4
    )


def _exact_rate(results: list[CaseEvaluationResult]) -> float | None:
    if not results:
        return None
    return round(sum(result.passed for result in results) / len(results), 4)


def _case_summary(
    case_id: str,
    results: list[CaseEvaluationResult],
) -> dict[str, object]:
    return {
        "id": case_id,
        "kind": results[0].kind,
        "expected": _privacy_safe_expected(results[0].expected),
        "attempts": len(results),
        "exactCount": sum(result.passed for result in results),
        "exactRate": _exact_rate(results),
        "requiresManualReview": not all(result.passed for result in results),
        "failureCategoryCandidates": sorted(
            {category for result in results for category in _failure_category_candidates(result)}
        ),
    }


def _tool_schema_bytes(tools: tuple[AgentToolSchema, ...]) -> int:
    payload = [
        {
            "name": tool.name,
            "description": tool.description,
            "riskLevel": tool.risk_level,
            "executionMode": tool.execution_mode,
            "inputSchema": tool.input_schema,
        }
        for tool in tools
    ]
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _retrieval_recall(results: list[CaseEvaluationResult]) -> float | None:
    if not results:
        return None
    return round(
        sum(
            bool(result.retrieval and result.expected.tool_name in result.retrieval.tool_names)
            for result in results
        )
        / len(results),
        4,
    )


def _average(values: list[int]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def _fallback_taxonomy(results: list[CaseEvaluationResult]) -> dict[str, int]:
    taxonomy: dict[str, int] = {}
    for result in results:
        reason = result.retrieval.fallback_reason if result.retrieval else None
        if reason:
            taxonomy[reason] = taxonomy.get(reason, 0) + 1
    return dict(sorted(taxonomy.items()))


def _latency_summary(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    p50_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.5))
    p95_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.95))
    return {
        "average": round(sum(ordered) / len(ordered), 4),
        "p50": round(ordered[p50_index], 4),
        "p95": round(ordered[p95_index], 4),
    }


def _privacy_safe_expected(expected: EvaluationExpectation) -> dict[str, object]:
    output: dict[str, object] = {"status": expected.status}
    if expected.tool_name:
        output["toolName"] = expected.tool_name
    if expected.input_contains:
        output["inputFields"] = sorted(expected.input_contains)
    if expected.requires_confirmation is not None:
        output["requiresConfirmation"] = expected.requires_confirmation
    if expected.missing_fields:
        output["missingFields"] = list(expected.missing_fields)
    return output


def _privacy_safe_actual(actual: NormalizedPlannerDecision) -> dict[str, object]:
    summary = actual.output_summary
    output: dict[str, object] = {"status": actual.status}
    for key in ("toolName", "requiresConfirmation", "missingFields"):
        if key in summary:
            output[key] = summary[key]
    input_value = summary.get("input")
    if isinstance(input_value, dict) and input_value:
        output["inputFields"] = sorted(input_value)
    return output


def _retrieval_output(result: CaseEvaluationResult) -> dict[str, object] | None:
    retrieval = result.retrieval
    if retrieval is None:
        return None
    return {
        "shortlistToolNames": list(result.shortlist_tool_names),
        "shortlistSize": len(result.shortlist_tool_names),
        "expectedToolIncluded": (
            result.expected.tool_name in retrieval.tool_names if result.expected.tool_name else None
        ),
        "lowConfidence": retrieval.low_confidence,
        "fallbackReason": retrieval.fallback_reason,
        "shortlistViolation": result.shortlist_violation,
        "retrievalLatencyMs": round(result.retrieval_latency_ms, 4),
        "plannerLatencyMs": round(result.planner_latency_ms, 4),
        "toolSchemaBytes": result.shortlist_schema_bytes,
        "estimatedToolSchemaTokens": (result.shortlist_schema_bytes + 3) // 4,
    }


def _optional_kind(value: dict[object, object]) -> str:
    kind = value.get("kind", "positive")
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError("Evaluation case kind must be a string")
    return kind.strip()


def _failure_category_candidates(result: CaseEvaluationResult) -> list[str]:
    categories: list[str] = []
    expected = result.expected
    if expected.status == "unsupported" and result.actual.status != "unsupported":
        categories.append("unsafe_candidate")
    if "tool" in result.failure_reasons:
        categories.append("wrong_tool")
    if "shortlist_tool" in result.failure_reasons:
        categories.append("shortlist_violation")
    if "status" in result.failure_reasons:
        categories.append("wrong_status")
    if "input" in result.failure_reasons:
        input_keys = set(expected.input_contains)
        if input_keys & {"start", "end", "startDate", "endDate", "startTime", "endTime"}:
            categories.append("date_time_normalization")
        else:
            categories.append("required_input")
    if "missing_fields" in result.failure_reasons:
        categories.append("missing_field_handling")
    if "confirmation" in result.failure_reasons:
        categories.append("confirmation_policy")
    return categories


def _classification(result: CaseEvaluationResult) -> str:
    if result.passed:
        return "exact"
    if (
        "status" in result.failure_reasons
        or "tool" in result.failure_reasons
        or "shortlist_tool" in result.failure_reasons
    ):
        return "misrecognized"
    return "partial"


def _require_string(value: dict[object, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Evaluation suite field is invalid: {key}")
    return item.strip()
