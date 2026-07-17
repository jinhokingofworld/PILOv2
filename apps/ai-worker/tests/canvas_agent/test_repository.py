from __future__ import annotations

from app.canvas_agent.repository import (
    CODE_GENERATION_FAILURE_MESSAGE,
    GENERIC_FAILURE_MESSAGE,
    PgCanvasAgentRepository,
)


class FakeCursor:
    rowcount = 1


class FakeConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, parameters: tuple[object, ...]) -> FakeCursor:
        self.calls.append((query, parameters))
        return FakeCursor()


def repository() -> tuple[PgCanvasAgentRepository, FakeConnection]:
    connection = FakeConnection()
    result = object.__new__(PgCanvasAgentRepository)
    result.connection = connection
    return result, connection


def test_mark_failed_does_not_infer_design_failure_from_prompt() -> None:
    canvas_repository, connection = repository()

    canvas_repository.mark_failed("run-1", "intent classifier failed")

    query, parameters = connection.calls[-1]
    assert "prompt ~*" not in query
    assert parameters == (
        "intent classifier failed",
        GENERIC_FAILURE_MESSAGE,
        GENERIC_FAILURE_MESSAGE,
        "run-1",
    )


def test_mark_failed_preserves_explicit_code_generation_failure() -> None:
    canvas_repository, connection = repository()

    canvas_repository.mark_failed("run-1", CODE_GENERATION_FAILURE_MESSAGE)

    _, parameters = connection.calls[-1]
    assert parameters[1:3] == (
        CODE_GENERATION_FAILURE_MESSAGE,
        CODE_GENERATION_FAILURE_MESSAGE,
    )


def test_retry_exhaustion_uses_generic_failure_message() -> None:
    canvas_repository, connection = repository()
    canvas_repository.try_acquire_run_lock = lambda _run_id: True
    canvas_repository.release_run_lock = lambda _run_id: None

    assert canvas_repository.fail_planning_after_retry_exhaustion("run-1") is True

    query, parameters = connection.calls[-1]
    assert "prompt ~*" not in query
    assert parameters == (
        GENERIC_FAILURE_MESSAGE,
        GENERIC_FAILURE_MESSAGE,
        "run-1",
    )
