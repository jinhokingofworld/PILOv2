from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

LOGGER = logging.getLogger(__name__)

DEFAULT_AWS_REGION = "ap-northeast-2"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIMENSIONS = 1_536
DEFAULT_WAIT_TIME_SECONDS = 20
DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 900
DEFAULT_MAX_RECEIVE_COUNT = 3
DOCUMENT_CHUNK_MAX_CHARACTERS = 1_800


@dataclass(frozen=True)
class WorkspaceIndexingMessage:
    version: int
    source: str
    job_id: str


@dataclass(frozen=True)
class DocumentEmbeddingSource:
    snapshot_id: str
    plain_text: str


@dataclass(frozen=True)
class DocumentEmbeddingChunk:
    chunk_index: int
    chunk_text: str
    source_text_hash: str
    heading_path: str = ""


@dataclass(frozen=True)
class DocumentEmbeddingProcessResult:
    delete_message: bool
    reason: str
    job_id: str | None = None


@dataclass(frozen=True)
class WorkspaceIndexingWorkerSettings:
    aws_region: str
    sqs_queue_url: str
    sqs_endpoint: str | None
    database_url: str
    database_ssl: bool
    openai_api_key: str
    embedding_model: str
    wait_time_seconds: int
    visibility_timeout_seconds: int

    @classmethod
    def from_env(cls) -> WorkspaceIndexingWorkerSettings:
        return cls(
            aws_region=_env("AWS_REGION", DEFAULT_AWS_REGION),
            sqs_queue_url=_require_env("SQS_WORKSPACE_INDEXING_QUEUE_URL"),
            sqs_endpoint=_optional_env("SQS_ENDPOINT"),
            database_url=_require_env("DATABASE_URL"),
            database_ssl=_env("DATABASE_SSL", "false").lower() == "true",
            openai_api_key=_require_env("OPENAI_API_KEY"),
            embedding_model=_env(
                "OPENAI_WORKSPACE_INDEXING_EMBEDDING_MODEL",
                DEFAULT_EMBEDDING_MODEL,
            ),
            wait_time_seconds=_positive_int_env(
                "AI_WORKER_SQS_WAIT_TIME_SECONDS", DEFAULT_WAIT_TIME_SECONDS
            ),
            visibility_timeout_seconds=_positive_int_env(
                "AI_WORKER_SQS_VISIBILITY_TIMEOUT_SECONDS",
                DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
            ),
        )


class DocumentEmbeddingError(Exception):
    pass


class DocumentEmbedder(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def model_version(self) -> int: ...

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]: ...


class DocumentEmbeddingRepository(Protocol):
    def claim_document_embedding_job(self, job_id: str) -> dict[str, object] | None: ...

    def get_document_embedding_source(
        self, job: dict[str, object]
    ) -> DocumentEmbeddingSource | None: ...

    def replace_document_embedding_chunks(
        self,
        job: dict[str, object],
        chunks: Sequence[DocumentEmbeddingChunk],
        embeddings: Sequence[list[float]],
        model_name: str,
        model_version: int,
    ) -> bool: ...

    def complete_document_embedding_job(self, job_id: str) -> None: ...

    def supersede_document_embedding_job(self, job_id: str) -> None: ...

    def requeue_document_embedding_job(self, job_id: str, message: str) -> None: ...

    def fail_document_embedding_job(self, job_id: str, message: str) -> None: ...


class OpenAiDocumentEmbedder:
    model_version = 1

    def __init__(self, api_key: str, model_name: str = DEFAULT_EMBEDDING_MODEL) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key)
        self.model_name = model_name

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        normalized = [" ".join(text.split()) for text in texts]
        if not normalized or any(not text for text in normalized):
            raise DocumentEmbeddingError("Document embedding text is empty")

        try:
            response = self.client.embeddings.create(
                input=normalized,
                model=self.model_name,
                dimensions=DEFAULT_EMBEDDING_DIMENSIONS,
                encoding_format="float",
            )
            vectors = [[float(value) for value in item.embedding] for item in response.data]
        except Exception as error:
            raise DocumentEmbeddingError("OpenAI document embedding failed") from error

        if len(vectors) != len(normalized):
            raise DocumentEmbeddingError("OpenAI document embedding response count is invalid")
        if any(
            len(vector) != DEFAULT_EMBEDDING_DIMENSIONS
            or any(not _is_finite(value) for value in vector)
            for vector in vectors
        ):
            raise DocumentEmbeddingError("OpenAI document embedding vector is invalid")
        return vectors


class PgDocumentEmbeddingRepository:
    def __init__(self, database_url: str, database_ssl: bool) -> None:
        import psycopg
        from psycopg.rows import dict_row

        kwargs: dict[str, Any] = {"autocommit": True, "row_factory": dict_row}
        if database_ssl:
            kwargs["sslmode"] = "require"
        self.connection = psycopg.connect(database_url, **kwargs)

    def close(self) -> None:
        self.connection.close()

    def claim_document_embedding_job(self, job_id: str) -> dict[str, object] | None:
        with self.connection.transaction():
            return self.connection.execute(
                """
                WITH candidate AS (
                  SELECT job.id
                  FROM document_embedding_jobs AS job
                  INNER JOIN documents AS document
                    ON document.id = job.document_id
                    AND document.workspace_id = job.workspace_id
                  WHERE job.id = %s
                    AND document.deleted_at IS NULL
                    AND document.latest_snapshot_id = job.snapshot_id
                    AND (
                      job.status = 'queued'
                      OR (
                        job.status = 'processing'
                        AND job.claimed_at <= now() - INTERVAL '15 minutes'
                      )
                    )
                  FOR UPDATE OF job SKIP LOCKED
                )
                UPDATE document_embedding_jobs AS job
                SET status = 'processing',
                    attempt_count = job.attempt_count + 1,
                    claimed_at = now(),
                    completed_at = NULL,
                    error_code = NULL,
                    error_message = NULL
                FROM candidate
                WHERE job.id = candidate.id
                RETURNING job.id, job.workspace_id, job.document_id, job.snapshot_id
                """,
                (job_id,),
            ).fetchone()

    def get_document_embedding_source(
        self, job: dict[str, object]
    ) -> DocumentEmbeddingSource | None:
        row = self.connection.execute(
            """
            SELECT snapshot.id, snapshot.plain_text
            FROM document_snapshots AS snapshot
            INNER JOIN documents AS document
              ON document.id = snapshot.document_id
              AND document.workspace_id = snapshot.workspace_id
            WHERE snapshot.id = %s
              AND snapshot.document_id = %s
              AND snapshot.workspace_id = %s
              AND document.deleted_at IS NULL
              AND document.latest_snapshot_id = snapshot.id
            LIMIT 1
            """,
            (job["snapshot_id"], job["document_id"], job["workspace_id"]),
        ).fetchone()
        if row is None:
            return None
        return DocumentEmbeddingSource(
            snapshot_id=str(row["id"]),
            plain_text=str(row["plain_text"]),
        )

    def replace_document_embedding_chunks(
        self,
        job: dict[str, object],
        chunks: Sequence[DocumentEmbeddingChunk],
        embeddings: Sequence[list[float]],
        model_name: str,
        model_version: int,
    ) -> bool:
        if len(chunks) != len(embeddings):
            return False

        with self.connection.transaction():
            current = self.connection.execute(
                """
                SELECT 1
                FROM document_embedding_jobs AS job
                INNER JOIN documents AS document
                  ON document.id = job.document_id
                  AND document.workspace_id = job.workspace_id
                WHERE job.id = %s
                  AND job.status = 'processing'
                  AND document.deleted_at IS NULL
                  AND document.latest_snapshot_id = job.snapshot_id
                FOR SHARE OF job, document
                """,
                (job["id"],),
            ).fetchone()
            if current is None:
                return False

            self.connection.execute(
                "DELETE FROM document_embedding_chunks WHERE snapshot_id = %s",
                (job["snapshot_id"],),
            )
            for chunk, embedding in zip(chunks, embeddings, strict=True):
                self.connection.execute(
                    """
                    INSERT INTO document_embedding_chunks (
                      workspace_id,
                      document_id,
                      snapshot_id,
                      chunk_index,
                      heading_path,
                      chunk_text,
                      source_text_hash,
                      embedding,
                      embedding_model,
                      embedding_version
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::extensions.vector, %s, %s)
                    """,
                    (
                        job["workspace_id"],
                        job["document_id"],
                        job["snapshot_id"],
                        chunk.chunk_index,
                        chunk.heading_path,
                        chunk.chunk_text,
                        chunk.source_text_hash,
                        _vector_literal(embedding),
                        model_name,
                        model_version,
                    ),
                )
        return True

    def complete_document_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE document_embedding_jobs
            SET status = 'completed', completed_at = now(), claimed_at = NULL
            WHERE id = %s AND status = 'processing'
            """,
            (job_id,),
        )

    def supersede_document_embedding_job(self, job_id: str) -> None:
        self.connection.execute(
            """
            UPDATE document_embedding_jobs
            SET status = 'superseded', completed_at = now(), claimed_at = NULL
            WHERE id = %s AND status = 'processing'
            """,
            (job_id,),
        )

    def requeue_document_embedding_job(self, job_id: str, message: str) -> None:
        self.connection.execute(
            """
            UPDATE document_embedding_jobs
            SET status = 'queued',
                claimed_at = NULL,
                error_code = 'DOCUMENT_EMBEDDING_RETRYABLE_FAILURE',
                error_message = %s
            WHERE id = %s AND status = 'processing'
            """,
            (message[:4096], job_id),
        )

    def fail_document_embedding_job(self, job_id: str, message: str) -> None:
        self.connection.execute(
            """
            UPDATE document_embedding_jobs
            SET status = 'failed',
                completed_at = now(),
                claimed_at = NULL,
                error_code = 'DOCUMENT_EMBEDDING_RETRY_EXHAUSTED',
                error_message = %s
            WHERE id = %s AND status IN ('queued', 'processing')
            """,
            (message[:4096], job_id),
        )


class DocumentEmbeddingProcessor:
    def __init__(self, repository: DocumentEmbeddingRepository, embedder: DocumentEmbedder) -> None:
        self.repository = repository
        self.embedder = embedder

    def process(self, job_id: str) -> str:
        job = self.repository.claim_document_embedding_job(job_id)
        if job is None:
            return "document_embedding_not_current"

        try:
            source = self.repository.get_document_embedding_source(job)
            if source is None or source.snapshot_id != str(job["snapshot_id"]):
                self.repository.supersede_document_embedding_job(str(job["id"]))
                return "document_embedding_superseded"

            chunks = chunk_document_text(source.plain_text)
            embeddings = (
                self.embedder.embed_passages([chunk.chunk_text for chunk in chunks])
                if chunks
                else []
            )
            if not self.repository.replace_document_embedding_chunks(
                job,
                chunks,
                embeddings,
                self.embedder.model_name,
                self.embedder.model_version,
            ):
                self.repository.supersede_document_embedding_job(str(job["id"]))
                return "document_embedding_superseded"

            self.repository.complete_document_embedding_job(str(job["id"]))
            return "document_embedding_completed"
        except Exception:
            self.repository.requeue_document_embedding_job(
                str(job["id"]),
                "Document embedding could not be completed",
            )
            return "document_embedding_retryable_failure"

    def fail_after_retry_exhaustion(self, job_id: str) -> None:
        self.repository.fail_document_embedding_job(
            job_id,
            "Document embedding retry limit was reached",
        )


class WorkspaceIndexingWorker:
    def __init__(
        self,
        settings: WorkspaceIndexingWorkerSettings,
        processor: DocumentEmbeddingProcessor,
        sqs_client: Any,
    ) -> None:
        self.settings = settings
        self.processor = processor
        self.sqs_client = sqs_client

    def run_forever(self) -> None:
        LOGGER.info("workspace-indexing-worker SQS consumer started")
        while True:
            self.run_once()

    def run_once(self) -> int:
        response = self.sqs_client.receive_message(
            QueueUrl=self.settings.sqs_queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=self.settings.wait_time_seconds,
            VisibilityTimeout=self.settings.visibility_timeout_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        messages = response.get("Messages", [])
        for message in messages:
            self._process_message(message)
        return len(messages)

    def _process_message(self, message: dict[str, object]) -> None:
        raw_body = message.get("Body")
        parsed = parse_workspace_indexing_message(raw_body)
        if parsed is None:
            self._delete_message(message)
            LOGGER.warning("workspace indexing job dropped reason=invalid_message")
            return
        if parsed.source != "document":
            LOGGER.warning("workspace indexing job deferred source=%s", parsed.source)
            return

        reason = self.processor.process(parsed.job_id)
        retryable = reason == "document_embedding_retryable_failure"
        if retryable and self._receive_count(message) >= DEFAULT_MAX_RECEIVE_COUNT:
            self.processor.fail_after_retry_exhaustion(parsed.job_id)
            retryable = False
            reason = "document_embedding_retry_exhausted"

        LOGGER.info(
            "workspace indexing job result source=document job_id=%s reason=%s message_id=%s",
            parsed.job_id,
            reason,
            message.get("MessageId"),
        )
        if not retryable:
            self._delete_message(message)

    def _delete_message(self, message: dict[str, object]) -> None:
        receipt_handle = message.get("ReceiptHandle")
        if isinstance(receipt_handle, str) and receipt_handle:
            self.sqs_client.delete_message(
                QueueUrl=self.settings.sqs_queue_url,
                ReceiptHandle=receipt_handle,
            )

    def _receive_count(self, message: dict[str, object]) -> int:
        attributes = message.get("Attributes")
        if not isinstance(attributes, dict):
            return 1
        value = attributes.get("ApproximateReceiveCount")
        try:
            return max(int(value), 1)
        except (TypeError, ValueError):
            return 1


def create_workspace_indexing_worker(
    settings: WorkspaceIndexingWorkerSettings | None = None,
) -> WorkspaceIndexingWorker:
    import boto3

    resolved_settings = settings or WorkspaceIndexingWorkerSettings.from_env()
    boto_kwargs: dict[str, str] = {"region_name": resolved_settings.aws_region}
    if resolved_settings.sqs_endpoint:
        boto_kwargs["endpoint_url"] = resolved_settings.sqs_endpoint

    repository = PgDocumentEmbeddingRepository(
        resolved_settings.database_url,
        resolved_settings.database_ssl,
    )
    processor = DocumentEmbeddingProcessor(
        repository,
        OpenAiDocumentEmbedder(
            resolved_settings.openai_api_key,
            resolved_settings.embedding_model,
        ),
    )
    return WorkspaceIndexingWorker(
        resolved_settings,
        processor,
        boto3.client("sqs", **boto_kwargs),
    )


def run_workspace_indexing_worker() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    worker = create_workspace_indexing_worker()
    LOGGER.info("workspace-indexing-worker initialized")
    worker.run_forever()


def parse_workspace_indexing_message(value: object) -> WorkspaceIndexingMessage | None:
    if not isinstance(value, str):
        return None
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    version = payload.get("version")
    source = payload.get("source")
    job_id = payload.get("jobId")
    if version != 1 or not isinstance(source, str) or not isinstance(job_id, str):
        return None
    if source not in {"document", "calendar"} or not job_id.strip():
        return None
    return WorkspaceIndexingMessage(version=version, source=source, job_id=job_id.strip())


def chunk_document_text(
    text: str,
    *,
    max_characters: int = DOCUMENT_CHUNK_MAX_CHARACTERS,
) -> list[DocumentEmbeddingChunk]:
    if max_characters <= 0:
        raise ValueError("Invalid document chunking configuration")

    normalized = text.strip()
    if not normalized:
        return []

    chunks: list[DocumentEmbeddingChunk] = []
    pending = ""
    for paragraph in re.split(r"\n\s*\n+", normalized):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) > max_characters:
            if pending:
                _append_document_chunk(chunks, pending)
                pending = ""
            for part in _split_oversized_text(paragraph, max_characters):
                _append_document_chunk(chunks, part)
            continue

        candidate = paragraph if not pending else f"{pending}\n\n{paragraph}"
        if pending and len(candidate) > max_characters:
            _append_document_chunk(chunks, pending)
            pending = paragraph
        else:
            pending = candidate

    if pending:
        _append_document_chunk(chunks, pending)
    return chunks


def _append_document_chunk(chunks: list[DocumentEmbeddingChunk], text: str) -> None:
    chunk_text = text.strip()
    if not chunk_text:
        return
    chunks.append(
        DocumentEmbeddingChunk(
            chunk_index=len(chunks),
            chunk_text=chunk_text,
            source_text_hash=_sha256(chunk_text),
        )
    )


def _split_oversized_text(value: str, max_characters: int) -> list[str]:
    parts: list[str] = []
    start = 0
    while start < len(value):
        end = min(start + max_characters, len(value))
        if end < len(value):
            boundary = _last_boundary(value, start, end)
            if boundary > start:
                end = boundary
        part = value[start:end].strip()
        if part:
            parts.append(part)
        start = end
    return parts


def _last_boundary(value: str, start: int, end: int) -> int:
    matches = list(re.finditer(r"[.!?。！？]\s+|\s+", value[start:end]))
    return end if not matches else start + matches[-1].end()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(format(value, ".9g") for value in values) + "]"


def _is_finite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))


def _env(key: str, default: str) -> str:
    value = os.getenv(key)
    return value.strip() if value and value.strip() else default


def _optional_env(key: str) -> str | None:
    value = os.getenv(key)
    return value.strip() if value and value.strip() else None


def _require_env(key: str) -> str:
    value = _optional_env(key)
    if value is None:
        raise RuntimeError(f"{key} is required")
    return value


def _positive_int_env(key: str, default: int) -> int:
    value = _optional_env(key)
    if value is None:
        return default
    try:
        return max(int(value), 1)
    except ValueError:
        return default


if __name__ == "__main__":
    run_workspace_indexing_worker()
