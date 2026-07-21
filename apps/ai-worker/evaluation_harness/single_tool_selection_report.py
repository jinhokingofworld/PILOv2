from __future__ import annotations

import random
from collections import Counter
from collections.abc import Iterable

from evaluation_harness.single_tool_selection_runtime import SingleToolSelectionResult

_PAIRED_METADATA_KEYS = (
    "evaluatorSha256",
    "catalogSha256",
    "catalogVersion",
    "model",
    "routerModel",
    "currentDate",
    "timezone",
    "repetitions",
    "registryInventorySha256",
    "registryCatalogSha256",
)
_BENCHMARK_SCOPE = (
    "Frozen Canvas-excluded single-turn Tool-selection benchmark only; "
    "this is not overall Agent or task-success performance."
)


def build_single_tool_selection_report(
    results: Iterable[SingleToolSelectionResult], metadata: dict[str, object]
) -> dict[str, object]:
    _validate_metadata(metadata)
    ordered_results = tuple(
        sorted(results, key=lambda result: (result.case_id, result.attempt))
    )
    _validate_complete_attempts(ordered_results, int(metadata["repetitions"]))
    passed_attempt_count = sum(result.passed for result in ordered_results)
    failure_code_counts = Counter(
        result.failure_code
        for result in ordered_results
        if result.failure_code is not None
    )
    return {
        "metadata": dict(metadata),
        "singleToolSelectionEvaluation": {
            "caseCount": len({result.case_id for result in ordered_results}),
            "attemptCount": len(ordered_results),
            "passedAttemptCount": passed_attempt_count,
            "singleTurnToolSelectionAccuracy": _fraction(
                passed_attempt_count, len(ordered_results)
            ),
            "failureCodeCounts": dict(sorted(failure_code_counts.items())),
            "scope": _BENCHMARK_SCOPE,
        },
        "results": [_serialize_result(result) for result in ordered_results],
    }


def build_single_tool_selection_comparison(
    baseline: dict[str, object], candidate: dict[str, object]
) -> dict[str, object]:
    baseline_metadata = _metadata(baseline)
    candidate_metadata = _metadata(candidate)
    if any(
        baseline_metadata.get(key) is None
        or baseline_metadata.get(key) != candidate_metadata.get(key)
        for key in _PAIRED_METADATA_KEYS
    ):
        raise ValueError("Baseline and candidate must share the same fixed metadata")
    baseline_results = _results(baseline)
    candidate_results = _results(candidate)
    if _signatures(baseline_results) != _signatures(candidate_results):
        raise ValueError("Baseline and candidate must share complete paired attempts")
    baseline_accuracy = _accuracy(baseline_results)
    candidate_accuracy = _accuracy(candidate_results)
    deltas_by_case: dict[str, list[float]] = {}
    candidate_by_signature = {
        (result["id"], result["attempt"]): result for result in candidate_results
    }
    for result in baseline_results:
        signature = (result["id"], result["attempt"])
        paired = candidate_by_signature[signature]
        deltas_by_case.setdefault(result["id"], []).append(
            float(paired["passed"]) - float(result["passed"])
        )
    case_mean_deltas = [
        sum(values) / len(values) for _, values in sorted(deltas_by_case.items())
    ]
    confidence_interval = _clustered_bootstrap_confidence_interval(case_mean_deltas)
    return {
        "benchmarkScope": _BENCHMARK_SCOPE,
        "baselineSourceRevision": baseline_metadata["sourceRevision"],
        "candidateSourceRevision": candidate_metadata["sourceRevision"],
        "singleTurnToolSelectionAccuracy": {
            "baseline": baseline_accuracy,
            "candidate": candidate_accuracy,
            "percentagePointDelta": round(
                (candidate_accuracy - baseline_accuracy) * 100, 4
            ),
            "pairedClusteredConfidenceInterval95": list(confidence_interval),
        },
        "externalClaimAllowed": confidence_interval[0] > 0,
    }


def _validate_metadata(metadata: dict[str, object]) -> None:
    if not all(
        isinstance(metadata.get(key), str) and metadata[key]
        for key in _PAIRED_METADATA_KEYS
        if key != "repetitions"
    ):
        raise ValueError("Single-tool selection report metadata is incomplete")
    repetitions = metadata.get("repetitions")
    if (
        not isinstance(repetitions, int)
        or isinstance(repetitions, bool)
        or repetitions < 1
    ):
        raise ValueError("Single-tool selection report repetitions are invalid")
    source_revision = metadata.get("sourceRevision")
    if not isinstance(source_revision, str) or not source_revision:
        raise ValueError("Single-tool selection report source revision is required")


def _validate_complete_attempts(
    results: tuple[SingleToolSelectionResult, ...], repetitions: int
) -> None:
    if not results:
        raise ValueError("Single-tool selection report requires results")
    signatures = {(result.case_id, result.attempt) for result in results}
    if len(signatures) != len(results):
        raise ValueError("Single-tool selection report attempts must be unique")
    attempts_by_case: dict[str, set[int]] = {}
    for result in results:
        if result.attempt < 1:
            raise ValueError("Single-tool selection report attempts are invalid")
        attempts_by_case.setdefault(result.case_id, set()).add(result.attempt)
    expected_attempts = set(range(1, repetitions + 1))
    if any(attempts != expected_attempts for attempts in attempts_by_case.values()):
        raise ValueError("Single-tool selection report attempts are incomplete")


def _serialize_result(result: SingleToolSelectionResult) -> dict[str, object]:
    return {
        "id": result.case_id,
        "attempt": result.attempt,
        "expectedToolName": result.expected_tool_name,
        "selectedToolName": result.selected_tool_name,
        "passed": result.passed,
        "failureCode": result.failure_code,
    }


def _metadata(report: dict[str, object]) -> dict[str, object]:
    metadata = report.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("Single-tool selection report metadata is missing")
    _validate_metadata(metadata)
    return metadata


def _results(report: dict[str, object]) -> list[dict[str, object]]:
    results = report.get("results")
    if (
        not isinstance(results, list)
        or not results
        or not all(isinstance(result, dict) for result in results)
    ):
        raise ValueError("Single-tool selection report results are invalid")
    return results


def _signatures(results: list[dict[str, object]]) -> tuple[tuple[str, int], ...]:
    signatures: list[tuple[str, int]] = []
    for result in results:
        case_id = result.get("id")
        attempt = result.get("attempt")
        if not isinstance(case_id, str) or not isinstance(attempt, int):
            raise ValueError("Single-tool selection report signature is invalid")
        signatures.append((case_id, attempt))
    return tuple(signatures)


def _accuracy(results: list[dict[str, object]]) -> float:
    passed = [result.get("passed") for result in results]
    if not all(isinstance(value, bool) for value in passed):
        raise ValueError("Single-tool selection report pass state is invalid")
    return _fraction(sum(passed), len(passed))


def _clustered_bootstrap_confidence_interval(
    case_mean_deltas: list[float],
) -> tuple[float, float]:
    if not case_mean_deltas:
        raise ValueError("Single-tool selection comparison requires cases")
    generator = random.Random(17)
    samples = sorted(
        sum(generator.choice(case_mean_deltas) for _ in case_mean_deltas)
        / len(case_mean_deltas)
        for _ in range(2_000)
    )
    return round(samples[49], 4), round(samples[1949], 4)


def _fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0
