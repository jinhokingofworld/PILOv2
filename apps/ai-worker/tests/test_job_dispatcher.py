import json

from app.agent_processor import AgentProcessResult
from app.job_dispatcher import JobDispatcher
from app.meeting_report_processor import InfrastructureError, ProcessResult
from app.pr_review_analysis_processor import PrReviewAnalysisProcessResult

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
            delete_message=True,
            reason="agent_planning_completed",
            run_id=RUN_ID,
        )
        self.error = error
        self.payloads: list[dict[str, object]] = []

    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult:
        self.payloads.append(payload)
        if self.error:
            raise self.error
        return self.result


class FakePrReviewAnalysisProcessor:
    def __init__(self) -> None:
        self.payloads: list[dict[str, object]] = []

    def process_payload(self, payload: dict[str, object]) -> PrReviewAnalysisProcessResult:
        self.payloads.append(payload)
        return PrReviewAnalysisProcessResult(
            delete_message=True,
            reason="pr_review_analysis_completed",
            job_id="88888888-8888-8888-8888-888888888888",
        )


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


def test_dispatcher_keeps_meeting_report_when_processor_is_unavailable() -> None:
    result = JobDispatcher().process_message(
        json.dumps(
            {
                "jobType": "meeting_report",
                "reportId": REPORT_ID,
            }
        )
    )

    assert result.delete_message is False
    assert result.reason == "meeting_report_processor_unavailable"
    assert result.job_type == "meeting_report"


def test_dispatcher_routes_agent_run_jobs() -> None:
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

    assert result.delete_message is True
    assert result.reason == "agent_planning_completed"
    assert result.job_type == "agent_run_requested"
    assert result.resource_id == RUN_ID
    assert meeting_processor.payloads == []
    assert agent_processor.payloads == [{"jobType": "agent_run_requested", "runId": RUN_ID}]


def test_dispatcher_keeps_agent_job_when_processor_is_unavailable() -> None:
    result = JobDispatcher().process_message(
        json.dumps({"jobType": "agent_run_requested", "runId": RUN_ID})
    )

    assert result.delete_message is False
    assert result.reason == "agent_run_processor_unavailable"


def test_dispatcher_keeps_canvas_job_when_processor_is_unavailable() -> None:
    result = JobDispatcher().process_message(
        json.dumps({"jobType": "canvas_agent_step_requested", "runId": RUN_ID})
    )

    assert result.delete_message is False
    assert result.reason == "canvas_agent_processor_unavailable"


def test_dispatcher_keeps_pr_review_job_when_processor_is_unavailable() -> None:
    result = JobDispatcher().process_message(
        json.dumps({"jobType": "pr_review_analysis_requested"})
    )

    assert result.delete_message is False
    assert result.reason == "pr_review_analysis_processor_unavailable"


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


def test_dispatcher_routes_pr_review_analysis_jobs() -> None:
    pr_review_processor = FakePrReviewAnalysisProcessor()
    dispatcher = JobDispatcher(pr_review_analysis_processor=pr_review_processor)

    result = dispatcher.process_message(
        json.dumps(
            {
                "jobType": "pr_review_analysis_requested",
                "schemaVersion": "pr-review-analysis:v1",
            }
        )
    )

    assert result.delete_message is True
    assert result.reason == "pr_review_analysis_completed"
    assert result.job_type == "pr_review_analysis_requested"
    assert result.resource_id == "88888888-8888-8888-8888-888888888888"
    assert pr_review_processor.payloads == [
        {
            "jobType": "pr_review_analysis_requested",
            "schemaVersion": "pr-review-analysis:v1",
        }
    ]
