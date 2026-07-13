from app.job_dispatcher import JobDispatcher
from app.meeting_worker_runtime import (
    MeetingWorkerSettings,
    create_meeting_dispatcher,
)
from app.shared_ai_worker_runtime import SharedAiWorkerSettings


class FakeMeetingReportProcessor:
    def process_payload(self, _payload: dict[str, object]):
        raise AssertionError("This test does not dispatch a MeetingReport job")


def test_meeting_worker_uses_only_dedicated_queue_environment(monkeypatch) -> None:
    monkeypatch.setenv("SQS_MEETING_JOBS_QUEUE_URL", "https://sqs.example.com/meeting-jobs")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MEETING_REPORT_EVENT_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("MEETING_REPORT_EVENT_TOKEN", "meeting-token")
    monkeypatch.delenv("SQS_AI_JOBS_QUEUE_URL", raising=False)
    monkeypatch.delenv("SQS_PR_REVIEW_ANALYSIS_QUEUE_URL", raising=False)

    settings = MeetingWorkerSettings.from_env()

    assert settings.sqs_queue_url == "https://sqs.example.com/meeting-jobs"


def test_meeting_dispatcher_has_no_agent_or_pr_review_processor() -> None:
    dispatcher = create_meeting_dispatcher(FakeMeetingReportProcessor())

    assert isinstance(dispatcher, JobDispatcher)
    assert dispatcher.agent_run_processor is None
    assert dispatcher.canvas_agent_processor is None
    assert dispatcher.pr_review_analysis_processor is None


def test_shared_ai_worker_does_not_require_meeting_queue_environment(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/ai-jobs")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_TOKEN", "agent-token")
    monkeypatch.delenv("SQS_MEETING_JOBS_QUEUE_URL", raising=False)

    settings = SharedAiWorkerSettings.from_env()

    assert settings.sqs_queue_url == "https://sqs.example.com/ai-jobs"
