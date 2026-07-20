import json

from app.agent_latency import AgentLatencyObserver, agent_latency_trace_key

RUN_ID = "33333333-3333-3333-3333-333333333333"


def test_sql_erd_latency_event_contains_only_bounded_observation_fields():
    events: list[dict[str, object]] = []
    observer = AgentLatencyObserver(now=lambda: 1.25, emit=events.append)

    observer.observe(
        run_id=RUN_ID,
        stage="router",
        outcome="success",
        started_at=1.0,
        turn_sequence=2,
        surface="sql_erd",
        retrieval_mode="llm_router",
        provider_total_tokens=21,
    )

    assert events == [
        {
            "event": "agent_latency",
            "component": "ai_worker",
            "stage": "router",
            "outcome": "success",
            "elapsed_ms": 250,
            "trace_key": agent_latency_trace_key(RUN_ID),
            "turn_sequence": 2,
            "surface": "sql_erd",
            "retrieval_mode": "llm_router",
            "provider_total_tokens": 21,
        }
    ]
    assert RUN_ID not in json.dumps(events)


def test_latency_observer_ignores_other_surfaces_and_unknown_sql_erd_tools():
    events: list[dict[str, object]] = []
    observer = AgentLatencyObserver(now=lambda: 2.0, emit=events.append)

    observer.observe(
        run_id=RUN_ID,
        stage="planning_turn",
        outcome="success",
        elapsed_ms=10,
        surface="calendar",
    )
    observer.observe(
        run_id=RUN_ID,
        stage="tool_execution",
        outcome="success",
        elapsed_ms=10,
        surface="sql_erd",
        tool_name="generate_sql_erd",
    )

    assert events == []


def test_latency_observer_normalizes_unbounded_values_without_copying_payloads():
    events: list[dict[str, object]] = []
    observer = AgentLatencyObserver(now=lambda: 2.0, emit=events.append)

    observer.observe(
        run_id=RUN_ID,
        stage="router",
        outcome="unexpected",
        elapsed_ms=-5,
        turn_sequence=-2,
        surface="sql_erd",
        retrieval_mode="unbounded-provider-mode",
        provider_input_tokens=-1,
        provider_output_tokens=4,
        failure_type="provider-secret-error-message",
    )

    assert events == [
        {
            "event": "agent_latency",
            "component": "ai_worker",
            "stage": "router",
            "outcome": "failure",
            "elapsed_ms": 0,
            "trace_key": agent_latency_trace_key(RUN_ID),
            "surface": "sql_erd",
            "provider_output_tokens": 4,
            "failure_type": "unknown",
        }
    ]
    serialized = json.dumps(events)
    assert "unbounded-provider-mode" not in serialized
    assert "provider-secret-error-message" not in serialized


def test_latency_observer_never_propagates_logger_failure():
    def fail_emit(_event: dict[str, object]) -> None:
        raise RuntimeError("logger unavailable")

    observer = AgentLatencyObserver(now=lambda: 2.0, emit=fail_emit)

    observer.observe(
        run_id=RUN_ID,
        stage="planner",
        outcome="failure",
        elapsed_ms=20,
        surface="sql_erd",
        failure_type="provider_error",
    )


def test_latency_trace_key_is_deterministic_and_does_not_contain_raw_id():
    first = agent_latency_trace_key(RUN_ID)
    second = agent_latency_trace_key(RUN_ID)
    other = agent_latency_trace_key("44444444-4444-4444-4444-444444444444")

    assert first == second
    assert first != other
    assert len(first) == 16
    assert RUN_ID not in first
