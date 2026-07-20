import pytest

from app.agent_planner_comparison import build_two_stage_comparison


def report(
    variant: str, *, domain_count: int, tool_count: int, exact_count: int
) -> dict[str, object]:
    exact = exact_count / 10
    tool = tool_count / 10
    results = []
    for index in range(10):
        failure_reasons = (
            [] if index < exact_count else (["input"] if index < tool_count else ["tool"])
        )
        results.append(
            {
                "id": f"{variant}:{index}",
                "attempt": 1,
                "kind": variant,
                "expected": {"toolName": "example_tool", "inputFields": ["value"]},
                "passed": not failure_reasons,
                "failureReasons": failure_reasons,
            }
        )
    return {
        "totalAttempts": 10,
        "passedAttempts": exact_count,
        "exactAttemptRate": exact,
        "toolSelectionAccuracy": tool,
        "requiredInputAccuracy": 1.0,
        "routingFunnel": {
            "toolSelectionAttempts": 10,
            "stages": {
                "routerRouted": {"count": 10, "conditionalRate": 1.0, "overallRate": 1.0},
                "domainExact": {
                    "count": domain_count,
                    "conditionalRate": domain_count / 10,
                    "overallRate": domain_count / 10,
                },
                "toolExact": {
                    "count": tool_count,
                    "conditionalRate": round(tool_count / domain_count, 4),
                    "overallRate": tool,
                },
                "requiredInputExact": {
                    "count": exact_count,
                    "conditionalRate": round(exact_count / tool_count, 4),
                    "overallRate": exact,
                },
                "executionPolicyExact": {
                    "count": exact_count,
                    "conditionalRate": 1.0,
                    "overallRate": exact,
                },
                "endToEndExact": {
                    "count": exact_count,
                    "conditionalRate": 1.0,
                    "overallRate": exact,
                },
            },
        },
        "results": results,
        "metadata": {
            "suiteVersion": f"meeting-agent-regression:v1:{variant}",
            "meetingCatalogSha256": "a" * 64,
            "model": "planner-model",
            "routerModel": "router-model",
            "currentDate": "2026-07-20",
            "timezone": "Asia/Seoul",
            "repetitions": 1,
            "retrievalTopK": 8,
            "evaluationSeed": 17,
            "suiteSha256": "b" * 64,
            "toolCapabilityCatalogFileSha256": "c" * 64,
            "registryInventorySha256": "d" * 64,
            "registryCatalogSha256": "e" * 64,
            "registryEligibleSnapshotSha256": "f" * 64,
            "llmRouting": True,
            "compareShadowRetrieval": False,
            "sourceRevision": "baseline-revision",
        },
    }


def test_two_stage_comparison_pairs_inputs_and_reports_funnel_delta() -> None:
    baseline = [report("canonical", domain_count=9, tool_count=8, exact_count=8)]
    candidate = [report("canonical", domain_count=10, tool_count=9, exact_count=9)]
    candidate[0]["metadata"]["sourceRevision"] = "candidate-revision"

    result = build_two_stage_comparison(baseline, candidate)

    assert result["format"] == "agent-llm-router-planner-comparison:v1"
    assert result["sameEvaluationInputs"] is True
    assert result["fixedInputs"]["evaluationSeed"] == 17
    assert result["baselineBinding"]["registryInventorySha256"] == "d" * 64
    assert result["candidateBinding"]["sourceRevision"] == "candidate-revision"
    assert result["variants"]["canonical"]["delta"]["exactAttemptRate"] == 0.1
    assert result["variants"]["canonical"]["delta"]["domainExactOverallRate"] == 0.1
    assert result["variants"]["canonical"]["delta"]["conditionalToolAccuracy"] == 0.0111
    assert result["aggregate"]["baseline"]["endToEndExactRate"] == 0.8
    assert result["aggregate"]["candidate"]["endToEndExactRate"] == 0.9


def test_two_stage_comparison_rejects_different_fixture_inputs() -> None:
    baseline = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate["metadata"]["meetingCatalogSha256"] = "b" * 64

    with pytest.raises(ValueError, match="same fixed inputs"):
        build_two_stage_comparison([baseline], [candidate])


def test_two_stage_comparison_rejects_non_llm_routing_report() -> None:
    baseline = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    baseline["metadata"]["llmRouting"] = False

    with pytest.raises(ValueError, match="two-stage LLM routing"):
        build_two_stage_comparison([baseline], [candidate])


def test_aggregate_exact_rate_includes_failed_unsupported_attempt() -> None:
    baseline = report("counterexample", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("counterexample", domain_count=10, tool_count=10, exact_count=10)
    candidate["metadata"]["sourceRevision"] = "candidate-revision"
    for value in (baseline, candidate):
        value["totalAttempts"] = 11
        value["exactAttemptRate"] = 0.9091
        value["results"].append(
            {
                "id": "counterexample:unsupported",
                "attempt": 1,
                "kind": "counterexample",
                "expected": {"status": "unsupported"},
                "passed": False,
                "failureReasons": ["status"],
            }
        )

    result = build_two_stage_comparison([baseline], [candidate])

    assert result["aggregate"]["baseline"]["attempts"] == 11
    assert result["aggregate"]["baseline"]["toolSelectionAttempts"] == 10
    assert result["aggregate"]["baseline"]["exactAttemptRate"] == 0.9091
    assert result["aggregate"]["baseline"]["endToEndExactRate"] == 1.0


def test_aggregate_required_input_accuracy_uses_only_input_assertions() -> None:
    baseline = report("canonical", domain_count=10, tool_count=10, exact_count=9)
    candidate = report("canonical", domain_count=10, tool_count=10, exact_count=9)
    candidate["metadata"]["sourceRevision"] = "candidate-revision"
    for value in (baseline, candidate):
        for index, attempt in enumerate(value["results"]):
            attempt["expected"]["inputFields"] = ["value"] if index < 2 else []
            attempt["failureReasons"] = ["input"] if index == 1 else []
            attempt["passed"] = index != 1
        value["requiredInputAccuracy"] = 0.5

    result = build_two_stage_comparison([baseline], [candidate])

    assert result["aggregate"]["baseline"]["requiredInputAttempts"] == 2
    assert result["aggregate"]["baseline"]["requiredInputPassedAttempts"] == 1
    assert result["aggregate"]["baseline"]["requiredInputAccuracy"] == 0.5
