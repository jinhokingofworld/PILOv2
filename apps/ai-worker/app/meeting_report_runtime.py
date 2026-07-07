from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from typing import Any

from app.meeting_report_processor import (
    AudioObjectMetadata,
    GeneratedMeetingReport,
    InfrastructureError,
    MeetingReportContext,
    MeetingReportJob,
    MeetingReportProcessor,
    PermanentStorageError,
    ProviderBusinessError,
    parse_generated_report_json,
    serialize_action_items,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo"
DEFAULT_STT_MODEL = "gpt-4o-mini-transcribe"
DEFAULT_MEETING_REPORT_MODEL = "gpt-5.4-mini"
DEFAULT_WAIT_TIME_SECONDS = 20
DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 900


@dataclass(frozen=True)
class RuntimeSettings:
    aws_region: str
    sqs_queue_url: str
    sqs_endpoint: str | None
    database_url: str
    database_ssl: bool
    recordings_bucket: str
    openai_api_key: str
    openai_stt_model: str
    openai_meeting_report_model: str
    concurrency: int
    wait_time_seconds: int
    visibility_timeout_seconds: int

    @classmethod
    def from_env(cls) -> RuntimeSettings:
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_AI_JOBS_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            database_url=_env("DATABASE_URL", DEFAULT_DATABASE_URL),
            database_ssl=_env("DATABASE_SSL", "false").lower() == "true",
            recordings_bucket=_require_env("S3_RECORDINGS_BUCKET"),
            openai_api_key=_require_env("OPENAI_API_KEY"),
            openai_stt_model=_env("OPENAI_STT_MODEL", DEFAULT_STT_MODEL),
            openai_meeting_report_model=_env(
                "OPENAI_MEETING_REPORT_MODEL",
                DEFAULT_MEETING_REPORT_MODEL,
            ),
            concurrency=_positive_int_env("AI_WORKER_CONCURRENCY", 1),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS",
                DEFAULT_WAIT_TIME_SECONDS,
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
            ),
        )


class PgMeetingReportRepository:
    def __init__(self, database_url: str, database_ssl: bool) -> None:
        import psycopg
        from psycopg.rows import dict_row

        kwargs: dict[str, Any] = {"autocommit": True, "row_factory": dict_row}
        if database_ssl:
            kwargs["sslmode"] = "require"
        self.connection = psycopg.connect(database_url, **kwargs)

    def close(self) -> None:
        self.connection.close()

    def try_acquire_report_lock(self, report_id: str) -> bool:
        lock_key = _advisory_lock_key(report_id)
        row = self.connection.execute(
            "SELECT pg_try_advisory_lock(%s) AS acquired",
            (lock_key,),
        ).fetchone()
        return bool(row["acquired"])

    def release_report_lock(self, report_id: str) -> None:
        lock_key = _advisory_lock_key(report_id)
        self.connection.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))

    def get_report_context(self, job: MeetingReportJob) -> MeetingReportContext | None:
        row = self.connection.execute(
            """
            SELECT
              meeting_reports.id AS report_id,
              meeting_reports.meeting_id,
              meeting_reports.recording_id,
              meeting_reports.status AS report_status,
              meeting_recordings.status AS recording_status,
              meeting_recordings.audio_file_key AS recording_audio_file_key
            FROM meeting_reports
            JOIN meeting_recordings
              ON meeting_recordings.id = meeting_reports.recording_id
             AND meeting_recordings.meeting_id = meeting_reports.meeting_id
            WHERE meeting_reports.id = %s
              AND meeting_reports.meeting_id = %s
              AND meeting_reports.recording_id = %s
            LIMIT 1
            """,
            (job.report_id, job.meeting_id, job.recording_id),
        ).fetchone()

        if row is None:
            return None

        return MeetingReportContext(
            report_id=str(row["report_id"]),
            meeting_id=str(row["meeting_id"]),
            recording_id=str(row["recording_id"]),
            report_status=str(row["report_status"]),
            recording_status=str(row["recording_status"]),
            recording_audio_file_key=row["recording_audio_file_key"],
        )

    def mark_failed(self, report_id: str, failed_step: str, error_message: str) -> None:
        self.connection.execute(
            """
            UPDATE meeting_reports
            SET
              status = 'FAILED',
              failed_step = %s,
              error_message = %s,
              transcript_text = NULL,
              summary = NULL,
              discussion_points = NULL,
              decisions = NULL,
              action_item_candidates = '[]'::jsonb,
              updated_at = now()
            WHERE id = %s
              AND status = 'PROCESSING'
            """,
            (failed_step, error_message, report_id),
        )

    def mark_completed(self, report_id: str, report: GeneratedMeetingReport) -> None:
        self.connection.execute(
            """
            UPDATE meeting_reports
            SET
              status = 'COMPLETED',
              failed_step = NULL,
              error_message = NULL,
              transcript_text = %s,
              summary = %s,
              discussion_points = %s,
              decisions = %s,
              action_item_candidates = %s::jsonb,
              updated_at = now()
            WHERE id = %s
              AND status = 'PROCESSING'
            """,
            (
                report.transcript_text,
                report.summary,
                report.discussion_points,
                report.decisions,
                serialize_action_items(report.action_item_candidates),
                report_id,
            ),
        )


class S3RecordingStorage:
    def __init__(self, client: Any, bucket: str) -> None:
        self.client = client
        self.bucket = bucket

    def head_audio(self, audio_file_key: str) -> AudioObjectMetadata:
        try:
            response = self.client.head_object(Bucket=self.bucket, Key=audio_file_key)
        except Exception as error:
            if _is_missing_s3_object_error(error):
                raise PermanentStorageError("Recording object is unavailable") from error
            raise InfrastructureError("Could not inspect recording object") from error

        return AudioObjectMetadata(file_size_bytes=int(response["ContentLength"]))

    def download_audio(self, audio_file_key: str) -> str:
        suffix = os.path.splitext(audio_file_key)[1] or ".audio"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as target:
            path = target.name

        try:
            self.client.download_file(self.bucket, audio_file_key, path)
        except Exception as error:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
            if _is_missing_s3_object_error(error):
                raise PermanentStorageError("Recording object is unavailable") from error
            raise InfrastructureError("Could not download recording object") from error

        return path


class OpenAiMeetingReportClient:
    def __init__(self, api_key: str, stt_model: str, meeting_report_model: str) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key)
        self.stt_model = stt_model
        self.meeting_report_model = meeting_report_model

    def transcribe(self, audio_file_path: str) -> str:
        try:
            with open(audio_file_path, "rb") as audio_file:
                transcription = self.client.audio.transcriptions.create(
                    model=self.stt_model,
                    file=audio_file,
                    response_format="json",
                )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI STT retryable failure") from error
        except Exception as error:
            raise ProviderBusinessError("OpenAI STT business failure") from error

        if isinstance(transcription, str):
            return transcription

        text = getattr(transcription, "text", None)
        if isinstance(text, str):
            return text

        raise ProviderBusinessError("OpenAI STT returned no text")

    def generate_report(self, transcript_text: str) -> GeneratedMeetingReport:
        try:
            response = self.client.responses.create(
                model=self.meeting_report_model,
                input=[
                    {
                        "role": "system",
                        "content": _meeting_report_system_prompt(),
                    },
                    {
                        "role": "user",
                        "content": transcript_text,
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "meeting_report",
                        "strict": True,
                        "schema": _meeting_report_schema(),
                    }
                },
            )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI LLM retryable failure") from error
        except Exception as error:
            raise ProviderBusinessError("OpenAI LLM business failure") from error

        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text.strip():
            output_text = _extract_response_text(response)

        if not output_text:
            raise ProviderBusinessError("OpenAI LLM returned no text")

        return parse_generated_report_json(output_text, transcript_text)


class SqsMeetingReportWorker:
    def __init__(
        self,
        settings: RuntimeSettings,
        processor: MeetingReportProcessor,
        sqs_client: Any,
    ) -> None:
        self.settings = settings
        self.processor = processor
        self.sqs_client = sqs_client

    def run_forever(self) -> None:
        LOGGER.info("ai-worker SQS consumer started")
        while True:
            self.run_once()

    def run_once(self) -> int:
        response = self.sqs_client.receive_message(
            QueueUrl=self.settings.sqs_queue_url,
            MaxNumberOfMessages=min(max(self.settings.concurrency, 1), 10),
            WaitTimeSeconds=self.settings.wait_time_seconds,
            VisibilityTimeout=self.settings.visibility_timeout_seconds,
        )
        messages = response.get("Messages", [])

        for message in messages:
            body = message.get("Body", "")
            receipt_handle = message.get("ReceiptHandle")
            result = self.processor.process_message(body)

            LOGGER.info(
                "meeting_report job result reason=%s report_id=%s message_id=%s",
                result.reason,
                result.report_id,
                message.get("MessageId"),
            )
            if result.delete_message and receipt_handle:
                self.sqs_client.delete_message(
                    QueueUrl=self.settings.sqs_queue_url,
                    ReceiptHandle=receipt_handle,
                )

        return len(messages)


def create_worker(settings: RuntimeSettings | None = None) -> SqsMeetingReportWorker:
    import boto3

    resolved_settings = settings or RuntimeSettings.from_env()
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
    processor = MeetingReportProcessor(repository, storage, ai_client)
    return SqsMeetingReportWorker(resolved_settings, processor, sqs_client)


def run_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

    while True:
        try:
            worker = create_worker()
            worker.run_forever()
        except KeyboardInterrupt:
            raise
        except Exception:
            LOGGER.exception("ai-worker crashed; restarting after backoff")
            time.sleep(5)


def _advisory_lock_key(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _env(key: str, default: str) -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        return default
    return value.strip()


def _optional_env(key: str) -> str | None:
    value = os.getenv(key)
    if value is None or not value.strip():
        return None
    return value.strip()


def _require_env(key: str) -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        raise RuntimeError(f"{key} is required")
    return value.strip()


def _positive_int_env(key: str, default: int) -> int:
    value = os.getenv(key)
    if value is None or not value.strip():
        return default

    try:
        parsed = int(value)
    except ValueError:
        return default

    return max(parsed, 1)


def _openai_retryable_errors() -> tuple[type[BaseException], ...]:
    try:
        from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError
    except Exception:
        return ()

    return (APIConnectionError, APITimeoutError, InternalServerError, RateLimitError)


def _is_missing_s3_object_error(error: Exception) -> bool:
    try:
        from botocore.exceptions import ClientError
    except Exception:
        return False

    if not isinstance(error, ClientError):
        return False

    response = error.response
    error_code = str(response.get("Error", {}).get("Code", ""))
    status_code = response.get("ResponseMetadata", {}).get("HTTPStatusCode")

    return error_code in {"404", "NoSuchKey", "NotFound", "NoSuchBucket"} or status_code == 404


def _meeting_report_system_prompt() -> str:
    return (
        "You generate concise meeting reports from transcripts. "
        "Return only JSON matching the provided schema. "
        "Use the transcript language. "
        "Set every actionItemCandidates[].assigneeUserId to null because "
        "this worker does not match users in #174."
    )


def _meeting_report_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "summary",
            "discussionPoints",
            "decisions",
            "actionItemCandidates",
        ],
        "properties": {
            "summary": {"type": "string"},
            "discussionPoints": {"type": "string"},
            "decisions": {"type": "string"},
            "actionItemCandidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "title",
                        "description",
                        "assigneeUserId",
                        "priority",
                    ],
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "assigneeUserId": {"type": "null"},
                        "priority": {
                            "type": "string",
                            "enum": ["LOW", "MEDIUM", "HIGH"],
                        },
                    },
                },
            },
        },
    }


def _extract_response_text(response: object) -> str:
    output = getattr(response, "output", None)
    if not isinstance(output, list):
        return ""

    texts: list[str] = []
    for item in output:
        content = getattr(item, "content", None)
        if not isinstance(content, list):
            continue
        for part in content:
            text = getattr(part, "text", None)
            if isinstance(text, str):
                texts.append(text)

    return "".join(texts)
