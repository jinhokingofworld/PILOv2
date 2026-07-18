from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.agent_tool_retrieval import (
    TOOL_RETRIEVER_VERSION,
    ToolCapabilityCatalog,
    parse_tool_capability_catalog,
    select_read_only_tool_shortlist,
)

QUALITY_GATE_VERSION = "agent-tool-retrieval-quality-gate:v1"
CANONICAL_REQUIRED_TOOL_RECALL_AT_8 = 1.0
HELD_OUT_DOMAIN_CAPABILITY_RECALL_AT_8 = 0.95
_UUID_PATTERN = re.compile(
    r"(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class QualityGateCase:
    case_id: str
    kind: str
    prompt: str
    domain: str | None
    capability_id: str | None
    required_tool_names: tuple[str, ...]
    expected_fallback_reason: str | None
    expected_planner_tool_names: tuple[str, ...]
    schema_token_budget: int


@dataclass(frozen=True)
class ToolRetrievalQualityFixture:
    suite_version: str
    top_k: int
    schema_token_budget: int
    tool_schemas: dict[str, dict[str, object]]
    catalog: ToolCapabilityCatalog
    cases: tuple[QualityGateCase, ...]
    privacy_sensitive_values: tuple[str, ...]
    registry_snapshot_expectation: dict[str, str]


@dataclass(frozen=True)
class AgentToolRegistrySnapshot:
    inventory_sha256: str
    catalog_sha256: str
    eligible_snapshot_sha256: str
    tool_schemas: dict[str, dict[str, object]]
    catalog: ToolCapabilityCatalog


def load_tool_retrieval_quality_fixture(path: Path) -> ToolRetrievalQualityFixture:
    raw_bytes = path.read_bytes()
    try:
        value = json.loads(raw_bytes)
    except json.JSONDecodeError as error:
        raise ValueError("Invalid tool retrieval quality fixture") from error
    if not isinstance(value, dict) or value.get("version") != QUALITY_GATE_VERSION:
        raise ValueError("Unsupported tool retrieval quality fixture")

    suite_version = _required_string(value, "suiteVersion")
    top_k = _positive_int(value, "topK")
    schema_token_budget = _positive_int(value, "schemaTokenBudget")
    tool_schemas = _tool_schemas(value.get("eligibleToolSchemas"))
    catalog = parse_tool_capability_catalog(value.get("toolCapabilityCatalog"), tool_schemas)
    if catalog is None:
        raise ValueError("Tool retrieval quality fixture requires a catalog")

    raw_cases = value.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("Tool retrieval quality fixture requires cases")
    cases = tuple(
        _quality_case(item, schema_token_budget=schema_token_budget) for item in raw_cases
    )
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError("Tool retrieval quality fixture case IDs must be unique")
    if not any(case.kind == "canonical" for case in cases) or not any(
        case.kind == "held_out" for case in cases
    ):
        raise ValueError("Tool retrieval quality fixture requires canonical and held-out cases")

    raw_sensitive_values = value.get("privacySensitiveValues")
    if not isinstance(raw_sensitive_values, list) or not all(
        isinstance(item, str) and item for item in raw_sensitive_values
    ):
        raise ValueError("Tool retrieval quality fixture requires privacySensitiveValues")
    registry_snapshot_expectation = _registry_snapshot_expectation(value)
    return ToolRetrievalQualityFixture(
        suite_version=suite_version,
        top_k=top_k,
        schema_token_budget=schema_token_budget,
        tool_schemas=tool_schemas,
        catalog=catalog,
        cases=cases,
        privacy_sensitive_values=tuple(raw_sensitive_values),
        registry_snapshot_expectation=registry_snapshot_expectation,
    )


def load_agent_tool_registry_snapshot(path: Path) -> AgentToolRegistrySnapshot:
    try:
        value = json.loads(path.read_bytes())
    except json.JSONDecodeError as error:
        raise ValueError("Invalid agent tool registry snapshot") from error
    if (
        not isinstance(value, dict)
        or value.get("format") != "agent-tool-retrieval-registry-snapshot:v1"
    ):
        raise ValueError("Unsupported agent tool registry snapshot")

    inventory = value.get("inventory")
    if not isinstance(inventory, dict):
        raise ValueError("Invalid agent tool registry snapshot")
    inventory_sha256 = _required_string(inventory, "sha256")
    catalog_sha256 = _required_string(inventory, "catalogSha256")
    eligible_snapshot_sha256 = _required_string(value, "eligibleSnapshotSha256")
    tool_schemas = _tool_schemas(value.get("eligibleToolSchemas"))
    if eligible_snapshot_sha256 != _eligible_snapshot_sha256(tool_schemas):
        raise ValueError("Invalid agent tool registry snapshot")
    catalog = parse_tool_capability_catalog(value.get("toolCapabilityCatalog"), tool_schemas)
    if catalog is None or catalog.sha256 != catalog_sha256:
        raise ValueError("Invalid agent tool registry snapshot")
    return AgentToolRegistrySnapshot(
        inventory_sha256=inventory_sha256,
        catalog_sha256=catalog_sha256,
        eligible_snapshot_sha256=eligible_snapshot_sha256,
        tool_schemas=tool_schemas,
        catalog=catalog,
    )


def bind_quality_fixture_to_registry_snapshot(
    fixture: ToolRetrievalQualityFixture,
    snapshot: AgentToolRegistrySnapshot,
) -> ToolRetrievalQualityFixture:
    expected = fixture.registry_snapshot_expectation
    actual = {
        "inventorySha256": snapshot.inventory_sha256,
        "catalogSha256": snapshot.catalog_sha256,
        "eligibleSnapshotSha256": snapshot.eligible_snapshot_sha256,
    }
    if expected != actual:
        raise ValueError("Quality fixture does not match agent tool registry snapshot")
    return fixture


def evaluate_tool_retrieval_quality_gate(
    fixture: ToolRetrievalQualityFixture,
    *,
    fixture_sha256: str,
) -> dict[str, object]:
    failures: list[str] = []
    result_rows: list[dict[str, object]] = []
    canonical_required_tool_matches: list[bool] = []
    held_out_domain_matches: list[bool] = []
    held_out_capability_matches: list[bool] = []

    for case in fixture.cases:
        selection = select_read_only_tool_shortlist(
            case.prompt,
            fixture.catalog,
            fixture.tool_schemas,
            top_k=fixture.top_k,
            schema_token_budget=case.schema_token_budget,
        )
        retrieval = selection.retrieval
        retrieved_tool_names = set(retrieval.tool_names)
        selected_capability_ids = set(retrieval.selected_capability_ids)
        selected_domains = {
            capability.domain
            for capability in fixture.catalog.capabilities
            if capability.capability_id in selected_capability_ids
        }
        required_tool_match = set(case.required_tool_names) <= retrieved_tool_names
        domain_match = case.domain is None or case.domain in selected_domains
        capability_match = (
            case.capability_id is None or case.capability_id in selected_capability_ids
        )
        fallback_match = retrieval.fallback_reason == case.expected_fallback_reason
        planner_tool_match = selection.tool_names == case.expected_planner_tool_names

        if case.kind == "canonical" and case.required_tool_names:
            canonical_required_tool_matches.append(required_tool_match)
            if not required_tool_match:
                failures.append("canonical_required_tool_recall")
        if case.kind == "held_out":
            held_out_domain_matches.append(domain_match)
            held_out_capability_matches.append(capability_match)
            if not domain_match:
                failures.append("held_out_domain_recall")
            if not capability_match:
                failures.append("held_out_capability_recall")
        if not fallback_match:
            failures.append("fallback_contract")
        if not planner_tool_match:
            failures.append("planner_fallback_or_shortlist_contract")

        result_rows.append(
            {
                "caseId": case.case_id,
                "kind": case.kind,
                "requiredToolRecall": required_tool_match,
                "domainRecall": domain_match,
                "capabilityRecall": capability_match,
                "fallbackMatchesExpected": fallback_match,
                "plannerToolSetMatchesExpected": planner_tool_match,
                "retrieval": {
                    "lowConfidence": retrieval.low_confidence,
                    "fallbackReason": retrieval.fallback_reason,
                    "shortlistSize": len(retrieval.tool_names),
                    "shortlistSha256": _names_sha256(retrieval.tool_names),
                },
                "planner": {
                    "toolSetSize": len(selection.tool_names),
                    "toolSetSha256": _names_sha256(selection.tool_names),
                },
                "schemaTokenBudget": case.schema_token_budget,
            }
        )

    canonical_recall = _rate(canonical_required_tool_matches)
    held_out_domain_recall = _rate(held_out_domain_matches)
    held_out_capability_recall = _rate(held_out_capability_matches)
    if canonical_recall < CANONICAL_REQUIRED_TOOL_RECALL_AT_8:
        failures.append("canonical_required_tool_threshold")
    if held_out_domain_recall < HELD_OUT_DOMAIN_CAPABILITY_RECALL_AT_8:
        failures.append("held_out_domain_threshold")
    if held_out_capability_recall < HELD_OUT_DOMAIN_CAPABILITY_RECALL_AT_8:
        failures.append("held_out_capability_threshold")

    report: dict[str, object] = {
        "format": "agent-tool-retrieval-quality-baseline:v1",
        "passed": not failures,
        "metadata": {
            "suiteVersion": fixture.suite_version,
            "suiteSha256": fixture_sha256,
            "catalogVersion": fixture.catalog.version,
            "catalogSha256": fixture.catalog.sha256,
            "eligibleSnapshotSha256": _eligible_snapshot_sha256(fixture.tool_schemas),
            "registryInventorySha256": fixture.registry_snapshot_expectation["inventorySha256"],
            "registryCatalogSha256": fixture.registry_snapshot_expectation["catalogSha256"],
            "registryEligibleSnapshotSha256": fixture.registry_snapshot_expectation[
                "eligibleSnapshotSha256"
            ],
            "modelVersion": "deterministic:no-provider",
            "retrieverVersion": TOOL_RETRIEVER_VERSION,
            "topK": fixture.top_k,
            "defaultSchemaTokenBudget": fixture.schema_token_budget,
        },
        "thresholds": {
            "canonicalRequiredToolRecallAt8": CANONICAL_REQUIRED_TOOL_RECALL_AT_8,
            "heldOutDomainRecallAt8": HELD_OUT_DOMAIN_CAPABILITY_RECALL_AT_8,
            "heldOutCapabilityRecallAt8": HELD_OUT_DOMAIN_CAPABILITY_RECALL_AT_8,
        },
        "metrics": {
            "canonicalRequiredToolRecallAt8": canonical_recall,
            "heldOutDomainRecallAt8": held_out_domain_recall,
            "heldOutCapabilityRecallAt8": held_out_capability_recall,
        },
        "failureTaxonomy": _failure_taxonomy(failures),
        "results": result_rows,
    }
    privacy_failures = _privacy_failures(report, fixture.privacy_sensitive_values)
    if privacy_failures:
        report["passed"] = False
        report["failureTaxonomy"] = _failure_taxonomy([*failures, *privacy_failures])
    report["privacy"] = {"violationCount": len(privacy_failures)}
    return report


def fixture_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _registry_snapshot_expectation(value: dict[object, object]) -> dict[str, str]:
    snapshot = value.get("registrySnapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("Tool retrieval quality fixture requires registrySnapshot")
    return {
        "inventorySha256": _required_string(snapshot, "inventorySha256"),
        "catalogSha256": _required_string(snapshot, "catalogSha256"),
        "eligibleSnapshotSha256": _required_string(snapshot, "eligibleSnapshotSha256"),
    }


def _quality_case(value: object, *, schema_token_budget: int) -> QualityGateCase:
    if not isinstance(value, dict):
        raise ValueError("Invalid tool retrieval quality case")
    kind = _required_string(value, "kind")
    if kind not in {"canonical", "held_out", "counterexample", "fallback"}:
        raise ValueError("Invalid tool retrieval quality case kind")
    expected_fallback_reason = value.get("expectedFallbackReason")
    if expected_fallback_reason is not None and not isinstance(expected_fallback_reason, str):
        raise ValueError("Invalid tool retrieval quality fallback expectation")
    domain = value.get("domain")
    capability_id = value.get("capabilityId")
    if domain is not None and not isinstance(domain, str):
        raise ValueError("Invalid tool retrieval quality domain")
    if capability_id is not None and not isinstance(capability_id, str):
        raise ValueError("Invalid tool retrieval quality capability")
    return QualityGateCase(
        case_id=_required_string(value, "id"),
        kind=kind,
        prompt=_required_string(value, "prompt"),
        domain=domain,
        capability_id=capability_id,
        required_tool_names=_string_tuple(value, "requiredToolNames"),
        expected_fallback_reason=expected_fallback_reason,
        expected_planner_tool_names=_string_tuple(value, "expectedPlannerToolNames"),
        schema_token_budget=_optional_positive_int(value, "schemaTokenBudget", schema_token_budget),
    )


def _tool_schemas(value: object) -> dict[str, dict[str, object]]:
    if not isinstance(value, dict) or not value:
        raise ValueError("Invalid eligible tool schemas")
    schemas: dict[str, dict[str, object]] = {}
    for name, schema in value.items():
        if not isinstance(name, str) or not name or not isinstance(schema, dict):
            raise ValueError("Invalid eligible tool schemas")
        schemas[name] = schema
    return schemas


def _required_string(value: dict[object, object], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError("Invalid tool retrieval quality fixture")
    return result.strip()


def _string_tuple(value: dict[object, object], key: str) -> tuple[str, ...]:
    result = value.get(key)
    if not isinstance(result, list) or not all(isinstance(item, str) and item for item in result):
        raise ValueError("Invalid tool retrieval quality fixture")
    return tuple(result)


def _positive_int(value: dict[object, object], key: str) -> int:
    return _optional_positive_int(value, key, 0)


def _optional_positive_int(value: dict[object, object], key: str, default: int) -> int:
    result = value.get(key, default)
    if not isinstance(result, int) or isinstance(result, bool) or result < 1:
        raise ValueError("Invalid tool retrieval quality fixture")
    return result


def _rate(values: list[bool]) -> float:
    return sum(values) / len(values) if values else 0.0


def _failure_taxonomy(failures: list[str]) -> dict[str, int]:
    return {failure: failures.count(failure) for failure in sorted(set(failures))}


def _names_sha256(names: object) -> str:
    return hashlib.sha256(
        json.dumps(list(names), ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def _eligible_snapshot_sha256(tool_schemas: dict[str, dict[str, object]]) -> str:
    return hashlib.sha256(
        json.dumps(tool_schemas, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _privacy_failures(report: dict[str, object], sensitive_values: tuple[str, ...]) -> list[str]:
    serialized = json.dumps(report, ensure_ascii=False, sort_keys=True)
    failures = (
        ["privacy_sensitive_value_exposed"]
        if any(value in serialized for value in sensitive_values)
        else []
    )
    if _UUID_PATTERN.search(serialized):
        failures.append("privacy_uuid_exposed")
    return failures
