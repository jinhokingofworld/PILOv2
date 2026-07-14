from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.agent_processor import (
    AgentExecutionHandoffClient,
    AgentRunContext,
    AgentRunJob,
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
from app.meeting_report_processor import (
    AudioObjectMetadata,
    GeneratedMeetingReport,
    InfrastructureError,
    MeetingReportContext,
    MeetingReportEventPublisher,
    MeetingReportJob,
    MeetingReportProcessor,
    PermanentStorageError,
    ProviderBusinessError,
    TranscriptSegment,
    parse_generated_report_json,
    serialize_action_items,
)
from app.meeting_transcript_embedding_processor import (
    OPENAI_TRANSCRIPT_EMBEDDING_MODEL,
    MeetingTranscriptEmbeddingProcessor,
    OpenAiTranscriptEmbedder,
    TranscriptChunk,
    transcript_segments_hash,
)

LOGGER = logging.getLogger(__name__)

DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo"
DEFAULT_STT_MODEL = "whisper-1"
DEFAULT_MEETING_REPORT_MODEL = "gpt-5.4-mini"
DEFAULT_MEETING_TRANSCRIPT_EMBEDDING_MODEL = OPENAI_TRANSCRIPT_EMBEDDING_MODEL
DEFAULT_WAIT_TIME_SECONDS = 20
DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 900
DEFAULT_AGENT_EXECUTION_HANDOFF_TIMEOUT_SECONDS = 10
DEFAULT_AGENT_STALE_EXECUTION_SWEEP_INTERVAL_SECONDS = 60
DEFAULT_OPENAI_AGENT_PLANNER_TIMEOUT_MS = 60_000
DEFAULT_CANVAS_EMBEDDING_JOBS_PER_TICK = 10
DEFAULT_MEETING_TRANSCRIPT_EMBEDDING_JOBS_PER_TICK = 10
DEFAULT_MEETING_REPORT_EVENT_MAX_ATTEMPTS = 3
AGENT_RETRY_TERMINAL_RECEIVE_COUNT = 3
AGENT_RETRY_EXHAUSTED_ERROR_CODE = "AGENT_PLANNER_RETRY_EXHAUSTED"
PR_REVIEW_ANALYSIS_RETRY_TERMINAL_RECEIVE_COUNT = 3
CANVAS_AGENT_RETRY_TERMINAL_RECEIVE_COUNT = 3
AGENT_RETRY_EXHAUSTED_ERROR_MESSAGE = "요청을 분석하지 못했습니다. 잠시 후 다시 시도해주세요."
LOCAL_APP_ENVS = {"local", "test", "development"}
MEETING_REPORT_FAILURE_STEPS = {
    "recording_not_completed": "STT",
    "audio_key_mismatch": "STT",
    "audio_unavailable": "STT",
    "audio_too_large": "STT",
    "stt_failed": "STT",
    "llm_failed": "LLM",
}


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
    openai_meeting_transcript_embedding_model: str
    openai_agent_planner_model: str
    openai_agent_planner_timeout_seconds: float
    agent_execution_handoff_base_url: str
    agent_execution_handoff_token: str
    agent_execution_handoff_timeout_seconds: int
    agent_stale_execution_sweep_interval_seconds: int
    wait_time_seconds: int
    visibility_timeout_seconds: int
    canvas_embedding_jobs_per_tick: int
    meeting_transcript_embedding_jobs_per_tick: int

    @classmethod
    def from_env(cls) -> RuntimeSettings:
        return cls(
            aws_region=_env("AWS_REGION", "ap-northeast-2"),
            sqs_queue_url=_require_env("SQS_AI_JOBS_QUEUE_URL"),
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
            openai_meeting_transcript_embedding_model=_env(
                "OPENAI_MEETING_TRANSCRIPT_EMBEDDING_MODEL",
                DEFAULT_MEETING_TRANSCRIPT_EMBEDDING_MODEL,
            ),
            openai_agent_planner_model=_env(
                "OPENAI_AGENT_PLANNER_MODEL",
                _env("OPENAI_MEETING_REPORT_MODEL", DEFAULT_MEETING_REPORT_MODEL),
            ),
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
            meeting_transcript_embedding_jobs_per_tick=_positive_int_env(
                "MEETING_TRANSCRIPT_EMBEDDING_JOBS_PER_TICK",
                DEFAULT_MEETING_TRANSCRIPT_EMBEDDING_JOBS_PER_TICK,
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

    def mark_progress(self, report_id: str, status: str) -> None:
        if status not in {"TRANSCRIBING", "SUMMARIZING"}:
            raise ValueError("Unsupported MeetingReport progress status")
        self.connection.execute(
            """
            UPDATE meeting_reports
            SET status = %s::meeting_report_status, updated_at = now()
            WHERE id = %s
              AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
            """,
            (status, report_id),
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
              AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
            """,
            (failed_step, error_message, report_id),
        )

    def mark_completed(self, report_id: str, report: GeneratedMeetingReport) -> None:
        with self.connection.transaction():
            updated = self.connection.execute(
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
              AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
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
            if updated.rowcount != 1:
                return
            for source_index, action_item in enumerate(report.action_item_candidates):
                self.connection.execute(
                    """
                    INSERT INTO meeting_report_action_items
                      (meeting_report_id, source_index, title, description, priority)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (meeting_report_id, source_index) DO NOTHING
                    """,
                    (
                        report_id,
                        source_index,
                        action_item.title,
                        action_item.description,
                        action_item.priority,
                    ),
                )
            self.connection.execute(
                "DELETE FROM meeting_report_transcript_segments WHERE meeting_report_id = %s",
                (report_id,),
            )
            segment_ids: dict[int, str] = {}
            for segment in report.transcript_segments:
                row = self.connection.execute(
                    """
                    INSERT INTO meeting_report_transcript_segments
                      (meeting_report_id, segment_index, started_at_ms, ended_at_ms, text)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        report_id,
                        segment.segment_index,
                        segment.started_at_ms,
                        segment.ended_at_ms,
                        segment.text,
                    ),
                ).fetchone()
                segment_ids[segment.segment_index] = str(row["id"])
            for evidence in report.evidence:
                for segment_index in evidence.segment_indexes:
                    self.connection.execute(
                        """
                        INSERT INTO meeting_report_evidence
                          (meeting_report_id, source_type, source_index, transcript_segment_id)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (
                          meeting_report_id, source_type, source_index, transcript_segment_id
                        ) DO NOTHING
                        """,
                        (
                            report_id,
                            evidence.source_type,
                            evidence.source_index,
                            segment_ids[segment_index],
                        ),
                    )
            current_transcript_hash = transcript_segments_hash(report.transcript_segments)
            self.connection.execute(
                """
                UPDATE meeting_report_transcript_embedding_jobs
                SET status = 'superseded', completed_at = now(), locked_at = NULL
                WHERE meeting_report_id = %s
                  AND transcript_hash <> %s
                  AND status IN ('pending', 'processing')
                """,
                (report_id, current_transcript_hash),
            )
            self.connection.execute(
                "DELETE FROM meeting_report_transcript_chunks WHERE meeting_report_id = %s",
                (report_id,),
            )
            self.connection.execute(
                """
                INSERT INTO meeting_report_transcript_embedding_jobs (
                  meeting_report_id,
                  transcript_hash
                )
                VALUES (%s, %s)
                ON CONFLICT (meeting_report_id, transcript_hash) DO UPDATE
                SET
                  status = 'pending',
                  attempt_count = 0,
                  locked_at = NULL,
                  completed_at = NULL,
                  error_message = NULL,
                  updated_at = now()
                WHERE meeting_report_transcript_embedding_jobs.status IN (
                  'completed', 'failed', 'superseded'
                )
                """,
                (report_id, current_transcript_hash),
            )


class PgMeetingTranscriptEmbeddingRepository:
    def __init__(self, database_url: str, database_ssl: bool) -> None:
        import psycopg
        from psycopg.rows import dict_row

        kwargs: dict[str, Any] = {"autocommit": True, "row_factory": dict_row}
        if database_ssl:
            kwargs["sslmode"] = "require"
        self.connection = psycopg.connect(database_url, **kwargs)

    def close(self) -> None:
        self.connection.close()

    def claim_transcript_embedding_job(self) -> dict[str, object] | None:
        with self.connection.transaction():
            return self.connection.execute(
                """
                WITH candidate AS (
                  SELECT id
                  FROM meeting_report_transcript_embedding_jobs
                  WHERE status = 'pending'
                     OR (
                       status = 'processing'
                       AND locked_at < now() - INTERVAL '10 minutes'
                     )
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE meeting_report_transcript_embedding_jobs job
                SET
                  status = 'processing',
                  attempt_count = attempt_count + 1,
                  locked_at = now(),
                  completed_at = NULL,
                  error_message = NULL
                FROM candidate
                WHERE job.id = candidate.id
                RETURNING job.*
                """
            ).fetchone()

    def get_transcript_embedding_source(self, job: dict[str, object]) -> dict[str, object] | None:
        report = self.connection.execute(
            """
            SELECT id
            FROM meeting_reports
            WHERE id = %s
              AND status = 'COMPLETED'
            LIMIT 1
            """,
            (job["meeting_report_id"],),
        ).fetchone()
        if report is None:
            return None

        rows = self.connection.execute(
            """
            SELECT segment_index, started_at_ms, ended_at_ms, text
            FROM meeting_report_transcript_segments
            WHERE meeting_report_id = %s
            ORDER BY segment_index ASC
            """,
            (job["meeting_report_id"],),
        ).fetchall()
        if not rows:
            return None

        source = {"segments": [dict(row) for row in rows]}
        source["transcript_hash"] = transcript_segments_hash(source["segments"])
        return source

    def replace_transcript_chunks(
        self,
        job: dict[str, object],
        chunks: list[TranscriptChunk],
        embeddings: list[list[float]],
        model_name: str,
        model_version: str,
    ) -> bool:
        if len(chunks) != len(embeddings) or not chunks:
            return False

        report_id = str(job["meeting_report_id"])
        expected_hash = str(job["transcript_hash"])
        with self.connection.transaction():
            rows = self.connection.execute(
                """
                SELECT segment_index, started_at_ms, ended_at_ms, text
                FROM meeting_report_transcript_segments
                WHERE meeting_report_id = %s
                ORDER BY segment_index ASC
                FOR SHARE
                """,
                (report_id,),
            ).fetchall()
            if not rows or transcript_segments_hash([dict(row) for row in rows]) != expected_hash:
                return False

            self.connection.execute(
                "DELETE FROM meeting_report_transcript_chunks WHERE meeting_report_id = %s",
                (report_id,),
            )
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                self.connection.execute(
                    """
                    INSERT INTO meeting_report_transcript_chunks (
                      meeting_report_id,
                      chunk_index,
                      start_segment_index,
                      end_segment_index,
                      started_at_ms,
                      ended_at_ms,
                      content,
                      content_hash,
                      transcript_hash,
                      embedding,
                      embedding_model,
                      embedding_version,
                      indexed_at
                    )
                    VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s::extensions.vector, %s, %s, now()
                    )
                    """,
                    (
                        report_id,
                        chunk.chunk_index,
                        chunk.start_segment_index,
                        chunk.end_segment_index,
                        chunk.started_at_ms,
                        chunk.ended_at_ms,
                        chunk.content,
                        chunk.content_hash,
                        expected_hash,
                        _vector_literal(embedding),
                        model_name,
                        model_version,
                    ),
                )
        return True

    def complete_transcript_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE meeting_report_transcript_embedding_jobs
            SET status = 'completed', completed_at = now(), locked_at = NULL
            WHERE id = %s
              AND status = 'processing'
            """,
            (job_id,),
        )

    def supersede_transcript_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE meeting_report_transcript_embedding_jobs
            SET status = 'superseded', completed_at = now(), locked_at = NULL
            WHERE id = %s
              AND status = 'processing'
            """,
            (job_id,),
        )

    def fail_transcript_embedding_job(self, job_id: str, message: str) -> None:
        self.connection.execute(
            """
            UPDATE meeting_report_transcript_embedding_jobs
            SET
              status = 'failed',
              error_message = %s,
              completed_at = now(),
              locked_at = NULL
            WHERE id = %s
              AND status = 'processing'
            """,
            (message[:4096], job_id),
        )


class PgAgentRunRepository:
    def __init__(self, database_url: str, database_ssl: bool) -> None:
        import psycopg
        from psycopg.rows import dict_row

        kwargs: dict[str, Any] = {"autocommit": True, "row_factory": dict_row}
        if database_ssl:
            kwargs["sslmode"] = "require"
        self.connection = psycopg.connect(database_url, **kwargs)

    def close(self) -> None:
        self.connection.close()

    def try_acquire_run_lock(self, run_id: str) -> bool:
        lock_key = _advisory_lock_key(run_id)
        row = self.connection.execute(
            "SELECT pg_try_advisory_lock(%s) AS acquired",
            (lock_key,),
        ).fetchone()
        return bool(row["acquired"])

    def release_run_lock(self, run_id: str) -> None:
        lock_key = _advisory_lock_key(run_id)
        self.connection.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))

    def get_run_context(self, job: AgentRunJob) -> AgentRunContext | None:
        row = self.connection.execute(
            """
            SELECT id, workspace_id, requested_by_user_id, status, prompt, timezone
            FROM agent_runs
            WHERE id = %s
              AND workspace_id = %s
              AND requested_by_user_id = %s
            LIMIT 1
            """,
            (job.run_id, job.workspace_id, job.requested_by_user_id),
        ).fetchone()

        if row is None:
            return None

        return AgentRunContext(
            run_id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            requested_by_user_id=str(row["requested_by_user_id"]),
            status=str(row["status"]),
            prompt=str(row["prompt"]),
            timezone=str(row["timezone"]),
        )

    def start_planner_step(self, job: AgentRunJob, context: AgentRunContext) -> str:
        input_summary = {
            "promptLength": len(context.prompt),
            "timezone": context.timezone,
            "toolSchemaVersion": job.tool_schema_version,
            "toolCount": len(job.tools),
        }
        row = self.connection.execute(
            """
            WITH next_step AS (
              SELECT COALESCE(MAX(step_order), 0) + 1 AS step_order
              FROM agent_steps
              WHERE run_id = %s
            )
            INSERT INTO agent_steps (
              run_id,
              step_order,
              step_type,
              status,
              tool_name,
              risk_level,
              input_json,
              output_json,
              resource_refs,
              started_at
            )
            SELECT
              %s,
              next_step.step_order,
              'planner',
              'running',
              NULL,
              NULL,
              %s::jsonb,
              '{}'::jsonb,
              '[]'::jsonb,
              now()
            FROM next_step
            RETURNING id
            """,
            (job.run_id, job.run_id, json.dumps(input_summary, ensure_ascii=False)),
        ).fetchone()
        if row is None:
            raise InfrastructureError("Could not start Agent planner step")
        return str(row["id"])

    def complete_planner_step(
        self,
        run_id: str,
        step_id: str,
        output_summary: dict[str, object],
    ) -> bool:
        row = self.connection.execute(
            """
            UPDATE agent_steps
            SET
              status = 'completed',
              output_json = %s::jsonb,
              completed_at = now(),
              updated_at = now()
            WHERE id = %s
              AND run_id = %s
              AND status = 'running'
            RETURNING id
            """,
            (json.dumps(output_summary, ensure_ascii=False), step_id, run_id),
        ).fetchone()
        return row is not None

    def fail_planner_step(
        self,
        run_id: str,
        step_id: str,
        error_code: str,
        error_message: str,
    ) -> None:
        self.connection.execute(
            """
            UPDATE agent_steps
            SET
              status = 'failed',
              error_code = %s,
              error_message = %s,
              completed_at = now(),
              updated_at = now()
            WHERE id = %s
              AND run_id = %s
            """,
            (error_code, error_message, step_id, run_id),
        )

    def complete_run(
        self,
        run_id: str,
        final_answer: str,
        message: str,
        risk_level: str | None,
    ) -> None:
        self.connection.execute(
            """
            UPDATE agent_runs
            SET
              status = 'completed',
              risk_level = %s,
              final_answer = %s,
              message = %s,
              error_code = NULL,
              error_message = NULL,
              completed_at = now(),
              updated_at = now()
            WHERE id = %s
              AND status = 'planning'
            """,
            (risk_level, final_answer, message, run_id),
        )

    def mark_tool_execution_ready(
        self,
        run_id: str,
        message: str,
        risk_level: str,
    ) -> None:
        self.connection.execute(
            """
            UPDATE agent_runs
            SET
              status = 'running',
              risk_level = %s,
              final_answer = NULL,
              message = %s,
              error_code = NULL,
              error_message = NULL,
              completed_at = NULL,
              updated_at = now()
            WHERE id = %s
              AND status = 'planning'
            """,
            (risk_level, message, run_id),
        )

    def mark_failed(
        self,
        run_id: str,
        error_code: str,
        error_message: str,
        message: str,
    ) -> None:
        self.connection.execute(
            """
            UPDATE agent_runs
            SET
              status = 'failed',
              error_code = %s,
              error_message = %s,
              message = %s,
              completed_at = now(),
              updated_at = now()
            WHERE id = %s
              AND status NOT IN ('completed', 'failed', 'cancelled')
            """,
            (error_code, error_message, message, run_id),
        )

    def fail_planning_after_retry_exhaustion(self, run_id: str) -> bool:
        if not self.try_acquire_run_lock(run_id):
            return False

        try:
            with self.connection.transaction():
                run = self.connection.execute(
                    """
                    UPDATE agent_runs
                    SET
                      status = 'failed',
                      error_code = %s,
                      error_message = %s,
                      message = %s,
                      completed_at = now(),
                      updated_at = now()
                    WHERE id = %s
                      AND status = 'planning'
                    RETURNING workspace_id
                    """,
                    (
                        AGENT_RETRY_EXHAUSTED_ERROR_CODE,
                        AGENT_RETRY_EXHAUSTED_ERROR_MESSAGE,
                        AGENT_RETRY_EXHAUSTED_ERROR_MESSAGE,
                        run_id,
                    ),
                ).fetchone()

                if run is None:
                    return False

                self.connection.execute(
                    """
                    UPDATE agent_steps
                    SET
                      status = 'failed',
                      error_code = %s,
                      error_message = %s,
                      completed_at = now(),
                      updated_at = now()
                    WHERE run_id = %s
                      AND step_type = 'planner'
                      AND status = 'running'
                    """,
                    (
                        AGENT_RETRY_EXHAUSTED_ERROR_CODE,
                        AGENT_RETRY_EXHAUSTED_ERROR_MESSAGE,
                        run_id,
                    ),
                )
                self.connection.execute(
                    """
                    INSERT INTO agent_logs (
                      workspace_id,
                      run_id,
                      actor_type,
                      level,
                      event_type,
                      message,
                      metadata_json,
                      resource_refs
                    )
                    VALUES (
                      %s,
                      %s,
                      'system',
                      'error',
                      'planner_retry_exhausted',
                      %s,
                      %s::jsonb,
                      '[]'::jsonb
                    )
                    """,
                    (
                        str(run["workspace_id"]),
                        run_id,
                        "Agent planner retries exhausted",
                        json.dumps({"maxReceiveCount": AGENT_RETRY_TERMINAL_RECEIVE_COUNT}),
                    ),
                )
                return True
        finally:
            self.release_run_lock(run_id)


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

        if stt_model != "whisper-1":
            raise RuntimeError(
                "OPENAI_STT_MODEL must be whisper-1 for timestamped MeetingReport evidence"
            )
        self.client = OpenAI(api_key=api_key)
        self.stt_model = stt_model
        self.meeting_report_model = meeting_report_model

    def transcribe(self, audio_file_path: str) -> list[TranscriptSegment]:
        try:
            with open(audio_file_path, "rb") as audio_file:
                transcription = self.client.audio.transcriptions.create(
                    model=self.stt_model,
                    file=audio_file,
                    response_format="verbose_json",
                    timestamp_granularities=["segment"],
                )
        except _openai_retryable_errors() as error:
            raise InfrastructureError("OpenAI STT retryable failure") from error
        except Exception as error:
            raise ProviderBusinessError("OpenAI STT business failure") from error

        raw_segments = getattr(transcription, "segments", None)
        if not isinstance(raw_segments, list) or not raw_segments:
            raise ProviderBusinessError("OpenAI STT returned no timestamped segments")
        segments: list[TranscriptSegment] = []
        for index, segment in enumerate(raw_segments):
            text = getattr(segment, "text", None)
            start = getattr(segment, "start", None)
            end = getattr(segment, "end", None)
            if (
                not isinstance(text, str)
                or not isinstance(start, int | float)
                or not isinstance(end, int | float)
            ):
                raise ProviderBusinessError("OpenAI STT returned invalid segment")
            segments.append(
                TranscriptSegment(index, round(start * 1000), round(end * 1000), text.strip())
            )
        return segments

    def generate_report(
        self, transcript_text: str, transcript_segments: list[TranscriptSegment]
    ) -> GeneratedMeetingReport:
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
                        "content": "\n".join(
                            f"[{segment.segment_index}] {segment.text}"
                            for segment in transcript_segments
                        ),
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

        return parse_generated_report_json(output_text, transcript_text, transcript_segments)


class SqsAiJobWorker:
    def __init__(
        self,
        settings: RuntimeSettings,
        dispatcher: JobDispatcher,
        sqs_client: Any,
        canvas_embedding_processor: Any | None = None,
        meeting_transcript_embedding_processor: Any | None = None,
        stale_execution_recovery: Any | None = None,
        agent_retry_exhaustion_recovery: Any | None = None,
        canvas_agent_retry_exhaustion_recovery: Any | None = None,
        pr_review_retry_exhaustion_recovery: Any | None = None,
        monotonic_time: Callable[[], float] = time.monotonic,
    ) -> None:
        self.settings = settings
        self.dispatcher = dispatcher
        self.sqs_client = sqs_client
        self.canvas_embedding_processor = canvas_embedding_processor
        self.meeting_transcript_embedding_processor = meeting_transcript_embedding_processor
        self.stale_execution_recovery = stale_execution_recovery
        self.agent_retry_exhaustion_recovery = agent_retry_exhaustion_recovery
        self.canvas_agent_retry_exhaustion_recovery = canvas_agent_retry_exhaustion_recovery
        self.pr_review_retry_exhaustion_recovery = pr_review_retry_exhaustion_recovery
        self.monotonic_time = monotonic_time
        self.last_stale_execution_sweep_at: float | None = None

    def run_forever(self) -> None:
        LOGGER.info("ai-worker SQS consumer started")
        while True:
            self.run_once()

    def run_once(self) -> int:
        self.recover_stale_executions_if_due()
        self.process_canvas_embedding_jobs()
        self.process_meeting_transcript_embedding_jobs()
        response = self.sqs_client.receive_message(
            QueueUrl=self.settings.sqs_queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=self.settings.wait_time_seconds,
            VisibilityTimeout=self.settings.visibility_timeout_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        messages = response.get("Messages", [])

        for message in messages:
            body = message.get("Body", "")
            receipt_handle = message.get("ReceiptHandle")
            meeting_correlation = _meeting_report_correlation(body)
            if meeting_correlation is not None:
                LOGGER.info(
                    "meeting report job event=received report_id=%s meeting_id=%s "
                    "recording_id=%s retry_count=%s sqs_message_id=%s receive_count=%s",
                    meeting_correlation["report_id"],
                    meeting_correlation["meeting_id"],
                    meeting_correlation["recording_id"],
                    meeting_correlation["retry_count"],
                    message.get("MessageId"),
                    self._receive_count(message),
                )
            result = self.dispatcher.process_message(body)

            if meeting_correlation is not None:
                LOGGER.info(
                    "meeting report job event=processed report_id=%s meeting_id=%s "
                    "recording_id=%s retry_count=%s reason=%s failure_step=%s "
                    "delete_message=%s sqs_message_id=%s receive_count=%s",
                    meeting_correlation["report_id"],
                    meeting_correlation["meeting_id"],
                    meeting_correlation["recording_id"],
                    meeting_correlation["retry_count"],
                    result.reason,
                    MEETING_REPORT_FAILURE_STEPS.get(result.reason, "none"),
                    result.delete_message,
                    message.get("MessageId"),
                    self._receive_count(message),
                )
            else:
                LOGGER.info(
                    "ai job result job_type=%s reason=%s resource_id=%s message_id=%s",
                    result.job_type,
                    result.reason,
                    result.resource_id,
                    message.get("MessageId"),
                )
            should_delete = (
                result.delete_message
                or self._terminalize_agent_retry(result, message)
                or self._terminalize_canvas_agent_retry(result, message)
                or self._terminalize_pr_review_analysis_retry(result, message, body)
            )
            if should_delete and receipt_handle:
                self.sqs_client.delete_message(
                    QueueUrl=self.settings.sqs_queue_url,
                    ReceiptHandle=receipt_handle,
                )

        return len(messages)

    def process_canvas_embedding_jobs(self) -> int:
        if self.canvas_embedding_processor is None:
            return 0

        processed = 0
        for _ in range(self.settings.canvas_embedding_jobs_per_tick):
            try:
                result = self.canvas_embedding_processor.process_next()
            except InfrastructureError:
                LOGGER.exception("Canvas embedding job processing failed")
                break
            except Exception:
                LOGGER.exception("Unexpected Canvas embedding job failure")
                break
            if result is None:
                break

            processed += 1
            LOGGER.info("canvas embedding job result reason=%s", result)

        return processed

    def process_meeting_transcript_embedding_jobs(self) -> int:
        if self.meeting_transcript_embedding_processor is None:
            return 0

        processed = 0
        for _ in range(self.settings.meeting_transcript_embedding_jobs_per_tick):
            try:
                result = self.meeting_transcript_embedding_processor.process_next()
            except InfrastructureError:
                LOGGER.exception("Meeting transcript embedding job processing failed")
                break
            except Exception:
                LOGGER.exception("Unexpected Meeting transcript embedding job failure")
                break
            if result is None:
                break

            processed += 1
            LOGGER.info("meeting transcript embedding job result reason=%s", result)

        return processed

    def _terminalize_agent_retry(self, result: Any, message: dict[str, Any]) -> bool:
        if (
            self.agent_retry_exhaustion_recovery is None
            or result.job_type != "agent_run_requested"
            or result.reason != "infrastructure_failure"
            or not result.resource_id
            or self._receive_count(message) < AGENT_RETRY_TERMINAL_RECEIVE_COUNT
        ):
            return False

        try:
            return bool(
                self.agent_retry_exhaustion_recovery.fail_planning_after_retry_exhaustion(
                    result.resource_id
                )
            )
        except Exception:
            LOGGER.exception(
                "Agent retry terminalization failed run_id=%s message_id=%s",
                result.resource_id,
                message.get("MessageId"),
            )
            return False

    def _terminalize_canvas_agent_retry(self, result: Any, message: dict[str, Any]) -> bool:
        if (
            self.canvas_agent_retry_exhaustion_recovery is None
            or result.job_type != "canvas_agent_step_requested"
            or result.reason != "infrastructure_failure"
            or not result.resource_id
            or self._receive_count(message) < CANVAS_AGENT_RETRY_TERMINAL_RECEIVE_COUNT
        ):
            return False

        try:
            return bool(
                self.canvas_agent_retry_exhaustion_recovery.fail_planning_after_retry_exhaustion(
                    result.resource_id
                )
            )
        except Exception:
            LOGGER.exception(
                "Canvas Agent retry terminalization failed run_id=%s message_id=%s",
                result.resource_id,
                message.get("MessageId"),
            )
            return False

    def _terminalize_pr_review_analysis_retry(
        self,
        result: Any,
        message: dict[str, Any],
        body: str,
    ) -> bool:
        if (
            self.pr_review_retry_exhaustion_recovery is None
            or result.job_type != "pr_review_analysis_requested"
            or result.reason != "infrastructure_failure"
            or self._receive_count(message) < PR_REVIEW_ANALYSIS_RETRY_TERMINAL_RECEIVE_COUNT
        ):
            return False

        try:
            return bool(self.pr_review_retry_exhaustion_recovery.terminalize_retry_exhaustion(body))
        except Exception:
            LOGGER.exception(
                "PR Review analysis retry terminalization failed message_id=%s",
                message.get("MessageId"),
            )
            return False

    @staticmethod
    def _receive_count(message: dict[str, Any]) -> int:
        attributes = message.get("Attributes")
        if not isinstance(attributes, dict):
            return 0

        raw_count = attributes.get("ApproximateReceiveCount")
        try:
            return int(raw_count)
        except (TypeError, ValueError):
            return 0

    def recover_stale_executions_if_due(self) -> None:
        if self.stale_execution_recovery is None:
            return

        now = self.monotonic_time()
        if (
            self.last_stale_execution_sweep_at is not None
            and now - self.last_stale_execution_sweep_at
            < self.settings.agent_stale_execution_sweep_interval_seconds
        ):
            return

        self.last_stale_execution_sweep_at = now
        try:
            self.stale_execution_recovery.recover_stale_executions()
        except InfrastructureError:
            LOGGER.exception("stale Agent execution recovery failed")


class HttpAgentExecutionHandoffClient(AgentExecutionHandoffClient):
    def __init__(self, base_url: str, token: str, timeout_seconds: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds

    def execute(self, run_id: str) -> None:
        self._post(f"/api/v1/internal/agent/runs/{run_id}/execution")

    def recover_stale_executions(self) -> None:
        self._post("/api/v1/internal/agent/stale-executions/recover")

    def _post(self, path: str) -> None:
        request = Request(
            f"{self.base_url}{path}",
            data=b"",
            headers={
                "X-Agent-Execution-Handoff-Token": self.token,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds):
                return
        except HTTPError as error:
            raise InfrastructureError(
                f"Agent execution handoff returned HTTP {error.code}"
            ) from error
        except (OSError, TimeoutError, URLError) as error:
            raise InfrastructureError("Agent execution handoff is unavailable") from error


class HttpMeetingReportEventPublisher(MeetingReportEventPublisher):
    def __init__(
        self,
        base_url: str,
        token: str,
        timeout_seconds: int,
        max_attempts: int = DEFAULT_MEETING_REPORT_EVENT_MAX_ATTEMPTS,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds
        self.max_attempts = max_attempts

    def publish(self, report_id: str) -> None:
        request = Request(
            f"{self.base_url}/api/v1/internal/meeting-reports/events",
            data=json.dumps({"reportId": report_id}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Meeting-Report-Event-Token": self.token,
            },
            method="POST",
        )
        last_error: HTTPError | OSError | TimeoutError | URLError | None = None
        for attempt in range(self.max_attempts):
            try:
                with urlopen(request, timeout=self.timeout_seconds):
                    return
            except HTTPError as error:
                if 400 <= error.code < 500:
                    raise InfrastructureError(
                        f"MeetingReport event delivery returned HTTP {error.code}"
                    ) from error
                last_error = error
            except (OSError, TimeoutError, URLError) as error:
                last_error = error

            if attempt < self.max_attempts - 1:
                time.sleep(0.25 * (2**attempt))

        raise InfrastructureError("MeetingReport event delivery is unavailable") from last_error


def create_worker(settings: RuntimeSettings | None = None) -> SqsAiJobWorker:
    import boto3

    resolved_settings = settings or RuntimeSettings.from_env()
    boto_kwargs = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    sqs_client = boto3.client("sqs", **boto_kwargs)
    s3_client = boto3.client("s3", **boto_kwargs)
    meeting_report_repository = PgMeetingReportRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    agent_run_repository = PgAgentRunRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    canvas_agent_repository = PgCanvasAgentRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    meeting_transcript_embedding_repository = PgMeetingTranscriptEmbeddingRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    storage = S3RecordingStorage(s3_client, resolved_settings.recordings_bucket)
    ai_client = OpenAiMeetingReportClient(
        resolved_settings.openai_api_key,
        resolved_settings.openai_stt_model,
        resolved_settings.openai_meeting_report_model,
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
    meeting_report_event_publisher = HttpMeetingReportEventPublisher(
        _require_env("MEETING_REPORT_EVENT_BASE_URL"),
        _require_env("MEETING_REPORT_EVENT_TOKEN"),
        _positive_int_env("MEETING_REPORT_EVENT_TIMEOUT_SECONDS", 10),
        _positive_int_env(
            "MEETING_REPORT_EVENT_MAX_ATTEMPTS",
            DEFAULT_MEETING_REPORT_EVENT_MAX_ATTEMPTS,
        ),
    )
    meeting_report_processor = MeetingReportProcessor(
        meeting_report_repository,
        storage,
        ai_client,
        meeting_report_event_publisher,
    )
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
    canvas_embedding_processor = CanvasEmbeddingProcessor(canvas_agent_repository, canvas_embedder)
    meeting_transcript_embedder = OpenAiTranscriptEmbedder(
        resolved_settings.openai_api_key,
        resolved_settings.openai_meeting_transcript_embedding_model,
    )
    meeting_transcript_embedding_processor = MeetingTranscriptEmbeddingProcessor(
        meeting_transcript_embedding_repository,
        meeting_transcript_embedder,
    )
    dispatcher = JobDispatcher(
        meeting_report_processor,
        agent_run_processor,
        canvas_agent_processor,
    )
    return SqsAiJobWorker(
        resolved_settings,
        dispatcher,
        sqs_client,
        canvas_embedding_processor=canvas_embedding_processor,
        meeting_transcript_embedding_processor=meeting_transcript_embedding_processor,
        stale_execution_recovery=agent_execution_handoff_client,
        agent_retry_exhaustion_recovery=agent_run_repository,
    )


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


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(format(value, ".9g") for value in values) + "]"


def _meeting_report_correlation(message_body: object) -> dict[str, str | int] | None:
    if not isinstance(message_body, str):
        return None

    try:
        payload = json.loads(message_body)
    except json.JSONDecodeError:
        return None

    if not isinstance(payload, dict) or payload.get("jobType") != "meeting_report":
        return None

    report_id = payload.get("reportId")
    meeting_id = payload.get("meetingId")
    recording_id = payload.get("recordingId")
    retry_count = payload.get("retryCount")
    if (
        not isinstance(report_id, str)
        or not isinstance(meeting_id, str)
        or not isinstance(recording_id, str)
        or not isinstance(retry_count, int)
        or isinstance(retry_count, bool)
    ):
        return None

    return {
        "report_id": report_id,
        "meeting_id": meeting_id,
        "recording_id": recording_id,
        "retry_count": retry_count,
    }


def _env(key: str, default: str) -> str:
    value = os.getenv(key)
    if value is None or not value.strip():
        return default
    return value.strip()


def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if value is not None and value.strip():
        return value.strip()

    if _requires_database_url():
        raise RuntimeError("DATABASE_URL is required outside local ai-worker environments")

    return DEFAULT_DATABASE_URL


def _requires_database_url() -> bool:
    app_env = os.getenv("APP_ENV", "").strip().lower()
    if app_env:
        return app_env not in LOCAL_APP_ENVS

    return os.getenv("NODE_ENV", "").strip().lower() == "production"


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


def _positive_ms_env(key: str, default: int) -> float:
    return _positive_int_env(key, default) / 1_000


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
            "evidence",
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
            "evidence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["sourceType", "sourceIndex", "segmentIndexes"],
                    "properties": {
                        "sourceType": {
                            "type": "string",
                            "enum": ["summary", "discussion", "decision", "action_item"],
                        },
                        "sourceIndex": {"type": "integer", "minimum": 0},
                        "segmentIndexes": {
                            "type": "array",
                            "items": {"type": "integer", "minimum": 0},
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
