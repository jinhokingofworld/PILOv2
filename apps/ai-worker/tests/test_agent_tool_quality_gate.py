from dataclasses import replace
from pathlib import Path

from app.agent_tool_quality_gate import (
    evaluate_tool_retrieval_quality_gate,
    fixture_sha256,
    load_tool_retrieval_quality_fixture,
)

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "evals" / "tool_retrieval_quality_gate_v1.json"


def test_quality_gate_records_reproducible_passing_baseline_without_sensitive_inputs() -> None:
    fixture = load_tool_retrieval_quality_fixture(FIXTURE_PATH)
    report = evaluate_tool_retrieval_quality_gate(
        fixture,
        fixture_sha256=fixture_sha256(FIXTURE_PATH),
    )

    assert report["passed"] is True
    assert report["metrics"] == {
        "canonicalRequiredToolRecallAt8": 1.0,
        "heldOutDomainRecallAt8": 1.0,
        "heldOutCapabilityRecallAt8": 1.0,
    }
    assert report["failureTaxonomy"] == {}
    assert report["privacy"] == {"violationCount": 0}
    assert report["metadata"] == {
        "suiteVersion": "tool-retrieval-quality-suite:v1",
        "suiteSha256": fixture_sha256(FIXTURE_PATH),
        "catalogVersion": "agent-tool-capabilities:v2",
        "catalogSha256": fixture.catalog.sha256,
        "eligibleSnapshotSha256": (
            "d420d7d411e923c92cc1d033e952a851201854f4e98c0e3557375f96eab9e4c9"
        ),
        "modelVersion": "deterministic:no-provider",
        "retrieverVersion": "agent-tool-metadata-overlap:v1",
        "topK": 8,
        "defaultSchemaTokenBudget": 8000,
    }
    serialized = str(report)
    assert all(value not in serialized for value in fixture.privacy_sensitive_values)
    assert all(case.prompt not in serialized for case in fixture.cases)


def test_quality_gate_fails_with_visible_threshold_taxonomy() -> None:
    fixture = load_tool_retrieval_quality_fixture(FIXTURE_PATH)
    held_out = next(case for case in fixture.cases if case.kind == "held_out")
    invalid_fixture = replace(
        fixture,
        cases=tuple(
            replace(case, capability_id="missing.capability") if case == held_out else case
            for case in fixture.cases
        ),
    )

    report = evaluate_tool_retrieval_quality_gate(
        invalid_fixture,
        fixture_sha256=fixture_sha256(FIXTURE_PATH),
    )

    assert report["passed"] is False
    assert report["failureTaxonomy"]["held_out_capability_recall"] == 1
    assert report["failureTaxonomy"]["held_out_capability_threshold"] == 1
