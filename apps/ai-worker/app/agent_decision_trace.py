from __future__ import annotations

import json
import logging
import re
from hashlib import sha256

LOGGER = logging.getLogger(__name__)

AGENT_DECISION_TRACE_VERSION = "agent-decision-trace:v1"
LEGACY_CONTEXT_PROJECTION_VERSION = "legacy-planning-context:v1"
_SAFE_REVISION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")


def canonical_sha256(value: object) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256(canonical).hexdigest()


def build_agent_decision_trace(**values: object) -> dict[str, object]:
    """Best-effort trace construction that cannot fail Agent execution."""

    try:
        return _build_agent_decision_trace(**values)  # type: ignore[arg-type]
    except Exception:
        run_id = values.get("run_id")
        turn_sequence = values.get("turn_sequence")
        safe_turn = turn_sequence if isinstance(turn_sequence, int) and turn_sequence > 0 else 1
        correlation_seed = f"{run_id if isinstance(run_id, str) else 'unknown'}:{safe_turn}"
        return {
            "version": AGENT_DECISION_TRACE_VERSION,
            "correlationId": f"agt_{sha256(correlation_seed.encode('utf-8')).hexdigest()[:24]}",
            "turnSequence": safe_turn,
            "stages": {},
            "diagnosticCodes": ["decision_trace_build_failed"],
        }


def _build_agent_decision_trace(
    *,
    run_id: str,
    thread_id: str | None,
    turn_sequence: int,
    prompt: str,
    request_context: object,
    planning_context: str,
    planner_model: str | None,
    router_model: str | None,
    tool_schema_version: str,
    tools: tuple[object, ...],
    catalog_version: str | None,
    catalog_sha256: str | None,
    planner_prompt_template: str,
    router_prompt_template: str,
    context_projection_version: str = LEGACY_CONTEXT_PROJECTION_VERSION,
) -> dict[str, object]:
    """Build a redacted, deterministic trace without retaining decision inputs."""

    diagnostics: list[str] = []
    safe_planner_model = _safe_revision(planner_model)
    safe_router_model = _safe_revision(router_model)
    safe_schema_version = _safe_revision(tool_schema_version)
    safe_catalog_version = _safe_revision(catalog_version)
    safe_catalog_sha = _safe_sha256(catalog_sha256)
    if safe_planner_model is None:
        diagnostics.append("planner_model_missing")
    if router_model is not None and safe_router_model is None:
        diagnostics.append("router_model_invalid")
    if safe_schema_version is None:
        diagnostics.append("tool_schema_version_missing")
    if catalog_version is not None and safe_catalog_version is None:
        diagnostics.append("catalog_version_invalid")
    if catalog_sha256 is not None and safe_catalog_sha is None:
        diagnostics.append("catalog_sha_invalid")
    if thread_id is None:
        diagnostics.append("thread_scope_missing")

    tool_contracts = [_tool_contract(tool) for tool in tools]
    tool_schemas = [
        {"name": contract["name"], "inputSchema": contract["inputSchema"]}
        for contract in tool_contracts
    ]
    context_fingerprint = canonical_sha256(
        {
            "version": context_projection_version,
            "requestContext": request_context,
            "planningContext": planning_context,
        }
    )
    model_contract = {
        "planner": safe_planner_model,
        "router": safe_router_model,
        "temperature": "provider_default",
    }
    revision_contract = {
        "toolSchemaVersion": safe_schema_version,
        "toolSchemaSha256": canonical_sha256(tool_schemas),
        "toolRegistrySha256": canonical_sha256(tool_contracts),
        "catalogVersion": safe_catalog_version,
        "catalogSha256": safe_catalog_sha,
        "plannerPromptSha256": canonical_sha256(planner_prompt_template),
        "routerPromptSha256": canonical_sha256(router_prompt_template),
    }
    input_fingerprint = canonical_sha256(
        {
            "promptSha256": canonical_sha256(prompt),
            "contextFingerprintSha256": context_fingerprint,
            "models": model_contract,
            "revisions": revision_contract,
        }
    )
    correlation_id = f"agt_{canonical_sha256({'runId': run_id, 'turn': turn_sequence})[:24]}"

    return {
        "version": AGENT_DECISION_TRACE_VERSION,
        "correlationId": correlation_id,
        "turnSequence": turn_sequence,
        "threadScopeSha256": canonical_sha256(thread_id) if thread_id is not None else None,
        "contextProjectionVersion": context_projection_version,
        "contextFingerprintSha256": context_fingerprint,
        "inputFingerprintSha256": input_fingerprint,
        "models": model_contract,
        "revisions": revision_contract,
        "stages": {
            "contextResolution": {
                "status": "not_available",
                "code": "context_resolver_not_implemented",
            },
            "router": {"status": "pending"},
            "nextTool": {"status": "pending"},
            "plannerInput": {"status": "pending"},
            "handoff": {"status": "not_started"},
            "terminalPolicy": {"status": "pending"},
        },
        "diagnosticCodes": sorted(set(diagnostics)),
    }


def record_trace_stage(
    trace: dict[str, object],
    stage: str,
    observation: dict[str, object],
) -> None:
    stages = trace.get("stages")
    if not isinstance(stages, dict):
        return
    stages[stage] = _safe_stage_observation(observation)


def attach_decision_trace(
    output_summary: dict[str, object],
    trace: dict[str, object] | None,
) -> None:
    if trace is not None:
        output_summary["decisionTrace"] = trace


def emit_decision_trace_event(
    *,
    correlation_id: str | None,
    turn_sequence: int,
    stage: str,
    outcome: str,
    diagnostic_code: str | None = None,
) -> None:
    """Best-effort telemetry. Observability must never affect Agent execution."""

    try:
        if not isinstance(correlation_id, str) or not correlation_id.startswith("agt_"):
            return
        event: dict[str, object] = {
            "event": "agent_decision_trace",
            "component": "ai_worker",
            "correlation_id": correlation_id,
            "turn_sequence": turn_sequence,
            "stage": stage,
            "outcome": outcome,
        }
        if diagnostic_code:
            event["diagnostic_code"] = diagnostic_code
        LOGGER.info(json.dumps(event, separators=(",", ":"), sort_keys=True))
    except Exception:
        return


def _tool_contract(tool: object) -> dict[str, object]:
    return {
        "name": str(getattr(tool, "name", ""))[:200],
        "descriptionSha256": canonical_sha256(str(getattr(tool, "description", ""))),
        "riskLevel": str(getattr(tool, "risk_level", ""))[:50],
        "executionMode": str(getattr(tool, "execution_mode", ""))[:50],
        "inputSchema": getattr(tool, "input_schema", {}),
    }


def _safe_revision(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized if _SAFE_REVISION_PATTERN.fullmatch(normalized) else None


def _safe_sha256(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if re.fullmatch(r"[0-9a-f]{64}", normalized) else None


def _safe_stage_observation(value: dict[str, object]) -> dict[str, object]:
    safe: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str) or len(key) > 100:
            continue
        if item is None or isinstance(item, bool | int):
            safe[key] = item
        elif isinstance(item, str) and len(item) <= 200:
            safe[key] = item
        elif (
            isinstance(item, list)
            and len(item) <= 20
            and all(isinstance(entry, str) and len(entry) <= 200 for entry in item)
        ):
            safe[key] = item
    return safe
