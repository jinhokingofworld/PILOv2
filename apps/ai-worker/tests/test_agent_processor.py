from app.agent_processor import (
    AgentRunContext,
    AgentRunProcessor,
    parse_agent_run_job_payload,
)
from app.meeting_report_processor import InfrastructureError

RUN_ID = "33333333-3333-3333-3333-333333333333"
WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "11111111-1111-1111-1111-111111111111"
_DEFAULT_CONTEXT = object()


def agent_payload(**overrides: object) -> dict[str, object]:
    return {
        "jobType": "agent_run_requested",
        "runId": RUN_ID,
        "workspaceId": WORKSPACE_ID,
        "requestedByUserId": USER_ID,
        **overrides,
    }


def run_context(**overrides: object) -> AgentRunContext:
    values = {
        "run_id": RUN_ID,
        "workspace_id": WORKSPACE_ID,
        "requested_by_user_id": USER_ID,
        "status": "planning",
        **overrides,
    }
    return AgentRunContext(**values)


class FakeAgentRunRepository:
    def __init__(
        self,
        context: AgentRunContext | None | object = _DEFAULT_CONTEXT,
        lock: bool = True,
        context_error: Exception | None = None,
    ) -> None:
        self.context = run_context() if context is _DEFAULT_CONTEXT else context
        self.lock = lock
        self.context_error = context_error
        self.lock_calls: list[str] = []
        self.release_calls: list[str] = []
        self.failed_updates: list[tuple[str, str, str, str]] = []

    def try_acquire_run_lock(self, run_id: str) -> bool:
        self.lock_calls.append(run_id)
        return self.lock

    def release_run_lock(self, run_id: str) -> None:
        self.release_calls.append(run_id)

    def get_run_context(self, _job):
        if self.context_error:
            raise self.context_error
        return self.context

    def mark_failed(
        self,
        run_id: str,
        error_code: str,
        error_message: str,
        message: str,
    ) -> None:
        self.failed_updates.append((run_id, error_code, error_message, message))


def test_parse_agent_run_job_payload_validates_required_ids() -> None:
    job = parse_agent_run_job_payload(agent_payload())

    assert job.run_id == RUN_ID
    assert job.workspace_id == WORKSPACE_ID
    assert job.requested_by_user_id == USER_ID

    for key in ["runId", "workspaceId", "requestedByUserId"]:
        payload = agent_payload(**{key: "not-a-uuid"})
        try:
            parse_agent_run_job_payload(payload)
        except ValueError as error:
            assert key in str(error)
        else:
            raise AssertionError(f"{key} should be validated")


def test_processor_leaves_planning_run_for_next_agent_phase() -> None:
    repository = FakeAgentRunRepository()
    processor = AgentRunProcessor(repository)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is False
    assert result.reason == "agent_planning_not_implemented"
    assert result.run_id == RUN_ID
    assert repository.lock_calls == [RUN_ID]
    assert repository.release_calls == [RUN_ID]
    assert repository.failed_updates == []


def test_processor_deletes_invalid_agent_payload_without_repository_calls() -> None:
    repository = FakeAgentRunRepository()
    processor = AgentRunProcessor(repository)

    result = processor.process_payload(agent_payload(runId="not-a-uuid"))

    assert result.delete_message is True
    assert result.reason == "invalid_agent_job"
    assert result.run_id is None
    assert repository.lock_calls == []
    assert repository.release_calls == []


def test_processor_deletes_missing_or_terminal_runs() -> None:
    missing_repository = FakeAgentRunRepository(context=None)
    terminal_repository = FakeAgentRunRepository(context=run_context(status="completed"))

    missing = AgentRunProcessor(missing_repository).process_payload(agent_payload())
    terminal = AgentRunProcessor(terminal_repository).process_payload(agent_payload())

    assert missing.delete_message is True
    assert missing.reason == "agent_run_not_found"
    assert terminal.delete_message is True
    assert terminal.reason == "terminal_agent_run"
    assert missing_repository.release_calls == [RUN_ID]
    assert terminal_repository.release_calls == [RUN_ID]


def test_processor_deletes_waiting_confirmation_and_unsupported_status() -> None:
    waiting_repository = FakeAgentRunRepository(context=run_context(status="waiting_confirmation"))
    running_repository = FakeAgentRunRepository(context=run_context(status="running"))

    waiting = AgentRunProcessor(waiting_repository).process_payload(agent_payload())
    running = AgentRunProcessor(running_repository).process_payload(agent_payload())

    assert waiting.delete_message is True
    assert waiting.reason == "agent_run_waiting_confirmation"
    assert running.delete_message is True
    assert running.reason == "agent_run_unsupported_status"


def test_processor_leaves_duplicate_or_infrastructure_failure_for_retry() -> None:
    duplicate_repository = FakeAgentRunRepository(lock=False)
    error_repository = FakeAgentRunRepository(
        context_error=InfrastructureError("database unavailable")
    )

    duplicate = AgentRunProcessor(duplicate_repository).process_payload(agent_payload())
    error = AgentRunProcessor(error_repository).process_payload(agent_payload())

    assert duplicate.delete_message is False
    assert duplicate.reason == "agent_run_duplicate_in_progress"
    assert duplicate_repository.release_calls == []
    assert error.delete_message is False
    assert error.reason == "infrastructure_failure"
    assert error.run_id == RUN_ID
    assert error_repository.release_calls == [RUN_ID]
