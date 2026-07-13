from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.agent_processor import (
    AgentRunProcessor,
    OpenAiAgentPlannerClient,
)
from app.canvas_agent.embedding_processor import CanvasEmbeddingProcessor
from app.canvas_agent.embeddings import LocalSentenceTransformerCanvasEmbedder
from app.canvas_agent.planning.planner import OpenAiCanvasAgentPlanner
from app.canvas_agent.processor import CanvasAgentProcessor
from app.canvas_agent.repository import PgCanvasAgentRepository
from app.canvas_agent.routing.semantic_router import CanvasSemanticRouter
from app.job_dispatcher import JobDispatcher
from app.meeting_report_processor import MeetingReportProcessor
from app.meeting_report_runtime import (
    DEFAULT_AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS,
    DEFAULT_AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS,
    DEFAULT_CANVAS_EMBEDDING_JOBS_PER_TICK,
    DEFAULT_OPENAI_AGENT_PLANNER_TIMEOUT_MS,
    DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
    DEFAULT_WAIT_TIME_SECONDS,
    HttpAgentExecutionHandoffClient,
    HttpMeetingReportEventPublisher,
    OpenAiMeetingReportClient,
    PgAgentRunRepository,
    PgMeetingReportRepository,
    S3RecordingStorage,
    SqsAiJobWorker,
    _database_url,
    _env,
    _optional_env,
    _positive_int_env,
    _positive_ms_env,
    _require_env,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class SharedAiWorkerSettings:
    aws_region: str
    sqs_queue_url: str
    sqs_endpoint: str | None
    database_url: str
    database_ssl: bool
    openai_api_key: str
    openai_agent_planner_model: str
    openai_agent_planner_timeout_seconds: float
    agent_execution_handoff_base_url: str
    agent_execution_handoff_token: str
    agent_execution_handoff_timeout_seconds: int
    agent_stale_execution_sweep_interval_seconds: int
    wait_time_seconds: int
    visibility_timeout_seconds: int
    canvas_embedding_jobs_per_tick: int
    legacy_meeting_drain_enabled: bool
    legacy_meeting_recordings_bucket: str | None
    legacy_meeting_stt_model: str | None
    legacy_meeting_report_model: str | None
    legacy_meeting_event_base_url: str | None
    legacy_meeting_event_token: str | None
    legacy_meeting_event_timeout_seconds: int
    legacy_meeting_event_max_attempts: int

    @classmethod
    def from_env(cls) -> SharedAiWorkerSettings:
        legacy_meeting_drain_enabled = (
            _env(
                "LEGACY_MEETING_DRAIN_ENABLED",
                "false",
            ).lower()
            == "true"
        )
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_AI_JOBS_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            database_url=_database_url(),
            database_ssl=_env("DATABASE_SSL", "false").lower() == "true",
            openai_api_key=_require_env("OPENAI_API_KEY"),
            openai_agent_planner_model=_env("OPENAI_AGENT_PLANNER_MODEL", "gpt-5.4-mini"),
            openai_agent_planner_timeout_seconds=_positive_ms_env(
                "OPENAI_AGENT_PLANNER_TIMEOUT_MS",
                DEFAULT_OPENAI_AGENT_PLANNER_TIMEOUT_MS,
            ),
            agent_execution_handoff_base_url=_require_env("AGENT_EXECUTION_HANDOFF_BASE_URL"),
            agent_execution_handoff_token=_require_env("AGENT_EXECUTION_HANDOFF_TOKEN"),
            agent_execution_handoff_timeout_seconds=_positive_int_env(
                "AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS",
                DEFAULT_AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS,
            ),
            agent_stale_execution_sweep_interval_seconds=_positive_int_env(
                "AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS",
                DEFAULT_AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS,
            ),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS",
                DEFAULT_WAIT_TIME_SECONDS,
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
            ),
            canvas_embedding_jobs_per_tick=_positive_int_env(
                "CANVAS_EMBEDDING_JOBS_PER_TICK",
                DEFAULT_CANVAS_EMBEDDING_JOBS_PER_TICK,
            ),
            legacy_meeting_drain_enabled=legacy_meeting_drain_enabled,
            legacy_meeting_recordings_bucket=(
                _require_env("S3_RECORDINGS_BUCKET") if legacy_meeting_drain_enabled else None
            ),
            legacy_meeting_stt_model=(
                _env("OPENAI_STT_MODEL", "whisper-1") if legacy_meeting_drain_enabled else None
            ),
            legacy_meeting_report_model=(
                _env("OPENAI_MEETING_REPORT_MODEL", "gpt-5.4-mini")
                if legacy_meeting_drain_enabled
                else None
            ),
            legacy_meeting_event_base_url=(
                _require_env("MEETING_REPORT_EVENT_BASE_URL")
                if legacy_meeting_drain_enabled
                else None
            ),
            legacy_meeting_event_token=(
                _require_env("MEETING_REPORT_EVENT_TOKEN") if legacy_meeting_drain_enabled else None
            ),
            legacy_meeting_event_timeout_seconds=_positive_int_env(
                "MEETING_REPORT_EVENT_TIMEOUT_SECONDS",
                10,
            ),
            legacy_meeting_event_max_attempts=_positive_int_env(
                "MEETING_REPORT_EVENT_MAX_ATTEMPTS",
                3,
            ),
        )


def create_shared_ai_worker(
    settings: SharedAiWorkerSettings | None = None,
) -> SqsAiJobWorker:
    import boto3

    resolved_settings = settings or SharedAiWorkerSettings.from_env()
    boto_kwargs = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    agent_run_repository = PgAgentRunRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    canvas_agent_repository = PgCanvasAgentRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    agent_planner_client = OpenAiAgentPlannerClient(
        resolved_settings.openai_api_key,
        resolved_settings.openai_agent_planner_model,
        resolved_settings.openai_agent_planner_timeout_seconds,
    )
    canvas_agent_planner = OpenAiCanvasAgentPlanner(
        resolved_settings.openai_api_key,
        resolved_settings.openai_agent_planner_model,
    )
    canvas_embedder = LocalSentenceTransformerCanvasEmbedder()
    agent_execution_handoff_client = HttpAgentExecutionHandoffClient(
        resolved_settings.agent_execution_handoff_base_url,
        resolved_settings.agent_execution_handoff_token,
        resolved_settings.agent_execution_handoff_timeout_seconds,
    )
    agent_run_processor = AgentRunProcessor(
        agent_run_repository,
        agent_planner_client,
        agent_execution_handoff_client,
    )
    canvas_agent_processor = CanvasAgentProcessor(
        canvas_agent_repository,
        canvas_agent_planner,
        CanvasSemanticRouter(canvas_agent_repository, canvas_embedder),
    )
    canvas_embedding_processor = CanvasEmbeddingProcessor(
        canvas_agent_repository,
        canvas_embedder,
    )
    legacy_meeting_report_processor = None
    if resolved_settings.legacy_meeting_drain_enabled:
        legacy_meeting_report_processor = _create_legacy_meeting_report_processor(
            resolved_settings,
            boto3.client("s3", **boto_kwargs),
        )

    dispatcher = create_shared_dispatcher(
        agent_run_processor,
        canvas_agent_processor,
        legacy_meeting_report_processor,
    )
    return SqsAiJobWorker(
        resolved_settings,
        dispatcher,
        boto3.client("sqs", **boto_kwargs),
        canvas_embedding_processor=canvas_embedding_processor,
        stale_execution_recovery=agent_execution_handoff_client,
        agent_retry_exhaustion_recovery=agent_run_repository,
    )


def _create_legacy_meeting_report_processor(
    settings: SharedAiWorkerSettings,
    s3_client: object,
) -> MeetingReportProcessor:
    if (
        settings.legacy_meeting_recordings_bucket is None
        or settings.legacy_meeting_stt_model is None
        or settings.legacy_meeting_report_model is None
        or settings.legacy_meeting_event_base_url is None
        or settings.legacy_meeting_event_token is None
    ):
        raise RuntimeError("Legacy MeetingReport drain configuration is incomplete")

    repository = PgMeetingReportRepository(settings.database_url, settings.database_ssl)
    storage = S3RecordingStorage(s3_client, settings.legacy_meeting_recordings_bucket)
    ai_client = OpenAiMeetingReportClient(
        settings.openai_api_key,
        settings.legacy_meeting_stt_model,
        settings.legacy_meeting_report_model,
    )
    event_publisher = HttpMeetingReportEventPublisher(
        settings.legacy_meeting_event_base_url,
        settings.legacy_meeting_event_token,
        settings.legacy_meeting_event_timeout_seconds,
        settings.legacy_meeting_event_max_attempts,
    )
    return MeetingReportProcessor(repository, storage, ai_client, event_publisher)


def create_shared_dispatcher(
    agent_run_processor: AgentRunProcessor,
    canvas_agent_processor: CanvasAgentProcessor,
    legacy_meeting_report_processor: MeetingReportProcessor | None,
) -> JobDispatcher:
    return JobDispatcher(
        meeting_report_processor=legacy_meeting_report_processor,
        agent_run_processor=agent_run_processor,
        canvas_agent_processor=canvas_agent_processor,
    )


def run_shared_ai_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = create_shared_ai_worker()
    LOGGER.info("shared ai-worker initialized")
    worker.run_forever()


if __name__ == "__main__":
    run_shared_ai_worker()
