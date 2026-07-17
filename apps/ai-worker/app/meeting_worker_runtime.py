from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from app.job_dispatcher import JobDispatcher
from app.meeting_action_item_extraction_processor import MeetingActionItemExtractionProcessor
from app.meeting_report_processor import MeetingReportProcessor
from app.meeting_report_runtime import (
    DEFAULT_MEETING_REPORT_EVENT_MAX_ATTEMPTS,
    DEFAULT_MEETING_REPORT_MODEL,
    DEFAULT_STT_MODEL,
    DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
    DEFAULT_WAIT_TIME_SECONDS,
    HttpMeetingReportEventPublisher,
    OpenAiMeetingReportClient,
    PgMeetingReportRepository,
    S3RecordingStorage,
    SqsAiJobWorker,
    _database_url,
    _env,
    _optional_env,
    _positive_int_env,
    _require_env,
)

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class MeetingWorkerSettings:
    aws_region: str
    sqs_queue_url: str
    sqs_endpoint: str | None
    database_url: str
    database_ssl: bool
    recordings_bucket: str
    openai_api_key: str
    openai_stt_model: str
    openai_meeting_report_model: str
    meeting_report_event_base_url: str
    meeting_report_event_token: str
    meeting_report_event_timeout_seconds: int
    meeting_report_event_max_attempts: int
    wait_time_seconds: int
    visibility_timeout_seconds: int
    canvas_embedding_jobs_per_tick: int = 0
    agent_stale_execution_sweep_interval_seconds: int = 60

    @classmethod
    def from_env(cls) -> MeetingWorkerSettings:
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_MEETING_JOBS_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            database_url=_database_url(),
            database_ssl=_env("DATABASE_SSL", "false").lower() == "true",
            recordings_bucket=_require_env("S3_RECORDINGS_BUCKET"),
            openai_api_key=_require_env("OPENAI_API_KEY"),
            openai_stt_model=_env("OPENAI_STT_MODEL", DEFAULT_STT_MODEL),
            openai_meeting_report_model=_env(
                "OPENAI_MEETING_REPORT_MODEL",
                DEFAULT_MEETING_REPORT_MODEL,
            ),
            meeting_report_event_base_url=_require_env("MEETING_REPORT_EVENT_BASE_URL"),
            meeting_report_event_token=_require_env("MEETING_REPORT_EVENT_TOKEN"),
            meeting_report_event_timeout_seconds=_positive_int_env(
                "MEETING_REPORT_EVENT_TIMEOUT_SECONDS",
                10,
            ),
            meeting_report_event_max_attempts=_positive_int_env(
                "MEETING_REPORT_EVENT_MAX_ATTEMPTS",
                DEFAULT_MEETING_REPORT_EVENT_MAX_ATTEMPTS,
            ),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS",
                DEFAULT_WAIT_TIME_SECONDS,
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
            ),
        )


def create_meeting_worker(
    settings: MeetingWorkerSettings | None = None,
) -> SqsAiJobWorker:
    import boto3

    resolved_settings = settings or MeetingWorkerSettings.from_env()
    boto_kwargs = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    sqs_client = boto3.client("sqs", **boto_kwargs)
    s3_client = boto3.client("s3", **boto_kwargs)
    repository = PgMeetingReportRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    storage = S3RecordingStorage(s3_client, resolved_settings.recordings_bucket)
    ai_client = OpenAiMeetingReportClient(
        resolved_settings.openai_api_key,
        resolved_settings.openai_stt_model,
        resolved_settings.openai_meeting_report_model,
    )
    event_publisher = HttpMeetingReportEventPublisher(
        resolved_settings.meeting_report_event_base_url,
        resolved_settings.meeting_report_event_token,
        resolved_settings.meeting_report_event_timeout_seconds,
        resolved_settings.meeting_report_event_max_attempts,
    )
    processor = MeetingReportProcessor(repository, storage, ai_client, event_publisher)
    action_item_extraction_processor = MeetingActionItemExtractionProcessor(
        repository,
        ai_client,
        event_publisher,
    )
    dispatcher = create_meeting_dispatcher(processor, action_item_extraction_processor)
    return SqsAiJobWorker(resolved_settings, dispatcher, sqs_client)


def create_meeting_dispatcher(
    processor: MeetingReportProcessor,
    action_item_extraction_processor: MeetingActionItemExtractionProcessor,
) -> JobDispatcher:
    return JobDispatcher(
        meeting_report_processor=processor,
        meeting_action_item_extraction_processor=action_item_extraction_processor,
    )


def run_meeting_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = create_meeting_worker()
    LOGGER.info("meeting-worker initialized")
    worker.run_forever()


if __name__ == "__main__":
    run_meeting_worker()
