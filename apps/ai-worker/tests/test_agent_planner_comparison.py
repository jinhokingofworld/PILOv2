import json

import pytest

from app.agent_planner_comparison import (
    build_agent_performance_snapshot,
    build_multiturn_context_comparison,
    build_multiturn_context_snapshot,
    build_two_stage_comparison,
)
from scripts.snapshot_agent_planner_evaluations import main as snapshot_main


def report(
    variant: str,
    *,
    domain_count: int,
    tool_count: int,
    exact_count: int,
    case_count: int = 10,
) -> dict[str, object]:
    exact = exact_count / case_count
    tool = tool_count / case_count
    results = []
    for index in range(case_count):
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
        "totalAttempts": case_count,
        "passedAttempts": exact_count,
        "exactAttemptRate": exact,
        "toolSelectionAccuracy": tool,
        "requiredInputAccuracy": 1.0,
        "routingFunnel": {
            "toolSelectionAttempts": case_count,
            "stages": {
                "routerRouted": {
                    "count": case_count,
                    "conditionalRate": 1.0,
                    "overallRate": 1.0,
                },
                "domainExact": {
                    "count": domain_count,
                    "conditionalRate": domain_count / case_count,
                    "overallRate": domain_count / case_count,
                },
                "capabilityExact": {
                    "count": domain_count,
                    "conditionalRate": 1.0,
                    "overallRate": domain_count / case_count,
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
            "workflowCatalogSha256": "9" * 64,
            "model": "planner-model",
            "routerModel": "router-model",
            "currentDate": "2026-07-20",
            "timezone": "Asia/Seoul",
            "repetitions": 1,
            "retrievalTopK": 8,
            "evaluationSeed": 17,
            "evaluatorSha256": "1" * 64,
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


def workflow_report(
    exact_count: int,
    *,
    source_revision: str,
    latency_ms: float,
    provider_tokens: int,
    variant: str = "multi_tool",
    case_count: int = 10,
) -> dict[str, object]:
    value = report(
        variant,
        domain_count=case_count,
        tool_count=case_count,
        exact_count=exact_count,
        case_count=case_count,
    )
    value["totalCases"] = case_count
    value["metadata"]["sourceRevision"] = source_revision
    value["workflowEvaluation"] = {"taskSuccessRate": value["exactAttemptRate"]}
    value["executionContractPassAttempts"] = value["passedAttempts"]
    value["multiToolWorkflows"] = {
        "workflowAttempts": case_count,
        "exactWorkflowAttempts": value["passedAttempts"],
        "exactWorkflowRate": value["exactAttemptRate"],
    }
    for attempt in value["results"]:
        attempt["expected"] = {
            "domains": ["meeting"],
            "capabilityIds": ["meeting.workflow"],
        }
        attempt["workflow"] = {
            "taskSuccess": attempt["passed"],
            "executionContractPassed": attempt["passed"],
            "latencyMs": latency_ms,
            "providerTotalTokens": provider_tokens,
            "safetyViolations": [],
        }
    return value


def multiturn_report(*, evaluator_sha: str = "1" * 64) -> dict[str, object]:
    return {
        "multiTurnContextEvaluation": {
            "conversationCount": 1,
            "attempts": 1,
            "multiTurnContextResolutionRate": 0.5,
            "multiTurnToolSelectionAccuracy": 0.0,
            "partialRate": 0.0,
            "inconclusiveRate": 0.0,
        },
        "results": [
            {
                "id": "meeting_01",
                "deterministicContextPassed": True,
                "deterministicContinuationPassed": True,
                "judgeVerdict": "pass",
                "judgeContextResolved": True,
                "judgeFollowUpDelivered": True,
                "failureReasons": [],
                "toolSelectionPassed": False,
            }
        ],
        "metadata": {
            "workflowCatalogSha256": "a" * 64,
            "multiTurnJudgeModel": "judge-model",
            "multiTurnJudgePromptVersion": "agent-outcome-judge:v1",
            "multiTurnJudgeTemperature": 0,
            "multiTurnJudgeVoteCount": 3,
            "judgeCalibrationStatus": "pending",
            "currentDate": "2026-07-20",
            "timezone": "Asia/Seoul",
            "repetitions": 1,
            "evaluatorSha256": evaluator_sha,
            "toolCapabilityCatalogFileSha256": "b" * 64,
            "toolSchemaVersion": "agent-tools:v7",
            "registryInventorySha256": "c" * 64,
            "registryCatalogSha256": "d" * 64,
            "registryEligibleSnapshotSha256": "e" * 64,
            "model": "planner-model",
            "routerModel": "router-model",
            "retrieverVersion": "agent-tool-llm-router:v1",
            "evaluationSeed": 17,
        },
    }


def test_multiturn_comparison_uses_direct_tool_selection_verdict() -> None:
    comparison = build_multiturn_context_comparison(multiturn_report(), multiturn_report())

    assert comparison["metrics"]["multiTurnToolSelectionAccuracy"]["baseline"] == 0.0


def test_multiturn_snapshot_preserves_pending_calibration_status() -> None:
    snapshot = build_multiturn_context_snapshot(multiturn_report())

    assert snapshot["metadata"]["judgeCalibrationStatus"] == "pending"


def test_multiturn_comparison_rejects_changed_evaluator_provenance() -> None:
    with pytest.raises(ValueError, match="evaluatorSha256"):
        build_multiturn_context_comparison(
            multiturn_report(evaluator_sha="1" * 64),
            multiturn_report(evaluator_sha="2" * 64),
        )


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
    assert result["variants"]["canonical"]["delta"]["capabilityExactOverallRate"] == 0.1
    assert result["variants"]["canonical"]["delta"]["conditionalToolAccuracy"] == 0.0111
    assert result["aggregate"]["baseline"]["endToEndExactRate"] == 0.8
    assert result["aggregate"]["candidate"]["endToEndExactRate"] == 0.9
    assert result["improvementEvidence"]["uniqueScenarioCount"] == 0
    assert result["improvementEvidence"]["taskSuccess"]["confidenceInterval95"][0] == 0.0
    assert result["improvementEvidence"]["passed"] is False


def test_agent_performance_snapshot_reports_absolute_workflow_metrics() -> None:
    current = workflow_report(
        31,
        source_revision="main-revision",
        latency_ms=123.5,
        provider_tokens=456,
        variant="agent_workflow",
        case_count=31,
    )
    current["results"][0]["expected"]["evaluationDomains"] = ["drive"]
    current["results"][0]["kind"] = "grounded_answer"
    current["results"][1]["workflow"]["safetyViolations"] = ["unsupported_action"]

    snapshot = build_agent_performance_snapshot([current])

    assert snapshot["format"] == "agent-performance-snapshot:v1"
    assert snapshot["sourceRevision"] == "main-revision"
    assert snapshot["scopeVariants"] == ["agent_workflow"]
    assert snapshot["uniqueScenarioCount"] == 31
    assert snapshot["taskSuccessRate"] == 1.0
    assert snapshot["executionContractPassRate"] == 1.0
    assert snapshot["meanLatencyMs"] == 123.5
    assert snapshot["meanProviderTotalTokens"] == 456.0
    assert snapshot["domainTaskSuccess"]["drive"]["rate"] == 1.0
    assert snapshot["categoryTaskSuccess"]["grounded_answer"]["rate"] == 1.0
    assert snapshot["safetyViolations"] == {"count": 1}
    assert "passed" not in snapshot


def test_snapshot_accepts_different_task_and_execution_contract_rates() -> None:
    current = workflow_report(
        31,
        source_revision="main-revision",
        latency_ms=123.5,
        provider_tokens=456,
        variant="agent_workflow",
        case_count=31,
    )
    current["results"][0]["executionContractPassed"] = False
    current["results"][0]["workflow"]["executionContractPassed"] = False
    current["exactAttemptRate"] = round(30 / 31, 4)
    current["executionContractPassAttempts"] = 30
    current["routingFunnel"]["stages"]["endToEndExact"] = {
        "count": 30,
        "conditionalRate": round(30 / 31, 4),
        "overallRate": round(30 / 31, 4),
    }
    current["multiToolWorkflows"]["exactWorkflowAttempts"] = 30
    current["multiToolWorkflows"]["exactWorkflowRate"] = round(30 / 31, 4)

    snapshot = build_agent_performance_snapshot([current])

    assert snapshot["taskSuccessRate"] == 1.0
    assert snapshot["executionContractPassRate"] == round(30 / 31, 4)
    assert snapshot["aggregate"]["exactAttemptRate"] == round(30 / 31, 4)


def test_snapshot_command_writes_metrics_without_a_pass_fail_gate(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    report_path = tmp_path / "agent-workflow.json"
    output_path = tmp_path / "snapshot.json"
    report_path.write_text(
        json.dumps(
            workflow_report(
                31,
                source_revision="main-revision",
                latency_ms=123.5,
                provider_tokens=456,
                variant="agent_workflow",
                case_count=31,
            )
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "snapshot_agent_planner_evaluations.py",
            "--report",
            str(report_path),
            "--output",
            str(output_path),
        ],
    )

    assert snapshot_main() == 0
    snapshot = json.loads(output_path.read_text(encoding="utf-8"))
    assert snapshot["taskSuccessRate"] == 1.0
    assert "passed" not in snapshot


@pytest.mark.parametrize("mutation", ("missing_workflow_summary", "thirty_cases"))
def test_snapshot_rejects_incomplete_31_scenario_report(mutation: str) -> None:
    current = workflow_report(
        31 if mutation == "missing_workflow_summary" else 30,
        source_revision="main-revision",
        latency_ms=123.5,
        provider_tokens=456,
        variant="agent_workflow",
        case_count=31 if mutation == "missing_workflow_summary" else 30,
    )
    if mutation == "missing_workflow_summary":
        del current["workflowEvaluation"]

    with pytest.raises(ValueError, match="31 complete workflow scenarios"):
        build_agent_performance_snapshot([current])


def test_two_stage_comparison_requires_distinct_revisions_and_same_evaluator() -> None:
    baseline = [report("canonical", domain_count=10, tool_count=10, exact_count=10)]
    candidate = [report("canonical", domain_count=10, tool_count=10, exact_count=10)]

    with pytest.raises(ValueError, match="distinct revisions"):
        build_two_stage_comparison(baseline, candidate)

    candidate[0]["metadata"]["sourceRevision"] = "candidate-revision"
    candidate[0]["metadata"]["evaluatorSha256"] = "2" * 64

    with pytest.raises(ValueError, match="same evaluator"):
        build_two_stage_comparison(baseline, candidate)


def test_two_stage_comparison_reports_multi_tool_workflow_delta() -> None:
    baseline = report("multi_tool", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("multi_tool", domain_count=10, tool_count=10, exact_count=10)
    baseline["multiToolWorkflows"] = {
        "workflowAttempts": 10,
        "exactWorkflowAttempts": 8,
        "exactWorkflowRate": 0.8,
    }
    candidate["multiToolWorkflows"] = {
        "workflowAttempts": 10,
        "exactWorkflowAttempts": 9,
        "exactWorkflowRate": 0.9,
    }
    candidate["metadata"]["sourceRevision"] = "candidate-revision"

    result = build_two_stage_comparison([baseline], [candidate])

    assert result["variants"]["multi_tool"]["delta"]["multiToolExactWorkflowRate"] == 0.1
    assert result["aggregate"]["candidate"]["multiToolExactWorkflowRate"] == 0.9


def test_workflow_comparison_requires_confident_success_and_efficiency_gain() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
    )
    candidate = workflow_report(
        10,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
    )

    result = build_two_stage_comparison([baseline], [candidate])
    evidence = result["improvementEvidence"]

    assert evidence["uniqueScenarioCount"] == 10
    assert evidence["taskSuccess"]["confidenceInterval95"][0] > 0
    assert evidence["latencyMs"]["delta"] == -100.0
    assert evidence["providerTotalTokens"]["delta"] == -20.0
    assert evidence["passed"] is True


def test_improvement_evidence_prefers_balanced_agent_workflow_variant() -> None:
    baseline = [
        workflow_report(
            1,
            source_revision="baseline-revision",
            latency_ms=200.0,
            provider_tokens=100,
        ),
        workflow_report(
            1,
            source_revision="baseline-revision",
            latency_ms=200.0,
            provider_tokens=100,
            variant="agent_workflow",
        ),
    ]
    candidate = [
        workflow_report(
            10,
            source_revision="candidate-revision",
            latency_ms=100.0,
            provider_tokens=80,
        ),
        workflow_report(
            10,
            source_revision="candidate-revision",
            latency_ms=100.0,
            provider_tokens=80,
            variant="agent_workflow",
        ),
    ]

    evidence = build_two_stage_comparison(baseline, candidate)["improvementEvidence"]

    assert evidence["scopeVariants"] == ["agent_workflow"]
    assert evidence["uniqueScenarioCount"] == 10


def test_improvement_evidence_rejects_regression_in_evaluated_domain() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
        variant="agent_workflow",
    )
    candidate = workflow_report(
        9,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
        variant="agent_workflow",
    )
    for value in (baseline, candidate):
        value["results"][0]["expected"]["domains"] = ["pr_review"]
        for result in value["results"][1:]:
            result["expected"]["domains"] = ["board"]
    candidate["results"][0]["passed"] = False
    candidate["results"][0]["workflow"]["taskSuccess"] = False
    candidate["results"][9]["passed"] = True
    candidate["results"][9]["workflow"]["taskSuccess"] = True

    evidence = build_two_stage_comparison([baseline], [candidate])["improvementEvidence"]

    assert evidence["domainTaskSuccess"]["pr_review"]["delta"] == -1.0
    assert evidence["domainNonRegressionPassed"] is False
    assert evidence["passed"] is False


def test_improvement_evidence_keeps_efficiency_as_a_diagnostic_not_a_success_gate() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=100.0,
        provider_tokens=100,
        variant="agent_workflow",
    )
    candidate = workflow_report(
        10,
        source_revision="candidate-revision",
        latency_ms=50.0,
        provider_tokens=100,
        variant="agent_workflow",
    )
    for result in candidate["results"][-3:]:
        result["workflow"]["latencyMs"] = 200.0

    evidence = build_two_stage_comparison([baseline], [candidate])["improvementEvidence"]

    assert evidence["latencyMs"]["delta"] < 0
    assert evidence["latencyMs"]["confidenceInterval95"][1] > 0
    assert evidence["efficiencyPassed"] is False
    assert evidence["passed"] is True


def test_domain_gate_uses_evaluation_domain_for_negative_routing_case() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
        variant="agent_workflow",
    )
    candidate = workflow_report(
        10,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
        variant="agent_workflow",
    )
    for value in (baseline, candidate):
        for result in value["results"]:
            result["expected"]["domains"] = ["meeting"]
            result["expected"]["evaluationDomains"] = ["drive"]

    evidence = build_two_stage_comparison([baseline], [candidate])["improvementEvidence"]

    assert set(evidence["domainTaskSuccess"]) == {"drive"}


def test_improvement_evidence_rejects_regression_in_task_category() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
        variant="agent_workflow",
    )
    candidate = workflow_report(
        9,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
        variant="agent_workflow",
    )
    for value in (baseline, candidate):
        value["results"][0]["kind"] = "confirmation"
        for result in value["results"][1:]:
            result["kind"] = "single_tool"
    candidate["results"][0]["passed"] = False
    candidate["results"][0]["workflow"]["taskSuccess"] = False
    candidate["results"][9]["passed"] = True
    candidate["results"][9]["workflow"]["taskSuccess"] = True

    evidence = build_two_stage_comparison([baseline], [candidate])["improvementEvidence"]

    assert evidence["categoryTaskSuccess"]["confirmation"]["delta"] == -1.0
    assert evidence["categoryNonRegressionPassed"] is False
    assert evidence["passed"] is False


@pytest.mark.parametrize("mutation", ("duplicate", "missing"))
def test_workflow_comparison_rejects_incomplete_attempt_pairs(mutation: str) -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
    )
    candidate = workflow_report(
        10,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
    )
    if mutation == "duplicate":
        for value in (baseline, candidate):
            value["results"][-1]["id"] = value["results"][0]["id"]
    else:
        for value in (baseline, candidate):
            value["results"].pop()

    with pytest.raises(ValueError, match="complete unique workflow attempts"):
        build_two_stage_comparison([baseline], [candidate])


def test_workflow_comparison_rejects_safety_violation_on_either_revision() -> None:
    baseline = workflow_report(
        1,
        source_revision="baseline-revision",
        latency_ms=200.0,
        provider_tokens=100,
    )
    candidate = workflow_report(
        10,
        source_revision="candidate-revision",
        latency_ms=100.0,
        provider_tokens=80,
    )
    baseline["results"][1]["workflow"]["safetyViolations"] = ["confirmation_policy"]

    evidence = build_two_stage_comparison([baseline], [candidate])["improvementEvidence"]

    assert evidence["safetyViolations"]["passed"] is False
    assert evidence["passed"] is False


def test_two_stage_comparison_rejects_different_fixture_inputs() -> None:
    baseline = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate["metadata"]["meetingCatalogSha256"] = "b" * 64

    with pytest.raises(ValueError, match="same fixed inputs"):
        build_two_stage_comparison([baseline], [candidate])


def test_two_stage_comparison_rejects_different_workflow_catalogs() -> None:
    baseline = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate = report("canonical", domain_count=10, tool_count=10, exact_count=10)
    candidate["metadata"]["sourceRevision"] = "candidate-revision"
    candidate["metadata"]["workflowCatalogSha256"] = "8" * 64

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
