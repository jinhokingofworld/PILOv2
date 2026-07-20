from __future__ import annotations

import json
import logging
from collections.abc import Callable
from hashlib import sha256
from time import monotonic

LOGGER = logging.getLogger(__name__)

SQL_ERD_SURFACE = "sql_erd"
SQL_ERD_TOOL_NAMES = frozenset({"inspect_sql_erd_schema", "focus_sql_erd_tables"})
AGENT_LATENCY_STAGES = frozenset(
    {"queue_wait", "router", "planner", "execution_handoff", "planning_turn"}
)
AGENT_LATENCY_OUTCOMES = frozenset({"success", "failure", "fallback", "clarification"})
AGENT_LATENCY_RETRIEVAL_MODES = frozenset({"shadow", "shortlist", "llm_router"})
AGENT_LATENCY_FAILURE_TYPES = frozenset(
    {
        "timeout",
        "provider_error",
        "validation_error",
        "repository_error",
        "domain_error",
        "unknown",
    }
)


def agent_latency_trace_key(run_id: str) -> str:
    return sha256(run_id.encode("utf-8")).hexdigest()[:16]


def _default_emit(event: dict[str, object]) -> None:
    LOGGER.info(json.dumps(event, separators=(",", ":"), sort_keys=True))


def _nonnegative_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    rounded = int(round(value))
    return rounded if rounded >= 0 else None


class AgentLatencyObserver:
    def __init__(
        self,
        *,
        now: Callable[[], float] = monotonic,
        emit: Callable[[dict[str, object]], None] = _default_emit,
    ) -> None:
        self._now = now
        self._emit = emit

    def start(self) -> float:
        return self._now()

    def observe(
        self,
        *,
        run_id: str,
        stage: str,
        outcome: str,
        surface: str | None,
        started_at: float | None = None,
        elapsed_ms: int | float | None = None,
        turn_sequence: int | None = None,
        tool_name: str | None = None,
        retrieval_mode: str | None = None,
        provider_input_tokens: int | None = None,
        provider_output_tokens: int | None = None,
        provider_total_tokens: int | None = None,
        failure_type: str | None = None,
    ) -> None:
        try:
            if surface != SQL_ERD_SURFACE or stage not in AGENT_LATENCY_STAGES:
                return
            if tool_name is not None and tool_name not in SQL_ERD_TOOL_NAMES:
                return

            if elapsed_ms is None and started_at is not None:
                elapsed_ms = (self._now() - started_at) * 1000
            if isinstance(elapsed_ms, bool) or not isinstance(elapsed_ms, int | float):
                return
            safe_elapsed_ms = max(0, int(round(elapsed_ms)))

            event: dict[str, object] = {
                "event": "agent_latency",
                "component": "ai_worker",
                "stage": stage,
                "outcome": (outcome if outcome in AGENT_LATENCY_OUTCOMES else "failure"),
                "elapsed_ms": safe_elapsed_ms,
                "trace_key": agent_latency_trace_key(run_id),
                "surface": SQL_ERD_SURFACE,
            }
            safe_turn_sequence = _nonnegative_int(turn_sequence)
            if safe_turn_sequence is not None and safe_turn_sequence > 0:
                event["turn_sequence"] = safe_turn_sequence
            if tool_name in SQL_ERD_TOOL_NAMES:
                event["tool_name"] = tool_name
            if retrieval_mode in AGENT_LATENCY_RETRIEVAL_MODES:
                event["retrieval_mode"] = retrieval_mode
            for key, value in (
                ("provider_input_tokens", provider_input_tokens),
                ("provider_output_tokens", provider_output_tokens),
                ("provider_total_tokens", provider_total_tokens),
            ):
                safe_value = _nonnegative_int(value)
                if safe_value is not None:
                    event[key] = safe_value
            if failure_type is not None:
                event["failure_type"] = (
                    failure_type if failure_type in AGENT_LATENCY_FAILURE_TYPES else "unknown"
                )

            self._emit(event)
        except Exception:
            return
