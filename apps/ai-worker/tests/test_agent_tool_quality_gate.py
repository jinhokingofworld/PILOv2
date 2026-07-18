import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.agent_tool_quality_gate import (
    bind_quality_fixture_to_registry_snapshot,
    evaluate_tool_retrieval_quality_gate,
    fixture_sha256,
    load_agent_tool_registry_snapshot,
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
            "6d63fdac6443645ed05c4fd1821950a42c3d102c280f9434b9ba7284c6d92fb8"
        ),
        "registryInventorySha256": (
            "7291eefdcc2605d531888acda00246c436e765c27d7e29fa42dd33dd987cf1e3"
        ),
        "registryCatalogSha256": (
            "76957cf3fd897a3f94bebd74f26f56e2ca9a95820183a6ef1e24738bf2c15632"
        ),
        "registryEligibleSnapshotSha256": (
            "6d63fdac6443645ed05c4fd1821950a42c3d102c280f9434b9ba7284c6d92fb8"
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


def test_quality_gate_rejects_fixture_when_registry_snapshot_has_drifted(tmp_path) -> None:
    fixture = load_tool_retrieval_quality_fixture(FIXTURE_PATH)
    raw_fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    tool_schemas = raw_fixture["eligibleToolSchemas"]
    eligible_snapshot_sha256 = hashlib.sha256(
        json.dumps(
            tool_schemas,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    snapshot_path = tmp_path / "agent-tool-registry-snapshot.json"
    snapshot_path.write_text(
        json.dumps(
            {
                "format": "agent-tool-retrieval-registry-snapshot:v1",
                "inventory": {
                    "sha256": "0" * 64,
                    "catalogSha256": raw_fixture["toolCapabilityCatalog"]["sha256"],
                },
                "eligibleSnapshotSha256": eligible_snapshot_sha256,
                "eligibleToolSchemas": tool_schemas,
                "toolCapabilityCatalog": raw_fixture["toolCapabilityCatalog"],
            }
        ),
        encoding="utf-8",
    )

    snapshot = load_agent_tool_registry_snapshot(snapshot_path)

    matching_fixture = replace(
        fixture,
        registry_snapshot_expectation={
            "inventorySha256": snapshot.inventory_sha256,
            "catalogSha256": snapshot.catalog_sha256,
            "eligibleSnapshotSha256": snapshot.eligible_snapshot_sha256,
        },
    )
    assert bind_quality_fixture_to_registry_snapshot(matching_fixture, snapshot) == matching_fixture

    with pytest.raises(ValueError, match="does not match"):
        bind_quality_fixture_to_registry_snapshot(fixture, snapshot)
