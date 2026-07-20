import json
from math import ceil
from pathlib import Path

import pytest

from app.phase4e_dev_readiness import (
    PHASE4E_READINESS_FORMAT,
    Phase4eReadinessInputs,
    evaluate_phase4e_dev_readiness,
)

CATALOG_PATH = Path(__file__).parents[1] / "evals" / "meeting_agent_capability_catalog_v1.json"


def write_json(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return path


def readiness_inputs(tmp_path: Path) -> Phase4eReadinessInputs:
    hashes = {
        "inventorySha256": "a" * 64,
        "catalogSha256": "b" * 64,
        "eligibleSnapshotSha256": "c" * 64,
    }
    registry = {
        "format": "agent-tool-retrieval-registry-snapshot:v1",
        "inventory": {
            "sha256": hashes["inventorySha256"],
            "catalogSha256": hashes["catalogSha256"],
        },
        "eligibleSnapshotSha256": hashes["eligibleSnapshotSha256"],
        "toolCapabilityCatalog": {"capabilities": [], "descriptors": []},
    }
    retrieval = {
        "format": "agent-tool-retrieval-quality-baseline:v1",
        "passed": True,
        "metadata": {
            "registryInventorySha256": hashes["inventorySha256"],
            "registryCatalogSha256": hashes["catalogSha256"],
            "registryEligibleSnapshotSha256": hashes["eligibleSnapshotSha256"],
        },
        "thresholds": {
            "canonicalRequiredToolRecallAt8": 1.0,
            "heldOutDomainRecallAt8": 0.95,
            "heldOutCapabilityRecallAt8": 0.95,
        },
        "metrics": {
            "canonicalRequiredToolRecallAt8": 1.0,
            "heldOutDomainRecallAt8": 1.0,
            "heldOutCapabilityRecallAt8": 1.0,
        },
        "privacy": {"violationCount": 0},
    }
    security = {
        "version": "agent-prompt-security-gate:v1",
        "passed": True,
        "caseCount": 26,
        "blockedCount": 17,
        "allowedCount": 9,
    }
    app_server = {
        "format": "phase4e-meeting-runtime-readiness:v2",
        "passed": True,
        "registry": hashes,
        "checks": [{"id": "meeting_write_contracts", "status": "passed"}],
        "writeContracts": [
            {"contractId": "meeting.control.leave"},
            {"contractId": "meeting.recording.end"},
            {"contractId": "meeting.action_items.update"},
            {"contractId": "meeting.action_items.approve"},
        ],
        "runtimeEvidence": {
            "status": "passed",
            "guarantees": [
                "meeting_leave_execution",
                "recording_end_confirmation_and_execution",
                "action_item_update_confirmation_and_execution",
                "action_item_approve_confirmation_and_execution",
                "workspace_permission_enforcement",
                "approval_idempotency",
                "pre_execution_revalidation",
            ],
        },
    }
    terraform = tmp_path / "main.tf"
    terraform.write_text(
        'ai_worker = { AGENT_TOOL_RETRIEVAL_MODE = "llm_router" }\n'
        'agent_worker = { AGENT_TOOL_RETRIEVAL_MODE = "llm_router" }\n',
        encoding="utf-8",
    )
    runbook = tmp_path / "runbook.md"
    runbook.write_text(
        "AGENT_TOOL_RETRIEVAL_MODE `llm_router` `shadow` Terraform apply "
        "toolRouting domains capabilityIds confirmation 실행 직전",
        encoding="utf-8",
    )
    catalog_sha = __import__("hashlib").sha256(CATALOG_PATH.read_bytes()).hexdigest()
    evaluation_reports = []
    variants = {
        "canonical": (216, 1.0, 1.0),
        "held_out": (54, 0.95, 0.95),
        "counterexample": (72, 0.95, 0.95),
        "context": (54, 0.95, 0.95),
    }
    repetitions = 5
    for variant, (case_count, exact_rate, tool_accuracy) in variants.items():
        attempts = case_count * repetitions
        exact_count = ceil(attempts * exact_rate)
        exact_overall_rate = round(exact_count / attempts, 4)
        mode_report = {
            "totalAttempts": attempts,
            "exactAttemptRate": exact_rate,
            "toolSelectionAccuracy": tool_accuracy,
            "requiredInputAccuracy": 1.0,
            "routingFunnel": {
                "toolSelectionAttempts": attempts,
                "stages": {
                    "routerRouted": {
                        "count": attempts,
                        "conditionalRate": 1.0,
                        "overallRate": 1.0,
                    },
                    "domainExact": {
                        "count": exact_count,
                        "conditionalRate": exact_overall_rate,
                        "overallRate": exact_overall_rate,
                    },
                    "toolExact": {
                        "count": exact_count,
                        "conditionalRate": 1.0,
                        "overallRate": exact_overall_rate,
                    },
                    "requiredInputExact": {
                        "count": exact_count,
                        "conditionalRate": 1.0,
                        "overallRate": exact_overall_rate,
                    },
                    "executionPolicyExact": {
                        "count": exact_count,
                        "conditionalRate": 1.0,
                        "overallRate": exact_overall_rate,
                    },
                    "endToEndExact": {
                        "count": exact_count,
                        "conditionalRate": 1.0,
                        "overallRate": exact_overall_rate,
                    },
                },
            },
            "retrieval": {
                "shortlistViolations": 0,
                "supportedToUnsupportedRate": 0.0,
                "domainRecallAtK": 1.0,
                "capabilityRecallAtK": 1.0,
            },
        }
        evaluation_reports.append(
            write_json(
                tmp_path / f"meeting-{variant}.json",
                {
                    **mode_report,
                    "metadata": {
                        "suiteVersion": f"meeting-agent-regression:v1:{variant}",
                        "llmRouting": True,
                        "compareShadowRetrieval": False,
                        "repetitions": repetitions,
                        "meetingCatalogSha256": catalog_sha,
                        "registryInventorySha256": hashes["inventorySha256"],
                        "registryCatalogSha256": hashes["catalogSha256"],
                        "registryEligibleSnapshotSha256": hashes["eligibleSnapshotSha256"],
                    },
                },
            )
        )
    return Phase4eReadinessInputs(
        registry_snapshot=write_json(tmp_path / "registry.json", registry),
        tool_retrieval_report=write_json(tmp_path / "retrieval.json", retrieval),
        prompt_security_report=write_json(tmp_path / "security.json", security),
        app_server_report=write_json(tmp_path / "app-server.json", app_server),
        meeting_catalog=CATALOG_PATH,
        dev_terraform=terraform,
        rollout_runbook=runbook,
        meeting_evaluation_reports=tuple(evaluation_reports),
    )


def test_phase4e_readiness_combines_all_gates_without_raw_values(tmp_path: Path) -> None:
    report = evaluate_phase4e_dev_readiness(readiness_inputs(tmp_path))

    assert report["format"] == PHASE4E_READINESS_FORMAT
    assert report["passed"] is True
    assert report["regression"] == {
        "capabilityCount": 18,
        "canonicalCount": 216,
        "heldOutCount": 54,
        "counterexampleCount": 72,
        "multiTurnCount": 54,
        "selectorCardinalityCount": 4,
    }
    assert report["runtime"] == {"writeContractCount": 4}
    serialized = json.dumps(report, ensure_ascii=False)
    assert "회의방 목록 보여줘" not in serialized
    assert "resourceId" not in serialized
    assert "token" not in serialized.lower()


def test_phase4e_readiness_fails_when_retrieval_threshold_is_not_met(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.tool_retrieval_report.read_text(encoding="utf-8"))
    report["metrics"]["heldOutCapabilityRecallAt8"] = 0.94
    write_json(inputs.tool_retrieval_report, report)

    with pytest.raises(ValueError, match="Retrieval threshold failed"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_fails_when_dev_is_not_llm_router(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    inputs.dev_terraform.write_text('AGENT_TOOL_RETRIEVAL_MODE = "shadow"\n', encoding="utf-8")

    with pytest.raises(ValueError, match="default to llm_router"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_fails_when_write_contract_evidence_is_incomplete(
    tmp_path: Path,
) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.app_server_report.read_text(encoding="utf-8"))
    report["writeContracts"] = report["writeContracts"][:3]
    write_json(inputs.app_server_report, report)

    with pytest.raises(ValueError, match="write readiness contracts"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_fails_when_actual_meeting_eval_is_below_threshold(
    tmp_path: Path,
) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.meeting_evaluation_reports[0].read_text(encoding="utf-8"))
    report["exactAttemptRate"] = 0.99
    write_json(inputs.meeting_evaluation_reports[0], report)

    with pytest.raises(ValueError, match="Meeting evaluation threshold failed"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_fails_when_router_domain_funnel_is_below_threshold(
    tmp_path: Path,
) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.meeting_evaluation_reports[0].read_text(encoding="utf-8"))
    funnel = report["routingFunnel"]
    degraded_count = funnel["toolSelectionAttempts"] - 1
    degraded_rate = round(degraded_count / funnel["toolSelectionAttempts"], 4)
    for stage_name in (
        "domainExact",
        "toolExact",
        "requiredInputExact",
        "executionPolicyExact",
        "endToEndExact",
    ):
        funnel["stages"][stage_name]["count"] = degraded_count
        funnel["stages"][stage_name]["conditionalRate"] = 1.0
        funnel["stages"][stage_name]["overallRate"] = degraded_rate
    funnel["stages"]["domainExact"]["conditionalRate"] = degraded_rate
    write_json(inputs.meeting_evaluation_reports[0], report)

    with pytest.raises(ValueError, match="Router domain threshold failed"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_requires_five_repetitions(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.meeting_evaluation_reports[0].read_text(encoding="utf-8"))
    report["metadata"]["repetitions"] = 4
    write_json(inputs.meeting_evaluation_reports[0], report)

    with pytest.raises(ValueError, match="at least 5 repetitions"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_requires_complete_repeated_attempts(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.meeting_evaluation_reports[0].read_text(encoding="utf-8"))
    report["totalAttempts"] -= 1
    write_json(inputs.meeting_evaluation_reports[0], report)

    with pytest.raises(ValueError, match="Incomplete Meeting evaluation"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_requires_all_four_actual_meeting_evals(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    inputs = Phase4eReadinessInputs(
        **{
            **inputs.__dict__,
            "meeting_evaluation_reports": inputs.meeting_evaluation_reports[:3],
        }
    )

    with pytest.raises(ValueError, match="all four Meeting evaluation reports"):
        evaluate_phase4e_dev_readiness(inputs)


def test_phase4e_readiness_rejects_eval_from_another_registry(tmp_path: Path) -> None:
    inputs = readiness_inputs(tmp_path)
    report = json.loads(inputs.meeting_evaluation_reports[1].read_text(encoding="utf-8"))
    report["metadata"]["registryCatalogSha256"] = "f" * 64
    write_json(inputs.meeting_evaluation_reports[1], report)

    with pytest.raises(ValueError, match="not bound to the registry snapshot"):
        evaluate_phase4e_dev_readiness(inputs)
