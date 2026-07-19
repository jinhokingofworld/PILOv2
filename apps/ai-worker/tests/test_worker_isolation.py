import json
import sys
from types import SimpleNamespace

import app.shared_ai_worker_runtime as shared_ai_worker_runtime
from app.agent_worker_runtime import AgentWorkerSettings, create_agent_dispatcher
from app.job_dispatcher import JobDispatcher
from app.meeting_action_item_extraction_processor import (
    MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE,
)
from app.meeting_report_processor import ProcessResult
from app.meeting_worker_runtime import (
    MeetingWorkerSettings,
    create_meeting_dispatcher,
)
from app.pr_review_analysis_runtime import (
    PrReviewWorkerSettings,
    create_pr_review_dispatcher,
)
from app.shared_ai_worker_runtime import (
    SharedAiWorkerSettings,
    create_shared_dispatcher,
)
from app.worker import supported_jobs


class FakeMeetingReportProcessor:
    def process_payload(self, _payload: dict[str, object]) -> ProcessResult:
        return ProcessResult(
            delete_message=True,
            reason="completed",
            report_id="report-1",
        )


class FakeActionItemExtractionProcessor:
    def process_payload(self, _payload: dict[str, object]) -> ProcessResult:
        return ProcessResult(
            delete_message=True,
            reason="completed",
            report_id="report-1",
        )


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
    dispatcher = create_meeting_dispatcher(
        FakeMeetingReportProcessor(), FakeActionItemExtractionProcessor()
    )

    assert isinstance(dispatcher, JobDispatcher)
    assert dispatcher.agent_run_processor is None
    assert dispatcher.canvas_agent_processor is None
    assert dispatcher.pr_review_analysis_processor is None


def test_meeting_dispatcher_handles_action_item_extraction_job() -> None:
    dispatcher = create_meeting_dispatcher(
        FakeMeetingReportProcessor(), FakeActionItemExtractionProcessor()
    )

    result = dispatcher.process_message(
        json.dumps(
            {
                "jobType": MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE,
                "reportId": "report-1",
            }
        )
    )

    assert result.delete_message is True
    assert result.reason == "completed"
    assert result.job_type == MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE


def test_worker_reports_action_item_extraction_as_supported_job() -> None:
    assert MEETING_ACTION_ITEM_EXTRACTION_JOB_TYPE in supported_jobs()


def test_shared_ai_worker_does_not_require_meeting_queue_environment(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/ai-jobs")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("AGENT_EXECUTION_HANDOFF_BASE_URL", raising=False)
    monkeypatch.delenv("AGENT_EXECUTION_HANDOFF_TOKEN", raising=False)
    monkeypatch.delenv("SQS_MEETING_JOBS_QUEUE_URL", raising=False)

    settings = SharedAiWorkerSettings.from_env()

    assert settings.sqs_queue_url == "https://sqs.example.com/ai-jobs"
    assert settings.legacy_meeting_drain_enabled is False
    assert settings.legacy_agent_drain_enabled is False


def test_shared_ai_worker_wires_meeting_transcript_embedding_processor(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/ai-jobs")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("AGENT_EXECUTION_HANDOFF_BASE_URL", raising=False)
    monkeypatch.delenv("AGENT_EXECUTION_HANDOFF_TOKEN", raising=False)

    monkeypatch.setitem(
        sys.modules,
        "boto3",
        SimpleNamespace(client=lambda *_args, **_kwargs: object()),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime, "PgCanvasAgentRepository", lambda *_args: object()
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "PgMeetingTranscriptEmbeddingRepository",
        lambda *_args: "meeting-transcript-repository",
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "PgMeetingActivityEvidenceEmbeddingRepository",
        lambda *_args: "meeting-activity-evidence-repository",
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiAgentPlannerClient",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiAgentRouterClient",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiCanvasAgentIntentClassifier",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiCanvasAgentHtmlGenerator",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiCanvasAgentChatResponder",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "LocalSentenceTransformerCanvasEmbedder",
        lambda: object(),
    )
    monkeypatch.setattr(shared_ai_worker_runtime, "CanvasSemanticRouter", lambda *_args: object())
    monkeypatch.setattr(shared_ai_worker_runtime, "CanvasAgentProcessor", lambda *_args: object())
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "CanvasEmbeddingProcessor",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "OpenAiTranscriptEmbedder",
        lambda api_key, model_name: (api_key, model_name),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "MeetingTranscriptEmbeddingProcessor",
        lambda repository, embedder: (repository, embedder),
    )
    monkeypatch.setattr(
        shared_ai_worker_runtime,
        "MeetingActivityEvidenceEmbeddingProcessor",
        lambda repository, embedder: (repository, embedder),
    )

    worker = shared_ai_worker_runtime.create_shared_ai_worker()

    assert worker.meeting_transcript_embedding_processor == (
        "meeting-transcript-repository",
        ("test-key", "text-embedding-3-small"),
    )
    assert worker.settings.meeting_transcript_embedding_jobs_per_tick == 10
    assert worker.meeting_activity_evidence_embedding_processor == (
        "meeting-activity-evidence-repository",
        ("test-key", "text-embedding-3-small"),
    )


def test_agent_worker_uses_only_dedicated_queue_environment(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AGENT_JOBS_QUEUE_URL", "https://sqs.example.com/agent-jobs")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_TOKEN", "agent-token")
    monkeypatch.delenv("SQS_AI_JOBS_QUEUE_URL", raising=False)
    monkeypatch.delenv("SQS_MEETING_JOBS_QUEUE_URL", raising=False)

    settings = AgentWorkerSettings.from_env()

    assert settings.sqs_queue_url == "https://sqs.example.com/agent-jobs"
    assert settings.visibility_timeout_seconds == 180
    assert settings.visibility_heartbeat_seconds == 45
    assert settings.openai_agent_router_model == settings.openai_agent_planner_model


def test_agent_worker_dispatcher_has_no_meeting_or_pr_review_processor() -> None:
    grounded_answer_processor = object()
    dispatcher = create_agent_dispatcher(object(), grounded_answer_processor)

    assert dispatcher.meeting_report_processor is None
    assert dispatcher.canvas_agent_processor is None
    assert dispatcher.pr_review_analysis_processor is None
    assert dispatcher.grounded_answer_processor is grounded_answer_processor


def test_pr_review_worker_uses_only_dedicated_queue_environment(monkeypatch) -> None:
    monkeypatch.setenv(
        "SQS_PR_REVIEW_ANALYSIS_QUEUE_URL",
        "https://sqs.example.com/pr-review-analysis",
    )
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_HANDOFF_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("PR_REVIEW_ANALYSIS_WORKER_TOKEN", "pr-review-token")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("SQS_AI_JOBS_QUEUE_URL", raising=False)
    monkeypatch.delenv("SQS_AGENT_JOBS_QUEUE_URL", raising=False)
    monkeypatch.delenv("SQS_MEETING_JOBS_QUEUE_URL", raising=False)

    settings = PrReviewWorkerSettings.from_env()

    assert settings.sqs_queue_url == "https://sqs.example.com/pr-review-analysis"


def test_pr_review_dispatcher_has_no_meeting_agent_or_canvas_processor() -> None:
    dispatcher = create_pr_review_dispatcher(object())

    assert dispatcher.meeting_report_processor is None
    assert dispatcher.agent_run_processor is None
    assert dispatcher.canvas_agent_processor is None


def test_shared_ai_worker_keeps_legacy_meeting_processor_during_drain(monkeypatch) -> None:
    monkeypatch.setenv("SQS_AI_JOBS_QUEUE_URL", "https://sqs.example.com/ai-jobs")
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("AGENT_EXECUTION_HANDOFF_TOKEN", "agent-token")
    monkeypatch.setenv("LEGACY_MEETING_DRAIN_ENABLED", "true")
    monkeypatch.setenv("S3_RECORDINGS_BUCKET", "recordings")
    monkeypatch.setenv("MEETING_REPORT_EVENT_BASE_URL", "http://localhost:4000")
    monkeypatch.setenv("MEETING_REPORT_EVENT_TOKEN", "meeting-token")

    settings = SharedAiWorkerSettings.from_env()
    dispatcher = create_shared_dispatcher(object(), object(), FakeMeetingReportProcessor())
    result = dispatcher.process_message(json.dumps({"jobType": "meeting_report"}))

    assert settings.legacy_meeting_drain_enabled is True
    assert result.delete_message is True
    assert result.reason == "completed"
