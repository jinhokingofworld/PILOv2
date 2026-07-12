from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from app.agent_processor import (
    AGENT_RUN_REQUESTED_JOB_TYPE,
    AgentPlannerClient,
    AgentPlanningRequest,
    AgentRunJob,
    NormalizedPlannerDecision,
    normalize_agent_planner_decision,
    parse_agent_run_job_payload,
)

EVALUATION_RUN_ID = "00000000-0000-4000-8000-000000000001"
EVALUATION_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002"
EVALUATION_USER_ID = "00000000-0000-4000-8000-000000000003"


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
    passed: bool
    failure_reasons: tuple[str, ...]
    expected: EvaluationExpectation
    actual: NormalizedPlannerDecision


class PlannerEvaluator(Protocol):
    def plan(self, request: AgentPlanningRequest): ...


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
        }
    )

    parsed_cases = tuple(_parse_case(item) for item in cases)
    if not parsed_cases:
        raise ValueError("Evaluation suite must include at least one case")
    if len({case.case_id for case in parsed_cases}) != len(parsed_cases):
        raise ValueError("Evaluation suite contains duplicate case IDs")

    return EvaluationSuite(version=version, job=job, cases=parsed_cases)


def evaluate_suite(
    planner: AgentPlannerClient,
    suite: EvaluationSuite,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
) -> tuple[CaseEvaluationResult, ...]:
    if repetitions < 1:
        raise ValueError("Evaluation repetitions must be at least 1")

    return tuple(
        evaluate_case(planner, suite.job, case, current_date, timezone, attempt)
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
) -> CaseEvaluationResult:
    decision = planner.plan(
        AgentPlanningRequest(
            run_id=str(uuid5(NAMESPACE_URL, f"agent-planner-evaluation:{case.case_id}:{attempt}")),
            prompt=case.prompt,
            timezone=timezone,
            current_date=current_date,
            tool_schema_version=job.tool_schema_version,
            tools=job.tools,
        )
    )
    actual = normalize_agent_planner_decision(decision, job, prompt=case.prompt)
    failures = _compare(case.expectation, actual)
    return CaseEvaluationResult(
        case_id=case.case_id,
        attempt=attempt,
        prompt=case.prompt,
        passed=not failures,
        failure_reasons=tuple(failures),
        expected=case.expectation,
        actual=actual,
    )


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
        "flakyCaseIds": [
            summary["id"] for summary in case_summaries if 0.0 < summary["exactRate"] < 1.0
        ],
        "caseSummaries": case_summaries,
        "results": [
            {
                "id": result.case_id,
                "attempt": result.attempt,
                "prompt": result.prompt,
                "expected": _expected_output(result.expected),
                "passed": result.passed,
                "classification": _classification(result),
                "failureReasons": list(result.failure_reasons),
                "failureCategoryCandidates": _failure_category_candidates(result),
                "actual": result.actual.output_summary,
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
        "prompt": results[0].prompt,
        "expected": _expected_output(results[0].expected),
        "attempts": len(results),
        "exactCount": sum(result.passed for result in results),
        "exactRate": _exact_rate(results),
        "requiresManualReview": not all(result.passed for result in results),
        "failureCategoryCandidates": sorted(
            {category for result in results for category in _failure_category_candidates(result)}
        ),
    }


def _expected_output(expected: EvaluationExpectation) -> dict[str, object]:
    output: dict[str, object] = {"status": expected.status}
    if expected.tool_name:
        output["toolName"] = expected.tool_name
    if expected.input_contains:
        output["inputContains"] = expected.input_contains
    if expected.requires_confirmation is not None:
        output["requiresConfirmation"] = expected.requires_confirmation
    if expected.missing_fields:
        output["missingFields"] = list(expected.missing_fields)
    return output


def _failure_category_candidates(result: CaseEvaluationResult) -> list[str]:
    categories: list[str] = []
    expected = result.expected
    if expected.status == "unsupported" and result.actual.status != "unsupported":
        categories.append("unsafe_candidate")
    if "tool" in result.failure_reasons:
        categories.append("wrong_tool")
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
    if "status" in result.failure_reasons or "tool" in result.failure_reasons:
        return "misrecognized"
    return "partial"


def _require_string(value: dict[object, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Evaluation suite field is invalid: {key}")
    return item.strip()
