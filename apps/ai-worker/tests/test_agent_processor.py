import json
import sys
from datetime import date
from types import SimpleNamespace

import pytest

from app.agent_processor import (
    AGENT_TOOL_SCHEMA_VERSION,
    AgentPlannerDecision,
    AgentPlanningRequest,
    AgentRunContext,
    AgentRunProcessor,
    OpenAiAgentPlannerClient,
    _agent_planner_schema,
    _agent_planner_system_prompt,
    _agent_planner_user_prompt,
    normalize_agent_planner_decision,
    parse_agent_planner_output,
    parse_agent_run_job_payload,
)
from app.meeting_report_processor import InfrastructureError

RUN_ID = "33333333-3333-3333-3333-333333333333"
USER_VISIBLE_UUID = "12345678-1234-4123-8123-123456789abc"
WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "11111111-1111-1111-1111-111111111111"
SQL_ERD_SESSION_ID = "77777777-7777-4777-8777-777777777777"
PR_REVIEW_SESSION_ID = "88888888-8888-4888-8888-888888888888"
STEP_ID = "44444444-4444-4444-4444-444444444444"
_DEFAULT_CONTEXT = object()


def tool_snapshot(**overrides: object) -> dict[str, object]:
    return {
        "name": "list_calendar_events",
        "description": "Calendar 일정 목록을 날짜 범위 기준으로 조회합니다.",
        "riskLevel": "low",
        "executionMode": "auto",
        "inputSchema": {
            "type": "object",
            "required": ["start", "end"],
            "additionalProperties": False,
            "properties": {
                "start": {"type": "string", "format": "date"},
                "end": {"type": "string", "format": "date"},
            },
        },
        **overrides,
    }


def agent_payload(**overrides: object) -> dict[str, object]:
    return {
        "jobType": "agent_run_requested",
        "runId": RUN_ID,
        "workspaceId": WORKSPACE_ID,
        "requestedByUserId": USER_ID,
        "requestContext": None,
        "toolSchemaVersion": AGENT_TOOL_SCHEMA_VERSION,
        "tools": [tool_snapshot()],
        **overrides,
    }


def run_context(**overrides: object) -> AgentRunContext:
    values = {
        "run_id": RUN_ID,
        "workspace_id": WORKSPACE_ID,
        "requested_by_user_id": USER_ID,
        "status": "planning",
        "prompt": "이번 주 일정 알려줘",
        "timezone": "Asia/Seoul",
        **overrides,
    }
    return AgentRunContext(**values)


def planner_decision(**overrides: object) -> AgentPlannerDecision:
    values = {
        "status": "tool_candidate",
        "message": "Calendar 일정 조회 후보입니다.",
        "final_answer_draft": "일정 조회 계획을 만들었습니다.",
        "tool_name": "list_calendar_events",
        "tool_input": {
            "start": "2026-07-09",
            "end": "2026-07-16",
            "providerRawResponse": "must-not-leak",
        },
        "requires_confirmation": False,
        "missing_fields": (),
        "unsupported_reason": None,
        **overrides,
    }
    return AgentPlannerDecision(**values)


def test_completed_planner_decision_finishes_multi_tool_run() -> None:
    job = parse_agent_run_job_payload(agent_payload())
    normalized = normalize_agent_planner_decision(
        planner_decision(
            status="completed",
            message="요청을 완료했습니다.",
            final_answer_draft="회의 참여 준비를 마쳤습니다.",
            tool_name=None,
            tool_input={},
        ),
        job,
    )

    assert normalized.status == "completed"
    assert normalized.final_answer == "회의 참여 준비를 마쳤습니다."
    assert "unsupportedReason" not in normalized.output_summary


def test_normalized_user_visible_text_redacts_uuid() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[tool_snapshot(executionMode="confirmation_required")],
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(
            message=f"대상 ID는 {USER_VISIBLE_UUID}입니다.",
            final_answer_draft=f"{USER_VISIBLE_UUID} 항목을 확인한 뒤 승인해 주세요.",
        ),
        job,
    )

    assert USER_VISIBLE_UUID not in normalized.message
    assert USER_VISIBLE_UUID not in normalized.final_answer
    assert normalized.output_summary["message"] == normalized.message
    assert normalized.output_summary["finalAnswerDraft"] == normalized.final_answer
    assert "내부 식별자" in normalized.final_answer


def test_normalized_user_visible_text_redacts_uuid_before_length_limit() -> None:
    job = parse_agent_run_job_payload(agent_payload())
    user_visible_text = "가" * 980 + USER_VISIBLE_UUID

    normalized = normalize_agent_planner_decision(
        planner_decision(
            message=user_visible_text,
            final_answer_draft=user_visible_text,
        ),
        job,
    )

    assert USER_VISIBLE_UUID not in normalized.message
    assert USER_VISIBLE_UUID not in normalized.final_answer
    assert normalized.message.endswith("내부 식별자")
    assert normalized.final_answer.endswith("내부 식별자")


def test_planner_prompt_limits_prior_thread_resource_reuse() -> None:
    prompt = _agent_planner_system_prompt()

    assert "previous resource" in prompt
    assert "Never copy, ask for, or invent a raw resource ID" in prompt
    assert "useSelectedMeetingRoomCandidate=true" in prompt
    assert "useSelectedWorkspaceMemberCandidate=true" in prompt


class FakeAgentRunRepository:
    def __init__(
        self,
        context: AgentRunContext | None | object = _DEFAULT_CONTEXT,
        lock: bool = True,
        complete_step_result: bool = True,
        wait_for_user_input_result: bool = True,
        context_error: Exception | None = None,
    ) -> None:
        self.context = run_context() if context is _DEFAULT_CONTEXT else context
        self.lock = lock
        self.complete_step_result = complete_step_result
        self.wait_for_user_input_result = wait_for_user_input_result
        self.context_error = context_error
        self.lock_calls: list[str] = []
        self.release_calls: list[str] = []
        self.failed_updates: list[tuple[str, str, str, str]] = []
        self.started_steps: list[tuple[str, str, int]] = []
        self.completed_steps: list[tuple[str, str, dict[str, object]]] = []
        self.failed_steps: list[tuple[str, str, str, str]] = []
        self.completed_runs: list[tuple[str, str, str, str | None]] = []
        self.tool_execution_ready_updates: list[tuple[str, str, str]] = []
        self.waiting_user_input_updates: list[tuple[str, str]] = []

    def try_acquire_run_lock(self, run_id: str) -> bool:
        self.lock_calls.append(run_id)
        return self.lock

    def release_run_lock(self, run_id: str) -> None:
        self.release_calls.append(run_id)

    def get_run_context(self, _job):
        if self.context_error:
            raise self.context_error
        return self.context

    def start_planner_step(self, job, context) -> str:
        self.started_steps.append((job.run_id, context.timezone, len(job.tools)))
        return STEP_ID

    def complete_planner_step(
        self,
        run_id: str,
        step_id: str,
        output_summary: dict[str, object],
    ) -> bool:
        self.completed_steps.append((run_id, step_id, output_summary))
        return self.complete_step_result

    def fail_planner_step(
        self,
        run_id: str,
        step_id: str,
        error_code: str,
        error_message: str,
    ) -> None:
        self.failed_steps.append((run_id, step_id, error_code, error_message))

    def complete_run(
        self,
        run_id: str,
        final_answer: str,
        message: str,
        risk_level: str | None,
    ) -> None:
        self.completed_runs.append((run_id, final_answer, message, risk_level))

    def mark_tool_execution_ready(
        self,
        run_id: str,
        message: str,
        risk_level: str,
    ) -> None:
        self.tool_execution_ready_updates.append((run_id, message, risk_level))

    def mark_failed(
        self,
        run_id: str,
        error_code: str,
        error_message: str,
        message: str,
    ) -> None:
        self.failed_updates.append((run_id, error_code, error_message, message))

    def wait_for_user_input(self, run_id: str, message: str) -> bool:
        self.waiting_user_input_updates.append((run_id, message))
        return self.wait_for_user_input_result


class FakePlannerClient:
    def __init__(
        self,
        decision: AgentPlannerDecision | None = None,
        error: Exception | None = None,
    ) -> None:
        self.decision = decision or planner_decision()
        self.error = error
        self.requests = []

    def plan(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.decision


class FakeExecutionHandoffClient:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[str] = []

    def execute(self, run_id: str) -> None:
        self.calls.append(run_id)
        if self.error:
            raise self.error


def create_processor(
    repository: FakeAgentRunRepository,
    planner_client: FakePlannerClient | None = None,
    execution_handoff_client: FakeExecutionHandoffClient | None = None,
) -> AgentRunProcessor:
    return AgentRunProcessor(
        repository,
        planner_client or FakePlannerClient(),
        execution_handoff_client or FakeExecutionHandoffClient(),
        current_date_provider=lambda _timezone: date(2026, 7, 9),
    )


def test_parse_agent_run_job_payload_validates_required_ids() -> None:
    job = parse_agent_run_job_payload(agent_payload())

    assert job.run_id == RUN_ID
    assert job.workspace_id == WORKSPACE_ID
    assert job.requested_by_user_id == USER_ID
    assert job.tool_schema_version == AGENT_TOOL_SCHEMA_VERSION
    assert job.request_context is None
    assert job.turn_sequence == 1
    assert job.tools[0].name == "list_calendar_events"

    current_turn = parse_agent_run_job_payload(agent_payload(turnSequence=4))
    assert current_turn.turn_sequence == 4

    for key in ["runId", "workspaceId", "requestedByUserId"]:
        payload = agent_payload(**{key: "not-a-uuid"})
        try:
            parse_agent_run_job_payload(payload)
        except ValueError as error:
            assert key in str(error)
        else:
            raise AssertionError(f"{key} should be validated")

    try:
        parse_agent_run_job_payload(agent_payload(toolSchemaVersion=""))
    except ValueError as error:
        assert "toolSchemaVersion" in str(error)
    else:
        raise AssertionError("toolSchemaVersion should be validated")

    for invalid_turn_sequence in [0, -1, True, 1.5, "2", 2_147_483_648]:
        with pytest.raises(ValueError, match="turnSequence"):
            parse_agent_run_job_payload(agent_payload(turnSequence=invalid_turn_sequence))


def test_parse_agent_run_job_payload_preserves_validated_request_context() -> None:
    request_context = {
        "surface": "sql_erd",
        "sessionId": SQL_ERD_SESSION_ID,
    }
    job = parse_agent_run_job_payload(agent_payload(requestContext=request_context))

    assert job.request_context == request_context

    for invalid_context in [
        {"surface": "board", "sessionId": SQL_ERD_SESSION_ID},
        {"surface": "sql_erd", "sessionId": "not-a-uuid"},
        {"surface": "sql_erd", "sessionId": SQL_ERD_SESSION_ID, "extra": True},
    ]:
        with pytest.raises(ValueError, match="requestContext"):
            parse_agent_run_job_payload(agent_payload(requestContext=invalid_context))


def test_parse_agent_run_job_payload_preserves_pr_review_request_context() -> None:
    request_context = {
        "surface": "pr_review",
        "sessionId": PR_REVIEW_SESSION_ID,
    }

    job = parse_agent_run_job_payload(agent_payload(requestContext=request_context))

    assert job.request_context == request_context


def test_contextual_tool_snapshot_emits_indeterminate_confirmation_metadata() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="contextual_schema_fixture",
                    executionMode="contextual",
                )
            ]
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(tool_name="contextual_schema_fixture"),
        job,
    )

    assert normalized.status == "tool_candidate"
    assert normalized.output_summary["executionMode"] == "contextual"
    assert normalized.output_summary["requiresConfirmation"] is None


def test_processor_completes_planning_run_with_tool_candidate() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient()
    handoff_client = FakeExecutionHandoffClient()
    processor = create_processor(repository, planner_client, handoff_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_execution_handoff_completed"
    assert result.run_id == RUN_ID
    assert repository.lock_calls == [RUN_ID]
    assert repository.release_calls == [RUN_ID]
    assert repository.started_steps == [(RUN_ID, "Asia/Seoul", 1)]
    assert repository.completed_steps[0][0:2] == (RUN_ID, STEP_ID)
    output_summary = repository.completed_steps[0][2]
    assert output_summary["status"] == "tool_candidate"
    assert output_summary["toolName"] == "list_calendar_events"
    assert output_summary["toolInputValidation"] == "app_server_required"
    assert output_summary["input"] == {
        "start": "2026-07-09",
        "end": "2026-07-16",
    }
    assert repository.completed_runs == []
    assert repository.tool_execution_ready_updates == [
        (
            RUN_ID,
            "Calendar 일정 조회 후보입니다.",
            "low",
        )
    ]
    assert repository.failed_updates == []
    assert handoff_client.calls == [RUN_ID]
    assert planner_client.requests[0].current_date == "2026-07-09"
    assert planner_client.requests[0].timezone == "Asia/Seoul"


def test_processor_forwards_only_pr_review_surface_to_planner() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient(
        decision=planner_decision(
            tool_name="recommend_pr_review_focus",
            tool_input={},
            requires_confirmation=False,
        )
    )
    processor = create_processor(repository, planner_client)

    result = processor.process_payload(
        agent_payload(
            requestContext={
                "surface": "pr_review",
                "sessionId": PR_REVIEW_SESSION_ID,
            },
            tools=[
                tool_snapshot(
                    name="recommend_pr_review_focus",
                    executionMode="contextual",
                    inputSchema={"type": "object"},
                )
            ],
        )
    )

    request = planner_client.requests[0]
    planner_prompt = _agent_planner_user_prompt(request)

    assert result.reason == "agent_execution_handoff_completed"
    assert request.context_surface == "pr_review"
    assert json.loads(planner_prompt)["contextSurface"] == "pr_review"
    assert PR_REVIEW_SESSION_ID not in planner_prompt


def test_processor_stops_when_planner_step_completion_loses_claim() -> None:
    repository = FakeAgentRunRepository(complete_step_result=False)
    handoff_client = FakeExecutionHandoffClient()
    processor = create_processor(repository, execution_handoff_client=handoff_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_planner_step_no_longer_running"
    assert repository.tool_execution_ready_updates == []
    assert repository.completed_runs == []
    assert handoff_client.calls == []


def test_processor_uses_run_timezone_for_current_date() -> None:
    repository = FakeAgentRunRepository(context=run_context(timezone="America/Los_Angeles"))
    planner_client = FakePlannerClient()
    seen_timezones: list[str] = []
    processor = AgentRunProcessor(
        repository,
        planner_client,
        FakeExecutionHandoffClient(),
        current_date_provider=lambda timezone: (
            seen_timezones.append(timezone) or date(2026, 7, 8)
        ),
    )

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_execution_handoff_completed"
    assert seen_timezones == ["America/Los_Angeles"]
    assert planner_client.requests[0].current_date == "2026-07-08"
    assert planner_client.requests[0].timezone == "America/Los_Angeles"


def test_processor_repairs_relative_date_before_execution_handoff() -> None:
    repository = FakeAgentRunRepository(context=run_context(prompt="이번 주말 일정 보여줘"))
    planner_client = FakePlannerClient(
        decision=planner_decision(
            status="needs_clarification",
            tool_name=None,
            tool_input={},
            missing_fields=("start", "end"),
        )
    )
    handoff_client = FakeExecutionHandoffClient()
    processor = AgentRunProcessor(
        repository,
        planner_client,
        handoff_client,
        current_date_provider=lambda _timezone: date(2026, 7, 12),
    )

    result = processor.process_payload(agent_payload())

    assert result.reason == "agent_execution_handoff_completed"
    assert repository.completed_steps[0][2]["input"] == {
        "start": "2026-07-18",
        "end": "2026-07-19",
    }
    assert handoff_client.calls == [RUN_ID]


def test_processor_deletes_invalid_agent_payload_without_repository_calls() -> None:
    repository = FakeAgentRunRepository()
    processor = create_processor(repository)

    result = processor.process_payload(agent_payload(runId="not-a-uuid"))

    assert result.delete_message is True
    assert result.reason == "invalid_agent_job"
    assert result.run_id is None
    assert repository.lock_calls == []
    assert repository.release_calls == []


def test_processor_deletes_missing_or_terminal_runs() -> None:
    missing_repository = FakeAgentRunRepository(context=None)
    terminal_repository = FakeAgentRunRepository(context=run_context(status="completed"))

    missing = create_processor(missing_repository).process_payload(agent_payload())
    terminal = create_processor(terminal_repository).process_payload(agent_payload())

    assert missing.delete_message is True
    assert missing.reason == "agent_run_not_found"
    assert terminal.delete_message is True
    assert terminal.reason == "terminal_agent_run"
    assert missing_repository.release_calls == [RUN_ID]
    assert terminal_repository.release_calls == [RUN_ID]


def test_processor_deletes_waiting_confirmation_and_retries_running_handoff() -> None:
    waiting_repository = FakeAgentRunRepository(context=run_context(status="waiting_confirmation"))
    running_repository = FakeAgentRunRepository(context=run_context(status="running"))
    handoff_client = FakeExecutionHandoffClient()

    waiting = create_processor(waiting_repository).process_payload(agent_payload())
    running = create_processor(
        running_repository,
        execution_handoff_client=handoff_client,
    ).process_payload(agent_payload())

    assert waiting.delete_message is True
    assert waiting.reason == "agent_run_waiting_confirmation"
    assert running.delete_message is True
    assert running.reason == "agent_execution_handoff_retried"
    assert handoff_client.calls == [RUN_ID]


def test_processor_retries_handoff_without_replanning_after_failure() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient()
    handoff_client = FakeExecutionHandoffClient(error=InfrastructureError("App Server unavailable"))
    processor = create_processor(repository, planner_client, handoff_client)

    first = processor.process_payload(agent_payload())

    assert first.delete_message is False
    assert first.reason == "agent_execution_handoff_unavailable"
    assert planner_client.requests
    assert handoff_client.calls == [RUN_ID]

    repository.context = run_context(status="running")
    handoff_client.error = None
    second = processor.process_payload(agent_payload())

    assert second.delete_message is True
    assert second.reason == "agent_execution_handoff_retried"
    assert len(planner_client.requests) == 1
    assert handoff_client.calls == [RUN_ID, RUN_ID]


def test_processor_leaves_duplicate_or_infrastructure_failure_for_retry() -> None:
    duplicate_repository = FakeAgentRunRepository(lock=False)
    error_repository = FakeAgentRunRepository(
        context_error=InfrastructureError("database unavailable")
    )

    duplicate = create_processor(duplicate_repository).process_payload(agent_payload())
    error = create_processor(error_repository).process_payload(agent_payload())

    assert duplicate.delete_message is False
    assert duplicate.reason == "agent_run_duplicate_in_progress"
    assert duplicate_repository.release_calls == []
    assert error.delete_message is False
    assert error.reason == "infrastructure_failure"
    assert error.run_id == RUN_ID
    assert error_repository.release_calls == [RUN_ID]


def test_processor_completes_unregistered_tool_as_unsupported() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient(
        decision=planner_decision(
            tool_name="search_board_issues",
            final_answer_draft="Board 도구는 아직 사용할 수 없습니다.",
        )
    )
    processor = create_processor(repository, planner_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_planning_completed"
    output_summary = repository.completed_steps[0][2]
    assert output_summary["status"] == "unsupported"
    assert output_summary["unsupportedReason"] == "unknown_intent"
    assert repository.completed_runs[0] == (
        RUN_ID,
        "현재 사용할 수 없는 Agent 도구가 필요한 요청입니다.",
        "지원하지 않는 Agent 도구 요청입니다.",
        None,
    )


def test_processor_waits_for_user_input_when_required_fields_are_missing() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient(
        decision=planner_decision(
            status="needs_clarification",
            message="일정 생성을 위해 시간이 필요합니다.",
            final_answer_draft="몇 시에 일정을 만들까요?",
            tool_name=None,
            tool_input={},
            missing_fields=("calendar_event_time",),
        )
    )
    processor = create_processor(repository, planner_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_waiting_user_input"
    output_summary = repository.completed_steps[0][2]
    assert output_summary["status"] == "needs_clarification"
    assert output_summary["missingFields"] == ["calendar_event_time"]
    assert repository.completed_runs == []
    assert repository.waiting_user_input_updates == [
        (
            RUN_ID,
            "몇 시에 일정을 만들까요?",
        )
    ]


def test_processor_does_not_append_clarification_after_run_leaves_planning() -> None:
    repository = FakeAgentRunRepository(wait_for_user_input_result=False)
    planner_client = FakePlannerClient(
        decision=planner_decision(
            status="needs_clarification",
            message="일정 생성을 위해 시간이 필요합니다.",
            final_answer_draft="몇 시에 일정을 만들까요?",
            tool_name=None,
            tool_input={},
            missing_fields=("calendar_event_time",),
        )
    )

    result = create_processor(repository, planner_client).process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_run_no_longer_planning"
    assert repository.completed_runs == []
    assert repository.waiting_user_input_updates == [
        (
            RUN_ID,
            "몇 시에 일정을 만들까요?",
        )
    ]


def test_processor_waits_for_user_input_at_planner_turn_limit() -> None:
    repository = FakeAgentRunRepository(context=run_context(planner_turn_count=5))

    result = create_processor(repository).process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_planner_turn_limit_reached"
    assert repository.started_steps == []
    assert repository.waiting_user_input_updates == [
        (
            RUN_ID,
            "한 요청에서 계획할 수 있는 작업은 최대 5회입니다. "
            "다음 요청에서 계속 진행할 내용을 알려주세요.",
        )
    ]


def test_normalizer_blocks_calendar_update_without_event_id() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="update_calendar_event",
                    description="Calendar 일정 수정",
                    riskLevel="medium",
                    executionMode="confirmation_required",
                    inputSchema={
                        "type": "object",
                        "required": ["eventId", "changes"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="update_calendar_event",
            tool_input={"changes": {"startTime": "16:00"}},
            requires_confirmation=True,
        ),
        job,
    )

    assert normalized.status == "needs_clarification"
    assert normalized.risk_level is None
    assert normalized.output_summary["missingFields"] == ["eventId"]
    assert "수정할 일정" in normalized.final_answer


def test_normalizer_asks_for_calendar_time_when_end_time_is_not_after_start_time() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="create_calendar_event",
                    description="Calendar 일정 생성",
                    riskLevel="medium",
                    executionMode="confirmation_required",
                    inputSchema={
                        "type": "object",
                        "required": ["title", "startDate", "endDate"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="create_calendar_event",
            tool_input={
                "title": "가족 일정",
                "startDate": "2026-07-12",
                "endDate": "2026-07-12",
                "startTime": "19:00",
                "endTime": "19:00",
            },
            requires_confirmation=True,
        ),
        job,
    )

    assert normalized.status == "needs_clarification"
    assert normalized.risk_level is None
    assert normalized.output_summary["missingFields"] == ["calendar_event_end_time"]
    assert "종료 시각" in normalized.final_answer


def test_normalizer_blocks_calendar_recurrence_request() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="create_calendar_event",
                    description="Calendar 일정 생성",
                    riskLevel="medium",
                    executionMode="confirmation_required",
                    inputSchema={
                        "type": "object",
                        "required": ["title", "startDate", "endDate"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )

    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="create_calendar_event",
            tool_input={
                "title": "스탠드업",
                "startDate": "2026-07-13",
                "endDate": "2026-07-13",
                "startTime": "10:00",
            },
            requires_confirmation=True,
        ),
        job,
        prompt="다음 주 평일마다 오전 10시에 스탠드업 일정 만들어줘",
    )

    assert normalized.status == "unsupported"
    assert normalized.risk_level is None
    assert normalized.output_summary["unsupportedReason"] == "calendar_recurrence_unsupported"
    assert "반복 일정" in normalized.final_answer


def test_normalizer_requires_time_or_all_day_for_multi_day_calendar_create() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="create_calendar_event",
                    description="Calendar 일정 생성",
                    riskLevel="medium",
                    executionMode="confirmation_required",
                    inputSchema={
                        "type": "object",
                        "required": ["title", "startDate", "endDate"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )

    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="create_calendar_event",
            tool_input={
                "title": "제주 워크숍",
                "startDate": "2026-07-20",
                "endDate": "2026-07-22",
            },
            requires_confirmation=True,
        ),
        job,
    )

    assert normalized.status == "needs_clarification"
    assert normalized.risk_level is None
    assert normalized.output_summary["missingFields"] == ["calendar_event_time_or_all_day"]
    assert "종일 여부 또는 시작 시각" in normalized.final_answer


def test_normalizer_keeps_explicit_all_day_multi_day_calendar_create() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="create_calendar_event",
                    description="Calendar 일정 생성",
                    riskLevel="medium",
                    executionMode="confirmation_required",
                    inputSchema={
                        "type": "object",
                        "required": ["title", "startDate", "endDate"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )

    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="create_calendar_event",
            tool_input={
                "title": "제주 워크숍",
                "startDate": "2026-07-20",
                "endDate": "2026-07-22",
                "isAllDay": True,
            },
            requires_confirmation=True,
        ),
        job,
    )

    assert normalized.status == "tool_candidate"
    assert normalized.risk_level == "medium"
    assert normalized.output_summary["input"] == {
        "title": "제주 워크숍",
        "startDate": "2026-07-20",
        "endDate": "2026-07-22",
        "isAllDay": True,
    }


def test_normalizer_blocks_meeting_detail_without_report_id() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="summarize_meeting_report",
                    description="MeetingReport 요약",
                    inputSchema={
                        "type": "object",
                        "required": ["reportId"],
                        "additionalProperties": False,
                        "properties": {},
                    },
                )
            ]
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="summarize_meeting_report",
            tool_input={},
        ),
        job,
    )

    assert normalized.status == "unsupported"
    assert normalized.risk_level is None
    assert normalized.output_summary["unsupportedReason"] == "meeting_report_id_required"


def test_normalizer_keeps_latest_meeting_report_list_candidate() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="list_meeting_reports",
                    description="최신 MeetingReport 목록 조회",
                    inputSchema={
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100}},
                    },
                )
            ]
        )
    )
    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="list_meeting_reports",
            tool_input={"limit": 1},
        ),
        job,
    )

    assert normalized.status == "tool_candidate"
    assert normalized.output_summary["input"] == {"limit": 1}


@pytest.mark.parametrize(
    ("prompt", "current_date", "decision", "expected_input"),
    [
        (
            "이번 주말 일정 보여줘",
            "2026-07-12",
            planner_decision(
                status="needs_clarification",
                tool_name=None,
                tool_input={},
                missing_fields=("start", "end"),
            ),
            {"start": "2026-07-18", "end": "2026-07-19"},
        ),
        (
            "이번 주말 일정 보여줘",
            "2026-07-11",
            planner_decision(
                status="needs_clarification",
                tool_name=None,
                tool_input={},
                missing_fields=("start", "end"),
            ),
            {"start": "2026-07-11", "end": "2026-07-12"},
        ),
        (
            "다음 주 월요일 오전 일정 보여줘",
            "2026-07-12",
            planner_decision(tool_input={"start": "2026-07-20", "end": "2026-07-20"}),
            {"start": "2026-07-13", "end": "2026-07-13"},
        ),
        (
            "다다음 주 화요일 일정 보여줘",
            "2026-07-12",
            planner_decision(tool_input={"start": "2026-07-28", "end": "2026-07-28"}),
            {"start": "2026-07-21", "end": "2026-07-21"},
        ),
    ],
)
def test_normalizer_repairs_supported_calendar_relative_date_queries(
    prompt: str,
    current_date: str,
    decision: AgentPlannerDecision,
    expected_input: dict[str, str],
) -> None:
    normalized = normalize_agent_planner_decision(
        decision,
        parse_agent_run_job_payload(agent_payload()),
        prompt=prompt,
        current_date=current_date,
    )

    assert normalized.status == "tool_candidate"
    assert normalized.risk_level == "low"
    assert normalized.output_summary["toolName"] == "list_calendar_events"
    assert normalized.output_summary["requiresConfirmation"] is False
    assert normalized.output_summary["input"] == expected_input


@pytest.mark.parametrize(
    "prompt",
    [
        "이번 주말 디자인 관련 일정 보여줘",
        "다음 주 월요일 일정 만들어줘",
    ],
)
def test_normalizer_does_not_expand_relative_date_guard_beyond_plain_read_queries(
    prompt: str,
) -> None:
    normalized = normalize_agent_planner_decision(
        planner_decision(
            status="unsupported",
            tool_name=None,
            tool_input={},
            unsupported_reason="unsupported_filter_or_write",
        ),
        parse_agent_run_job_payload(agent_payload()),
        prompt=prompt,
        current_date="2026-07-12",
    )

    assert normalized.status == "unsupported"
    assert normalized.output_summary["unsupportedReason"] == "unsupported_filter_or_write"


def test_planner_prompt_preserves_calendar_tool_boundaries() -> None:
    prompt = _agent_planner_system_prompt()

    assert "title, keyword, participant, or current-time filters" in prompt
    assert "Calendar recurrence is not supported" in prompt
    assert "require an explicit all-day choice" in prompt
    assert "never set endTime equal to startTime" in prompt
    assert "positive integer Calendar event ID" in prompt
    assert "이번 주말" in prompt
    assert "다음 주 월요일" in prompt
    assert "다다음 주 화요일" in prompt
    assert "Korean" in prompt


def test_planner_prompt_allows_only_registered_safe_board_assignment() -> None:
    prompt = _agent_planner_system_prompt()

    assert "assign_board_issue_safely" in prompt
    assert "label, milestone, or due date changes" in prompt
    assert "label, assignee, milestone" not in prompt


def test_planner_prompt_uses_server_board_issue_defaults() -> None:
    prompt = _agent_planner_system_prompt()

    assert "omit boardName and repositoryFullName" in prompt
    assert "omit columnName so the App Server uses Unmapped" in prompt
    assert "do not ask the user for those defaults" in prompt


def test_planner_prompt_knows_pr_review_contextual_tool_contract() -> None:
    prompt = _agent_planner_system_prompt()

    assert "contextSurface is pr_review" in prompt
    assert "recommend_pr_review_focus" in prompt
    assert "never request or invent either identifier" in prompt


def test_processor_marks_planning_failed_for_invalid_planner_output() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient(decision=planner_decision(status="bad_status"))
    processor = create_processor(repository, planner_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is True
    assert result.reason == "agent_planning_failed"
    assert repository.failed_steps == [
        (
            RUN_ID,
            STEP_ID,
            "AGENT_PLANNER_FAILED",
            "Agent planner returned an invalid status",
        )
    ]
    assert repository.failed_updates == [
        (
            RUN_ID,
            "AGENT_PLANNER_FAILED",
            "Agent planner returned an invalid status",
            "요청을 분석하지 못했습니다. 다시 시도해주세요.",
        )
    ]


def test_processor_retries_planner_infrastructure_failure() -> None:
    repository = FakeAgentRunRepository()
    planner_client = FakePlannerClient(error=InfrastructureError("OpenAI unavailable"))
    processor = create_processor(repository, planner_client)

    result = processor.process_payload(agent_payload())

    assert result.delete_message is False
    assert result.reason == "infrastructure_failure"
    assert repository.release_calls == [RUN_ID]


def test_openai_agent_planner_uses_timeout_and_retries_timeout_failure(monkeypatch) -> None:
    class FakeTimeoutError(Exception):
        pass

    class FakeResponses:
        def create(self, **_kwargs):
            raise FakeTimeoutError("timed out")

    class FakeOpenAI:
        initialized_with: tuple[str, float] | None = None

        def __init__(self, *, api_key: str, timeout: float) -> None:
            FakeOpenAI.initialized_with = (api_key, timeout)
            self.responses = FakeResponses()

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(
            OpenAI=FakeOpenAI,
            APIConnectionError=FakeTimeoutError,
            APITimeoutError=FakeTimeoutError,
            InternalServerError=FakeTimeoutError,
            RateLimitError=FakeTimeoutError,
        ),
    )
    client = OpenAiAgentPlannerClient("test-key", "gpt-test", 45)

    with pytest.raises(InfrastructureError, match="retryable failure"):
        client.plan(
            AgentPlanningRequest(
                run_id=RUN_ID,
                prompt="이번 주 일정 알려줘",
                timezone="Asia/Seoul",
                current_date="2026-07-12",
                tool_schema_version=AGENT_TOOL_SCHEMA_VERSION,
                tools=(),
            )
        )

    assert FakeOpenAI.initialized_with == ("test-key", 45)


def test_parse_agent_planner_output_sanitizes_sensitive_fields() -> None:
    decision = parse_agent_planner_output(
        json.dumps(
            {
                "status": "tool_candidate",
                "message": "Calendar 일정 조회 후보입니다.",
                "finalAnswerDraft": "일정 조회 계획을 만들었습니다.",
                "toolName": "list_calendar_events",
                "inputJson": json.dumps(
                    {
                        "start": "2026-07-09",
                        "end": "2026-07-16",
                        "token": "must-not-leak",
                        "nested": {
                            "providerRawResponse": "must-not-leak",
                            "visible": "ok",
                        },
                    }
                ),
                "requiresConfirmation": False,
                "missingFields": [],
                "unsupportedReason": None,
            }
        )
    )

    assert decision.tool_input == {
        "start": "2026-07-09",
        "end": "2026-07-16",
        "nested": {
            "visible": "ok",
        },
    }


def test_parse_agent_planner_output_rejects_invalid_input_json() -> None:
    try:
        parse_agent_planner_output(
            json.dumps(
                {
                    "status": "tool_candidate",
                    "message": "Calendar 일정 조회 후보입니다.",
                    "finalAnswerDraft": "일정 조회 계획을 만들었습니다.",
                    "toolName": "list_calendar_events",
                    "inputJson": "{not-json",
                    "requiresConfirmation": False,
                    "missingFields": [],
                    "unsupportedReason": None,
                }
            )
        )
    except Exception as error:
        assert "inputJson must be valid JSON" in str(error)
    else:
        raise AssertionError("invalid inputJson should be rejected")


def test_agent_planner_schema_is_strict_closed_schema() -> None:
    def assert_closed_objects(schema: object) -> None:
        if isinstance(schema, dict):
            if schema.get("type") == "object":
                assert schema.get("additionalProperties") is False
            for value in schema.values():
                assert_closed_objects(value)
        elif isinstance(schema, list):
            for value in schema:
                assert_closed_objects(value)

    assert_closed_objects(_agent_planner_schema())


def test_sql_erd_planner_contract_uses_structured_schema_without_raw_ddl() -> None:
    prompt = _agent_planner_system_prompt()

    assert "generate_sql_erd" in prompt
    assert "SqlErdSchemaSpecV1" in prompt
    assert "raw DDL" in prompt
    assert "unsupportedFeatures" in prompt
    assert "database execution" in prompt
    assert "targetMode" in prompt
    assert "action=replaced" in prompt
    assert "existing session title" in prompt
    assert "successful schema replacement" in prompt


def test_sql_erd_table_focus_planner_contract_inspects_before_focusing() -> None:
    prompt = _agent_planner_system_prompt()

    assert "inspect_sql_erd_schema" in prompt
    assert "focus_sql_erd_tables" in prompt
    assert "compact table refs" in prompt
    assert "direct FK neighbors" in prompt
    assert "Never invent SQLtoERD session IDs" in prompt
    assert "candidates include selectionToken" in prompt
    assert "copy the exact selected selectionToken into sessionSelectionToken" in prompt
    assert "completed inspect_sql_erd_schema result" in prompt
    assert "sessionRevision" in prompt
    assert "primaryTableRefs" in prompt
    assert "relatedTableRefs" in prompt


def test_sql_erd_nullable_requested_dialect_is_not_missing() -> None:
    schema_spec = {
        "version": 1,
        "title": "주문 관리",
        "requestedDialect": None,
        "tables": [{"key": "users"}],
        "relations": [],
        "unsupportedFeatures": [],
    }
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="generate_sql_erd",
                    description="구조화 스키마로 ERD를 생성합니다.",
                    riskLevel="medium",
                    executionMode="contextual",
                    inputSchema={
                        "type": "object",
                        "required": [
                            "version",
                            "title",
                            "requestedDialect",
                            "tables",
                            "relations",
                            "unsupportedFeatures",
                        ],
                        "additionalProperties": False,
                        "properties": {
                            "version": {"const": 1},
                            "title": {"type": "string"},
                            "requestedDialect": {"type": ["string", "null"]},
                            "tables": {"type": "array"},
                            "relations": {"type": "array"},
                            "unsupportedFeatures": {"type": "array"},
                        },
                    },
                )
            ]
        )
    )

    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="generate_sql_erd",
            tool_input=schema_spec,
        ),
        job,
    )

    assert normalized.status == "tool_candidate"
    assert normalized.output_summary["requiresConfirmation"] is None
    assert normalized.output_summary["input"] == schema_spec


def test_sql_erd_missing_schema_root_requests_clarification() -> None:
    job = parse_agent_run_job_payload(
        agent_payload(
            tools=[
                tool_snapshot(
                    name="generate_sql_erd",
                    description="구조화 스키마로 ERD를 생성합니다.",
                    riskLevel="medium",
                    executionMode="contextual",
                    inputSchema={
                        "type": "object",
                        "required": [
                            "version",
                            "title",
                            "requestedDialect",
                            "tables",
                            "relations",
                            "unsupportedFeatures",
                        ],
                        "additionalProperties": False,
                        "properties": {"requestedDialect": {"type": ["string", "null"]}},
                    },
                )
            ]
        )
    )

    normalized = normalize_agent_planner_decision(
        planner_decision(
            tool_name="generate_sql_erd",
            tool_input={"requestedDialect": None},
        ),
        job,
    )

    assert normalized.status == "needs_clarification"
    assert normalized.output_summary["missingFields"] == [
        "version",
        "title",
        "tables",
        "relations",
        "unsupportedFeatures",
    ]
    assert normalized.final_answer == (
        "ERD에 포함할 핵심 테이블과 각 테이블의 주요 데이터 관계를 알려주세요."
    )
    assert "version" not in normalized.final_answer
    assert "unsupportedFeatures" not in normalized.final_answer


def test_completed_sql_erd_replacement_uses_deterministic_success_answer() -> None:
    normalized = normalize_agent_planner_decision(
        planner_decision(
            status="completed",
            final_answer_draft=("이전 햄버거 ERD 결과와 학교 ERD 요청이 일치하지 않습니다."),
        ),
        parse_agent_run_job_payload(agent_payload()),
        planning_context=(
            'tool generate_sql_erd: {"action": "replaced", ' '"title": "햄버거 가게 주문 관리 ERD"}'
        ),
    )

    assert normalized.status == "completed"
    assert normalized.final_answer == "현재 SQLtoERD 세션의 스키마를 교체했습니다."
    assert normalized.output_summary["finalAnswerDraft"] == normalized.final_answer
