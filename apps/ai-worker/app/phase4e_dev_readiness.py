from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

PHASE4E_READINESS_FORMAT = "phase4e-dev-readiness:v1"
_REGISTRY_FORMAT = "agent-tool-retrieval-registry-snapshot:v1"
_APP_SERVER_FORMAT = "phase4e-meeting-runtime-readiness:v2"
_QUALITY_FORMAT = "agent-tool-retrieval-quality-baseline:v1"
_SECURITY_FORMAT = "agent-prompt-security-gate:v1"
_UUID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
_DEV_MODE_PATTERN = re.compile(r'AGENT_TOOL_RETRIEVAL_MODE\s*=\s*"llm_router"')
_FORBIDDEN_OUTPUT_KEY_PARTS = (
    "authorization",
    "credential",
    "password",
    "prompt",
    "resourceid",
    "secret",
    "token",
    "transcript",
)
_REQUIRED_WRITE_CHAINS = {
    "meeting.leave": ("get_active_meeting", "leave_meeting"),
    "meeting.recording.end": ("get_active_meeting", "end_meeting_recording"),
    "meeting.action_items.update": (
        "find_action_items",
        "update_meeting_report_action_item",
    ),
    "meeting.action_items.approve": (
        "find_action_items",
        "approve_meeting_report_action_item",
    ),
}
_MEETING_EVALUATION_VARIANTS = {
    "canonical": {
        "exactAttemptRate": 1.0,
        "domainExactOverallRate": 1.0,
        "conditionalToolAccuracy": 1.0,
    },
    "held_out": {
        "toolSelectionAccuracy": 0.95,
        "domainExactOverallRate": 0.95,
        "conditionalToolAccuracy": 0.95,
    },
    "counterexample": {
        "toolSelectionAccuracy": 0.95,
        "domainExactOverallRate": 0.95,
        "conditionalToolAccuracy": 0.95,
    },
    "context": {
        "exactAttemptRate": 0.95,
        "domainExactOverallRate": 0.95,
        "conditionalToolAccuracy": 0.95,
    },
    "multi_tool": {
        "multiToolExactWorkflowRate": 0.95,
        "domainExactOverallRate": 0.95,
        "capabilityExactOverallRate": 0.95,
        "conditionalToolAccuracy": 0.95,
    },
}


@dataclass(frozen=True)
class Phase4eReadinessInputs:
    registry_snapshot: Path
    tool_retrieval_report: Path
    prompt_security_report: Path
    app_server_report: Path
    meeting_catalog: Path
    dev_terraform: Path
    rollout_runbook: Path
    meeting_evaluation_reports: tuple[Path, ...]


def evaluate_phase4e_dev_readiness(inputs: Phase4eReadinessInputs) -> dict[str, object]:
    registry = _load_json(inputs.registry_snapshot)
    retrieval = _load_json(inputs.tool_retrieval_report)
    security = _load_json(inputs.prompt_security_report)
    app_server = _load_json(inputs.app_server_report)
    meeting_catalog = _load_json(inputs.meeting_catalog)

    registry_hashes = _validate_registry(registry)
    retrieval_metrics = _validate_retrieval(retrieval, registry_hashes)
    security_counts = _validate_security(security)
    write_contract_count = _validate_app_server(app_server, registry_hashes)
    regression_counts, evaluation_inventory = _validate_meeting_catalog(meeting_catalog)
    evaluation_metrics = _validate_meeting_evaluations(
        inputs.meeting_evaluation_reports,
        registry_hashes,
        _file_sha256(inputs.meeting_catalog),
        evaluation_inventory,
    )
    _validate_dev_rollout(inputs.dev_terraform, inputs.rollout_runbook)

    report: dict[str, object] = {
        "format": PHASE4E_READINESS_FORMAT,
        "passed": True,
        "checks": [
            {"id": "registry_integrity", "status": "passed"},
            {"id": "meeting_regression_inventory", "status": "passed"},
            {"id": "meeting_planner_evaluation", "status": "passed"},
            {"id": "tool_retrieval_quality", "status": "passed"},
            {"id": "prompt_injection_security", "status": "passed"},
            {"id": "meeting_write_runtime_contracts", "status": "passed"},
            {"id": "dev_llm_router_default", "status": "passed"},
            {"id": "shadow_rollback_runbook", "status": "passed"},
        ],
        "registry": registry_hashes,
        "regression": regression_counts,
        "evaluation": evaluation_metrics,
        "retrieval": retrieval_metrics,
        "security": security_counts,
        "runtime": {"writeContractCount": write_contract_count},
        "rollout": {"defaultMode": "llm_router", "rollbackMode": "shadow"},
        "inputSha256": {
            "meetingCatalog": _file_sha256(inputs.meeting_catalog),
            "rolloutRunbook": _file_sha256(inputs.rollout_runbook),
            "devTerraform": _file_sha256(inputs.dev_terraform),
        },
    }
    _assert_privacy_safe(report)
    return report


def _validate_meeting_evaluations(
    paths: tuple[Path, ...],
    registry_hashes: dict[str, str],
    meeting_catalog_sha256: str,
    evaluation_inventory: dict[str, dict[str, int]],
) -> dict[str, object]:
    if len(paths) != len(_MEETING_EVALUATION_VARIANTS):
        raise ValueError("Phase 4-E requires every Meeting evaluation report")
    summaries: dict[str, object] = {}
    for path in paths:
        report = _load_json(path)
        metadata = _object(report.get("metadata"), "Missing Meeting evaluation metadata")
        suite_version = metadata.get("suiteVersion")
        if not isinstance(suite_version, str) or not suite_version.startswith(
            "meeting-agent-regression:v1:"
        ):
            raise ValueError("Invalid Meeting evaluation suite")
        variant = suite_version.rsplit(":", 1)[-1]
        expected = _MEETING_EVALUATION_VARIANTS.get(variant)
        if expected is None or variant in summaries:
            raise ValueError("Duplicate or unknown Meeting evaluation variant")
        if (
            metadata.get("llmRouting") is not True
            or metadata.get("compareShadowRetrieval") is not False
        ):
            raise ValueError("Meeting evaluation must use two-stage LLM routing")
        if metadata.get("meetingCatalogSha256") != meeting_catalog_sha256:
            raise ValueError("Meeting evaluation is not bound to the fixture catalog")
        received_registry = {
            "inventorySha256": metadata.get("registryInventorySha256"),
            "catalogSha256": metadata.get("registryCatalogSha256"),
            "eligibleSnapshotSha256": metadata.get("registryEligibleSnapshotSha256"),
        }
        if received_registry != registry_hashes:
            raise ValueError("Meeting evaluation is not bound to the registry snapshot")

        inventory = evaluation_inventory[variant]
        case_count = inventory["caseCount"]
        tool_selection_case_count = inventory["toolSelectionCaseCount"]
        repetitions = metadata.get("repetitions")
        if not isinstance(repetitions, int) or isinstance(repetitions, bool) or repetitions < 5:
            raise ValueError(f"Meeting evaluation requires at least 5 repetitions: {variant}")
        if report.get("totalCases") != case_count:
            raise ValueError(f"Incomplete Meeting evaluation cases: {variant}/llm_router")
        expected_attempts = case_count * repetitions
        attempts = report.get("totalAttempts")
        if attempts != expected_attempts:
            raise ValueError(f"Incomplete Meeting evaluation: {variant}/llm_router")
        funnel = _object(report.get("routingFunnel"), "Missing LLM routing funnel")
        expected_funnel_attempts = tool_selection_case_count * repetitions
        funnel_attempts = funnel.get("toolSelectionAttempts")
        if funnel_attempts != expected_funnel_attempts:
            raise ValueError(f"Incomplete Meeting routing funnel: {variant}")
        stages = _validate_routing_funnel(funnel, funnel_attempts)
        domain_stage = stages["domainExact"]
        capability_stage = stages["capabilityExact"]
        tool_stage = stages["toolExact"]
        end_stage = stages["endToEndExact"]
        derived_metrics = {
            "domainExactOverallRate": domain_stage.get("overallRate"),
            "capabilityExactOverallRate": capability_stage.get("overallRate"),
            "conditionalToolAccuracy": tool_stage.get("conditionalRate"),
        }
        multi_tool_summary = report.get("multiToolWorkflows")
        if variant == "multi_tool":
            multi_tool_summary = _object(multi_tool_summary, "Missing multi-tool workflow summary")
            derived_metrics["multiToolExactWorkflowRate"] = multi_tool_summary.get(
                "exactWorkflowRate"
            )
        elif multi_tool_summary is not None:
            raise ValueError("Unexpected multi-tool workflow summary")
        for metric_name, threshold in expected.items():
            metric = derived_metrics.get(metric_name, report.get(metric_name))
            if not isinstance(metric, int | float) or float(metric) < float(threshold):
                if metric_name == "domainExactOverallRate":
                    raise ValueError(f"Router domain threshold failed: {variant}")
                raise ValueError(
                    f"Meeting evaluation threshold failed: " f"{variant}/llm_router/{metric_name}"
                )

        retrieval = _object(report.get("retrieval"), "Missing LLM routing evaluation")
        if retrieval.get("shortlistViolations") != 0:
            raise ValueError("Planner selected a tool outside the Router tool set")
        supported_rate = retrieval.get("supportedToUnsupportedRate")
        if supported_rate not in (0, 0.0, None):
            raise ValueError("LLM Router marked a supported request unsupported")
        if variant in {"canonical", "held_out", "counterexample", "multi_tool"}:
            minimum = 1.0 if variant == "canonical" else 0.95
            for metric_name in ("domainRecallAtK", "capabilityRecallAtK"):
                metric = retrieval.get(metric_name)
                if not isinstance(metric, int | float) or float(metric) < minimum:
                    raise ValueError(
                        f"Meeting Router recall threshold failed: {variant}/{metric_name}"
                    )
        summaries[variant] = {
            "mode": "llm_router",
            "cases": case_count,
            "attempts": attempts,
            "toolSelectionAttempts": funnel_attempts,
            "exactAttemptRate": report.get("exactAttemptRate"),
            "domainExactOverallRate": domain_stage.get("overallRate"),
            "capabilityExactOverallRate": capability_stage.get("overallRate"),
            "conditionalToolAccuracy": tool_stage.get("conditionalRate"),
            "endToEndExactOverallRate": end_stage.get("overallRate"),
            "toolSelectionAccuracy": report.get("toolSelectionAccuracy"),
            "multiToolExactWorkflowRate": derived_metrics.get("multiToolExactWorkflowRate"),
        }
    if set(summaries) != set(_MEETING_EVALUATION_VARIANTS):
        raise ValueError("Meeting evaluation variants are incomplete")
    return {"variants": summaries, "modeCount": 1}


def _validate_routing_funnel(
    funnel: dict[str, object], attempts: int
) -> dict[str, dict[str, object]]:
    raw_stages = _object(funnel.get("stages"), "Missing LLM routing funnel stages")
    names = (
        "routerRouted",
        "domainExact",
        "capabilityExact",
        "toolExact",
        "requiredInputExact",
        "executionPolicyExact",
        "endToEndExact",
    )
    stages: dict[str, dict[str, object]] = {}
    previous_count = attempts
    for name in names:
        stage = _object(raw_stages.get(name), f"Missing LLM routing funnel stage: {name}")
        count = stage.get("count")
        conditional_rate = stage.get("conditionalRate")
        overall_rate = stage.get("overallRate")
        if (
            not isinstance(count, int)
            or isinstance(count, bool)
            or count < 0
            or count > previous_count
            or not isinstance(conditional_rate, int | float)
            or isinstance(conditional_rate, bool)
            or not 0 <= float(conditional_rate) <= 1
            or not isinstance(overall_rate, int | float)
            or isinstance(overall_rate, bool)
            or not 0 <= float(overall_rate) <= 1
        ):
            raise ValueError(f"Invalid LLM routing funnel stage: {name}")
        if float(overall_rate) != _fraction(count, attempts) or float(
            conditional_rate
        ) != _fraction(count, previous_count):
            raise ValueError(f"Invalid LLM routing funnel stage: {name}")
        stages[name] = stage
        previous_count = count
    return stages


def _fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _validate_registry(value: dict[str, object]) -> dict[str, str]:
    if value.get("format") != _REGISTRY_FORMAT:
        raise ValueError("Unsupported Agent registry snapshot")
    inventory = _object(value.get("inventory"), "Invalid Agent inventory")
    catalog = _object(value.get("toolCapabilityCatalog"), "Missing capability catalog")
    if not isinstance(catalog.get("capabilities"), list) or not isinstance(
        catalog.get("descriptors"), list
    ):
        raise ValueError("Invalid capability catalog")
    return {
        "inventorySha256": _sha(inventory.get("sha256")),
        "catalogSha256": _sha(inventory.get("catalogSha256")),
        "eligibleSnapshotSha256": _sha(value.get("eligibleSnapshotSha256")),
    }


def _validate_retrieval(
    value: dict[str, object], registry_hashes: dict[str, str]
) -> dict[str, float]:
    if value.get("format") != _QUALITY_FORMAT or value.get("passed") is not True:
        raise ValueError("Tool retrieval quality gate did not pass")
    metadata = _object(value.get("metadata"), "Missing retrieval metadata")
    expected = {
        "inventorySha256": metadata.get("registryInventorySha256"),
        "catalogSha256": metadata.get("registryCatalogSha256"),
        "eligibleSnapshotSha256": metadata.get("registryEligibleSnapshotSha256"),
    }
    if expected != registry_hashes:
        raise ValueError("Tool retrieval report is not bound to the registry snapshot")
    privacy = _object(value.get("privacy"), "Missing retrieval privacy result")
    if privacy.get("violationCount") != 0:
        raise ValueError("Tool retrieval report contains a privacy violation")
    thresholds = _object(value.get("thresholds"), "Missing retrieval thresholds")
    metrics = _object(value.get("metrics"), "Missing retrieval metrics")
    names = (
        "canonicalRequiredToolRecallAt8",
        "heldOutDomainRecallAt8",
        "heldOutCapabilityRecallAt8",
    )
    result: dict[str, float] = {}
    for name in names:
        metric = metrics.get(name)
        threshold = thresholds.get(name)
        if not isinstance(metric, int | float) or not isinstance(threshold, int | float):
            raise ValueError("Invalid retrieval metric")
        if float(metric) < float(threshold):
            raise ValueError(f"Retrieval threshold failed: {name}")
        result[name] = float(metric)
    return result


def _validate_security(value: dict[str, object]) -> dict[str, int]:
    if value.get("version") != _SECURITY_FORMAT or value.get("passed") is not True:
        raise ValueError("Prompt security gate did not pass")
    counts: dict[str, int] = {}
    for source, target in (
        ("caseCount", "caseCount"),
        ("blockedCount", "blockedCount"),
        ("allowedCount", "allowedCount"),
    ):
        count = value.get(source)
        if not isinstance(count, int) or isinstance(count, bool) or count < 1:
            raise ValueError("Invalid prompt security count")
        counts[target] = count
    if counts["blockedCount"] + counts["allowedCount"] != counts["caseCount"]:
        raise ValueError("Prompt security counts do not add up")
    return counts


def _validate_app_server(value: dict[str, object], registry_hashes: dict[str, str]) -> int:
    if value.get("format") != _APP_SERVER_FORMAT or value.get("passed") is not True:
        raise ValueError("App Server Meeting readiness gate did not pass")
    if _object(value.get("registry"), "Missing App Server registry binding") != registry_hashes:
        raise ValueError("App Server readiness report is not bound to the registry snapshot")
    checks = value.get("checks")
    if (
        not isinstance(checks, list)
        or not checks
        or any(not isinstance(check, dict) or check.get("status") != "passed" for check in checks)
    ):
        raise ValueError("App Server readiness checks are incomplete")
    contracts = value.get("writeContracts")
    if not isinstance(contracts, list) or len(contracts) != len(_REQUIRED_WRITE_CHAINS):
        raise ValueError("Meeting write readiness contracts are incomplete")
    contract_ids = {
        contract.get("contractId") for contract in contracts if isinstance(contract, dict)
    }
    expected_contract_ids = {
        "meeting.control.leave",
        "meeting.recording.end",
        "meeting.action_items.update",
        "meeting.action_items.approve",
    }
    if contract_ids != expected_contract_ids:
        raise ValueError("Meeting write readiness contract IDs are incomplete")
    runtime = _object(value.get("runtimeEvidence"), "Missing Meeting runtime E2E evidence")
    expected_guarantees = {
        "meeting_leave_execution",
        "recording_end_confirmation_and_execution",
        "action_item_update_confirmation_and_execution",
        "action_item_approve_confirmation_and_execution",
        "workspace_permission_enforcement",
        "approval_idempotency",
        "pre_execution_revalidation",
    }
    guarantees = runtime.get("guarantees")
    if (
        runtime.get("status") != "passed"
        or not isinstance(guarantees, list)
        or set(guarantees) != expected_guarantees
    ):
        raise ValueError("Meeting runtime E2E guarantees are incomplete")
    return len(contracts)


def _validate_meeting_catalog(
    value: dict[str, object],
) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
    if value.get("version") != "meeting-agent-regression:v1":
        raise ValueError("Unsupported Meeting regression catalog")
    prefixes = value.get("canonicalPrefixes")
    capabilities = value.get("capabilities")
    fixtures = value.get("resolutionFixtures")
    if not isinstance(prefixes, list) or not isinstance(capabilities, list):
        raise ValueError("Invalid Meeting regression catalog")
    if len(capabilities) != 18 or len(set(map(str, prefixes))) != 3:
        raise ValueError("Meeting regression coverage is incomplete")

    by_id = {_required_string(item, "id"): item for item in capabilities if isinstance(item, dict)}
    if len(by_id) != len(capabilities):
        raise ValueError("Meeting regression capability IDs must be unique")
    canonical_count = 0
    held_out_count = 0
    counterexample_count = 0
    context_count = 0
    multi_tool_workflow_count = 0
    multi_tool_stage_count = 0
    evaluation_inventory = {
        variant: {"caseCount": 0, "toolSelectionCaseCount": 0}
        for variant in _MEETING_EVALUATION_VARIANTS
    }
    for capability in capabilities:
        if not isinstance(capability, dict):
            raise ValueError("Invalid Meeting regression capability")
        canonical_case_count = len(_string_list(capability, "canonicalSeeds")) * len(prefixes)
        held_out_case_count = len(_string_list(capability, "heldOutParaphrases"))
        context_case_count = len(_string_list(capability, "contextFollowups"))
        canonical_count += canonical_case_count
        held_out_count += held_out_case_count
        context_count += context_case_count
        current_expectation = _object(
            capability.get("currentExpectation"), "Missing Meeting current expectation"
        )
        current_tool = current_expectation.get("toolName")
        if current_tool is not None and (not isinstance(current_tool, str) or not current_tool):
            raise ValueError("Invalid Meeting current expectation tool")
        for variant, count in (
            ("canonical", canonical_case_count),
            ("held_out", held_out_case_count),
            ("context", context_case_count),
        ):
            evaluation_inventory[variant]["caseCount"] += count
            if current_tool:
                evaluation_inventory[variant]["toolSelectionCaseCount"] += count
        counterexamples = capability.get("counterexamples")
        if not isinstance(counterexamples, list):
            raise ValueError("Invalid Meeting counterexamples")
        for counterexample in counterexamples:
            if not isinstance(counterexample, dict):
                raise ValueError("Invalid Meeting counterexample target")
            expected_capability = by_id.get(_required_string(counterexample, "expectedCapability"))
            if expected_capability is None:
                raise ValueError("Invalid Meeting counterexample target")
            expected = _object(
                expected_capability.get("currentExpectation"),
                "Missing Meeting current expectation",
            )
            expected_tool = expected.get("toolName")
            if expected_tool is not None and (
                not isinstance(expected_tool, str) or not expected_tool
            ):
                raise ValueError("Invalid Meeting current expectation tool")
            counterexample_count += 1
            evaluation_inventory["counterexample"]["caseCount"] += 1
            if expected_tool:
                evaluation_inventory["counterexample"]["toolSelectionCaseCount"] += 1

    quality_cases = value.get("qualityCases", [])
    if not isinstance(quality_cases, list):
        raise ValueError("Invalid Meeting quality cases")
    quality_case_ids: set[str] = set()
    for quality_case in quality_cases:
        if not isinstance(quality_case, dict):
            raise ValueError("Invalid Meeting quality case")
        quality_case_id = _required_string(quality_case, "id")
        if quality_case_id in quality_case_ids:
            raise ValueError("Meeting quality case IDs must be unique")
        quality_case_ids.add(quality_case_id)
        variant = _required_string(quality_case, "kind")
        if variant not in evaluation_inventory:
            raise ValueError("Invalid Meeting quality case variant")
        expectation = _object(
            quality_case.get("expected"), "Missing Meeting quality case expectation"
        )
        tool_name = expectation.get("toolName")
        if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
            raise ValueError("Invalid Meeting quality case tool")
        evaluation_inventory[variant]["caseCount"] += 1
        if tool_name:
            evaluation_inventory[variant]["toolSelectionCaseCount"] += 1

    multi_tool_cases = value.get("multiToolCases")
    if not isinstance(multi_tool_cases, list) or not multi_tool_cases:
        raise ValueError("Meeting multi-tool cases are incomplete")
    multi_tool_ids: set[str] = set()
    for workflow in multi_tool_cases:
        if not isinstance(workflow, dict):
            raise ValueError("Invalid Meeting multi-tool case")
        workflow_id = _required_string(workflow, "id")
        if workflow_id in multi_tool_ids:
            raise ValueError("Meeting multi-tool case IDs must be unique")
        multi_tool_ids.add(workflow_id)
        domains = _string_list(workflow, "expectedDomains")
        capability_ids = _string_list(workflow, "expectedCapabilityIds")
        stages = workflow.get("stages")
        if (
            len(set(domains)) < 2
            or len(set(capability_ids)) < 2
            or not isinstance(stages, list)
            or len(stages) < 3
        ):
            raise ValueError("Meeting multi-tool case does not cover distinct tasks")
        tool_stage_count = 0
        for stage in stages:
            if not isinstance(stage, dict):
                raise ValueError("Invalid Meeting multi-tool stage")
            tool_name = stage.get("toolName")
            if tool_name is not None:
                if not isinstance(tool_name, str) or not tool_name:
                    raise ValueError("Invalid Meeting multi-tool stage tool")
                tool_stage_count += 1
        if tool_stage_count < 2 or stages[-1].get("status") != "completed":
            raise ValueError("Meeting multi-tool workflow is incomplete")
        multi_tool_workflow_count += 1
        multi_tool_stage_count += len(stages)
        evaluation_inventory["multi_tool"]["caseCount"] += len(stages)
        evaluation_inventory["multi_tool"]["toolSelectionCaseCount"] += tool_stage_count

    for capability_id, expected_chain in _REQUIRED_WRITE_CHAINS.items():
        capability = by_id.get(capability_id)
        if capability is None:
            raise ValueError(f"Missing Meeting regression capability: {capability_id}")
        target = _object(capability.get("target"), "Missing Meeting target")
        if tuple(target.get("toolSequence", ())) != expected_chain:
            raise ValueError(f"Invalid Meeting write chain: {capability_id}")

    cardinalities = (
        {fixture.get("cardinality") for fixture in fixtures if isinstance(fixture, dict)}
        if isinstance(fixtures, list)
        else set()
    )
    if cardinalities != {"none", "single", "multiple", "homonym"}:
        raise ValueError("Meeting selector cardinality fixtures are incomplete")
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True)
    if _UUID_PATTERN.search(serialized):
        raise ValueError("Meeting regression catalog contains a raw UUID")
    return (
        {
            "capabilityCount": len(capabilities),
            "canonicalCount": canonical_count,
            "heldOutCount": held_out_count,
            "counterexampleCount": counterexample_count,
            "multiTurnCount": context_count,
            "multiToolWorkflowCount": multi_tool_workflow_count,
            "multiToolStageCount": multi_tool_stage_count,
            "selectorCardinalityCount": len(cardinalities),
        },
        evaluation_inventory,
    )


def _validate_dev_rollout(terraform_path: Path, runbook_path: Path) -> None:
    terraform = terraform_path.read_text(encoding="utf-8")
    if len(_DEV_MODE_PATTERN.findall(terraform)) != 2:
        raise ValueError("dev Agent Workers must default to llm_router exactly twice")
    runbook = runbook_path.read_text(encoding="utf-8")
    required_phrases = (
        "AGENT_TOOL_RETRIEVAL_MODE",
        "`llm_router`",
        "`shadow`",
        "Terraform apply",
        "toolRouting",
        "domains",
        "capabilityIds",
        "confirmation",
        "실행 직전",
    )
    if any(phrase not in runbook for phrase in required_phrases):
        raise ValueError("Agent retrieval rollback runbook is incomplete")


def _assert_privacy_safe(report: dict[str, object]) -> None:
    serialized = json.dumps(report, ensure_ascii=False, sort_keys=True)
    if _UUID_PATTERN.search(serialized):
        raise ValueError("Phase 4-E report contains a raw UUID")

    def visit(value: object) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", key.lower())
                if any(part in normalized for part in _FORBIDDEN_OUTPUT_KEY_PARTS):
                    raise ValueError("Phase 4-E report contains a forbidden field")
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(report)


def _load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid Phase 4-E input: {path.name}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Invalid Phase 4-E input: {path.name}")
    return value


def _object(value: object, message: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(message)
    return value


def _required_string(value: dict[str, object], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result:
        raise ValueError(f"Missing {key}")
    return result


def _string_list(value: dict[str, object], key: str) -> list[str]:
    result = value.get(key)
    if not isinstance(result, list) or not all(isinstance(item, str) and item for item in result):
        raise ValueError(f"Invalid {key}")
    return result


def _sha(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("Invalid SHA-256")
    return value


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
