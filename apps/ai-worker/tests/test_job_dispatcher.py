import json

from app.agent_processor import AgentProcessResult
from app.job_dispatcher import JobDispatcher
from app.meeting_report_processor import InfrastructureError, ProcessResult

RUN_ID = "33333333-3333-3333-3333-333333333333"
REPORT_ID = "77777777-7777-7777-7777-777777777777"


class FakeMeetingReportProcessor:
    def __init__(self, result: ProcessResult | None = None, error: Exception | None = None) -> None:
        self.result = result or ProcessResult(
            delete_message=True,
            reason="completed",
            report_id=REPORT_ID,
        )
        self.error = error
        self.payloads: list[dict[str, object]] = []

    def process_payload(self, payload: dict[str, object]) -> ProcessResult:
        self.payloads.append(payload)
        if self.error:
            raise self.error
        return self.result


class FakeAgentRunProcessor:
    def __init__(
        self,
        result: AgentProcessResult | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result or AgentProcessResult(
            delete_message=False,
            reason="agent_planning_not_implemented",
            run_id=RUN_ID,
        )
        self.error = error
        self.payloads: list[dict[str, object]] = []

    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult:
        self.payloads.append(payload)
        if self.error:
            raise self.error
        return self.result


def create_dispatcher(
    meeting_processor: FakeMeetingReportProcessor | None = None,
    agent_processor: FakeAgentRunProcessor | None = None,
) -> JobDispatcher:
    return JobDispatcher(
        meeting_processor or FakeMeetingReportProcessor(),
        agent_processor or FakeAgentRunProcessor(),
    )


def test_dispatcher_routes_meeting_report_jobs() -> None:
    meeting_processor = FakeMeetingReportProcessor()
    agent_processor = FakeAgentRunProcessor()
    dispatcher = create_dispatcher(meeting_processor, agent_processor)

    result = dispatcher.process_message(
        json.dumps(
            {
                "jobType": "meeting_report",
                "reportId": REPORT_ID,
            }
        )
    )

    assert result.delete_message is True
    assert result.reason == "completed"
    assert result.job_type == "meeting_report"
    assert result.resource_id == REPORT_ID
    assert meeting_processor.payloads == [{"jobType": "meeting_report", "reportId": REPORT_ID}]
    assert agent_processor.payloads == []


def test_dispatcher_routes_agent_run_jobs_without_deleting_message() -> None:
    meeting_processor = FakeMeetingReportProcessor()
    agent_processor = FakeAgentRunProcessor()
    dispatcher = create_dispatcher(meeting_processor, agent_processor)

    result = dispatcher.process_message(
        json.dumps(
            {
                "jobType": "agent_run_requested",
                "runId": RUN_ID,
            }
        )
    )

    assert result.delete_message is False
    assert result.reason == "agent_planning_not_implemented"
    assert result.job_type == "agent_run_requested"
    assert result.resource_id == RUN_ID
    assert meeting_processor.payloads == []
    assert agent_processor.payloads == [{"jobType": "agent_run_requested", "runId": RUN_ID}]


def test_dispatcher_deletes_invalid_json_without_processor_calls() -> None:
    meeting_processor = FakeMeetingReportProcessor()
    agent_processor = FakeAgentRunProcessor()
    dispatcher = create_dispatcher(meeting_processor, agent_processor)

    result = dispatcher.process_message("{not json")

    assert result.delete_message is True
    assert result.reason == "invalid_job_json"
    assert result.job_type is None
    assert result.resource_id is None
    assert meeting_processor.payloads == []
    assert agent_processor.payloads == []


def test_dispatcher_deletes_missing_or_unknown_job_type() -> None:
    dispatcher = create_dispatcher()

    missing = dispatcher.process_message(json.dumps({"runId": RUN_ID}))
    unknown = dispatcher.process_message(
        json.dumps(
            {
                "jobType": "kanban_agent",
                "rawPayload": "must-not-leak",
            }
        )
    )

    assert missing.delete_message is True
    assert missing.reason == "invalid_job_type"
    assert missing.job_type is None
    assert missing.resource_id is None
    assert unknown.delete_message is True
    assert unknown.reason == "unsupported_job_type"
    assert unknown.job_type == "kanban_agent"
    assert unknown.resource_id is None


def test_dispatcher_leaves_retryable_processor_failure_for_sqs_retry() -> None:
    dispatcher = create_dispatcher(
        meeting_processor=FakeMeetingReportProcessor(
            error=InfrastructureError("database unavailable")
        )
    )

    result = dispatcher.process_message(json.dumps({"jobType": "meeting_report"}))

    assert result.delete_message is False
    assert result.reason == "infrastructure_failure"
    assert result.job_type == "meeting_report"
    assert result.resource_id is None
