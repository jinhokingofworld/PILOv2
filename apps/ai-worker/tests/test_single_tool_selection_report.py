import pytest

from evaluation_harness.single_tool_selection_report import (
    build_single_tool_selection_comparison,
    build_single_tool_selection_report,
)
from evaluation_harness.single_tool_selection_runtime import SingleToolSelectionResult


def _metadata(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "evaluatorSha256": "e" * 64,
        "catalogSha256": "c" * 64,
        "catalogVersion": "agent-single-tool-selection:v1",
        "sourceRevision": "a" * 40,
        "model": "gpt-test",
        "routerModel": "gpt-test",
        "currentDate": "2026-07-21",
        "timezone": "Asia/Seoul",
        "repetitions": 5,
        "registryInventorySha256": "i" * 64,
        "registryCatalogSha256": "r" * 64,
    }
    values.update(overrides)
    return values


def _results(passed: bool) -> tuple[SingleToolSelectionResult, ...]:
    return tuple(
        SingleToolSelectionResult(
            case_id=case_id,
            attempt=attempt,
            expected_tool_name="list_calendar_events",
            selected_tool_name="list_calendar_events" if passed else None,
            passed=passed,
            failure_code=None if passed else "no_tool",
            execution_handoff_count=1 if passed else 0,
        )
        for case_id in ("calendar_01", "calendar_02")
        for attempt in range(1, 6)
    )


def test_report_calculates_exact_accuracy_and_serializes_attempts_in_case_order() -> (
    None
):
    results = _results(True)

    report = build_single_tool_selection_report(results, _metadata())

    evaluation = report["singleToolSelectionEvaluation"]
    assert evaluation["caseCount"] == 2
    assert evaluation["attemptCount"] == 10
    assert evaluation["passedAttemptCount"] == 10
    assert evaluation["singleTurnToolSelectionAccuracy"] == 1.0
    assert [item["id"] for item in report["results"][:5]] == ["calendar_01"] * 5


def test_report_rejects_duplicate_or_incomplete_case_attempts() -> None:
    duplicate = (*_results(True), _results(True)[0])

    with pytest.raises(ValueError, match="unique"):
        build_single_tool_selection_report(duplicate, _metadata())


def test_comparison_clusters_repeated_attempts_by_case_and_allows_different_sources() -> (
    None
):
    baseline = build_single_tool_selection_report(
        _results(False), _metadata(sourceRevision="a" * 40)
    )
    candidate = build_single_tool_selection_report(
        _results(True), _metadata(sourceRevision="b" * 40)
    )

    comparison = build_single_tool_selection_comparison(baseline, candidate)

    metric = comparison["singleTurnToolSelectionAccuracy"]
    assert metric["baseline"] == 0.0
    assert metric["candidate"] == 1.0
    assert metric["percentagePointDelta"] == 100.0
    assert metric["pairedClusteredConfidenceInterval95"] == [1.0, 1.0]
    assert comparison["externalClaimAllowed"] is True


def test_comparison_rejects_a_mismatched_frozen_input() -> None:
    baseline = build_single_tool_selection_report(_results(False), _metadata())
    candidate = build_single_tool_selection_report(
        _results(True), _metadata(catalogSha256="d" * 64)
    )

    with pytest.raises(ValueError, match="same fixed metadata"):
        build_single_tool_selection_comparison(baseline, candidate)
