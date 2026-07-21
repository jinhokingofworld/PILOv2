import json
from types import SimpleNamespace

from app.agent_decision_trace import (
    AGENT_DECISION_TRACE_VERSION,
    build_agent_decision_trace,
    canonical_sha256,
    record_trace_stage,
)


def _tool() -> SimpleNamespace:
    return SimpleNamespace(
        name="list_calendar_events",
        description="Calendar 일정 목록 조회",
        risk_level="low",
        execution_mode="auto",
        input_schema={"type": "object", "properties": {"start": {"type": "string"}}},
    )


def _trace(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "run_id": "33333333-3333-3333-3333-333333333333",
        "thread_id": "44444444-4444-4444-8444-444444444444",
        "turn_sequence": 2,
        "prompt": "아까 찾은 첫 번째 일정 보여줘",
        "request_context": {"surface": "sql_erd", "sessionId": "raw-session-id"},
        "planning_context": "tool result with raw-resource-id",
        "planner_model": "gpt-planner-snapshot",
        "router_model": "gpt-router-snapshot",
        "tool_schema_version": "agent-tools:v7",
        "tools": (_tool(),),
        "catalog_version": "agent-tool-capabilities:v2",
        "catalog_sha256": "a" * 64,
        "planner_prompt_template": "planner system prompt",
        "router_prompt_template": "router system prompt",
    }
    values.update(overrides)
    return build_agent_decision_trace(**values)  # type: ignore[arg-type]


def test_canonical_sha256_is_order_independent_for_objects() -> None:
    assert canonical_sha256({"b": 2, "a": [1, 3]}) == canonical_sha256({"a": [1, 3], "b": 2})


def test_decision_trace_fingerprint_is_deterministic_and_revision_sensitive() -> None:
    first = _trace()
    repeated = _trace()
    changed_context = _trace(planning_context="different context")
    changed_model = _trace(planner_model="gpt-planner-next")

    assert first["version"] == AGENT_DECISION_TRACE_VERSION
    assert first["inputFingerprintSha256"] == repeated["inputFingerprintSha256"]
    assert first["inputFingerprintSha256"] != changed_context["inputFingerprintSha256"]
    assert first["inputFingerprintSha256"] != changed_model["inputFingerprintSha256"]


def test_decision_trace_does_not_persist_raw_inputs_or_resource_identifiers() -> None:
    trace = _trace()
    serialized = json.dumps(trace, ensure_ascii=False, sort_keys=True)

    assert "아까 찾은 첫 번째 일정 보여줘" not in serialized
    assert "raw-session-id" not in serialized
    assert "raw-resource-id" not in serialized
    assert "33333333-3333-3333-3333-333333333333" not in serialized
    assert "44444444-4444-4444-8444-444444444444" not in serialized


def test_decision_trace_stage_allowlist_drops_nested_or_oversized_values() -> None:
    trace = _trace()
    record_trace_stage(
        trace,
        "plannerInput",
        {
            "status": "completed",
            "selectedToolName": "list_calendar_events",
            "rawToolInput": {"eventId": "must-not-persist"},
            "oversized": "x" * 201,
        },
    )

    planner_stage = trace["stages"]["plannerInput"]  # type: ignore[index]
    assert planner_stage == {
        "status": "completed",
        "selectedToolName": "list_calendar_events",
    }


def test_decision_trace_build_failure_returns_safe_diagnostic() -> None:
    trace = _trace(request_context={"invalid": object()})

    assert trace["diagnosticCodes"] == ["decision_trace_build_failed"]
    assert str(trace["correlationId"]).startswith("agt_")
