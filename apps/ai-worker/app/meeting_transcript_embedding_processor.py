from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from app.embedding_failure import (
    RetryableEmbeddingError,
    TerminalEmbeddingError,
    classify_openai_embedding_error,
)

TRANSCRIPT_CHUNK_MAX_CHARACTERS = 1_800
OPENAI_TRANSCRIPT_EMBEDDING_MODEL = "text-embedding-3-small"
OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS = 1_536


class TranscriptEmbeddingError(TerminalEmbeddingError):
    pass


class TranscriptEmbedder(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    def embed_passage(self, text: str) -> list[float]: ...


class OpenAiTranscriptEmbedder:
    model_version = "openai-api"

    def __init__(
        self,
        api_key: str,
        model_name: str = OPENAI_TRANSCRIPT_EMBEDDING_MODEL,
        timeout_seconds: float = 30.0,
    ) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key, timeout=timeout_seconds)
        self.model_name = model_name

    def embed_passage(self, text: str) -> list[float]:
        normalized = " ".join(text.split())
        if not normalized:
            raise TranscriptEmbeddingError("Transcript embedding text is empty")

        try:
            response = self.client.embeddings.create(
                input=normalized,
                model=self.model_name,
                dimensions=OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS,
                encoding_format="float",
            )
            vector = [float(value) for value in response.data[0].embedding]
        except Exception as error:
            raise classify_openai_embedding_error(error) from error

        if len(vector) != OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS:
            raise TranscriptEmbeddingError("OpenAI transcript embedding dimension is invalid")
        if any(not _is_finite(value) for value in vector):
            raise TranscriptEmbeddingError(
                "OpenAI transcript embedding contains a non-finite value"
            )
        return vector


@dataclass(frozen=True)
class TranscriptSourceSegment:
    segment_index: int
    started_at_ms: int
    ended_at_ms: int
    text: str


@dataclass(frozen=True)
class TranscriptChunk:
    chunk_index: int
    start_segment_index: int
    end_segment_index: int
    started_at_ms: int
    ended_at_ms: int
    content: str
    content_hash: str


class MeetingTranscriptEmbeddingRepository(Protocol):
    def claim_transcript_embedding_job(self) -> dict[str, object] | None: ...

    def get_transcript_embedding_source(
        self, job: dict[str, object]
    ) -> dict[str, object] | None: ...

    def replace_transcript_chunks(
        self,
        job: dict[str, object],
        chunks: list[TranscriptChunk],
        embeddings: list[list[float]],
        model_name: str,
        model_version: str,
    ) -> bool: ...

    def complete_transcript_embedding_job(self, job_id: str) -> None: ...

    def supersede_transcript_embedding_job(self, job_id: str) -> None: ...

    def fail_transcript_embedding_job(self, job_id: str, message: str) -> None: ...

    def requeue_transcript_embedding_job(self, job_id: str, message: str) -> None: ...


class MeetingTranscriptEmbeddingProcessor:
    def __init__(
        self,
        repository: MeetingTranscriptEmbeddingRepository,
        embedder: TranscriptEmbedder,
    ) -> None:
        self.repository = repository
        self.embedder = embedder

    def process_next(self) -> str | None:
        job = self.repository.claim_transcript_embedding_job()
        if job is None:
            return None

        job_id = str(job["id"])
        try:
            source = self.repository.get_transcript_embedding_source(job)
            if source is None or source.get("transcript_hash") != job.get("transcript_hash"):
                self.repository.supersede_transcript_embedding_job(job_id)
                return "meeting_transcript_embedding_superseded"

            chunks = chunk_transcript_segments(_source_segments(source))
            embeddings = [self.embedder.embed_passage(chunk.content) for chunk in chunks]
            if not self.repository.replace_transcript_chunks(
                job,
                chunks,
                embeddings,
                self.embedder.model_name,
                self.embedder.model_version,
            ):
                self.repository.supersede_transcript_embedding_job(job_id)
                return "meeting_transcript_embedding_superseded"

            self.repository.complete_transcript_embedding_job(job_id)
            return "meeting_transcript_embedding_completed"
        except RetryableEmbeddingError:
            if int(job.get("attempt_count", 1)) < 3:
                self.repository.requeue_transcript_embedding_job(
                    job_id,
                    "Meeting transcript embedding is temporarily unavailable",
                )
                return "meeting_transcript_embedding_retryable_failure"
            self.repository.fail_transcript_embedding_job(
                job_id,
                "Meeting transcript embedding retry limit was reached",
            )
            return "meeting_transcript_embedding_retry_exhausted"
        except TerminalEmbeddingError as error:
            self.repository.fail_transcript_embedding_job(job_id, str(error))
            return "meeting_transcript_embedding_failed"
        except Exception:
            self.repository.fail_transcript_embedding_job(
                job_id,
                "Meeting transcript embedding failed",
            )
            return "meeting_transcript_embedding_failed"


def chunk_transcript_segments(
    segments: Sequence[TranscriptSourceSegment],
    *,
    max_characters: int = TRANSCRIPT_CHUNK_MAX_CHARACTERS,
) -> list[TranscriptChunk]:
    if max_characters <= 0:
        raise ValueError("Invalid transcript chunking configuration")

    chunks: list[TranscriptChunk] = []
    pending: list[TranscriptSourceSegment] = []
    pending_length = 0

    def flush() -> None:
        nonlocal pending, pending_length
        if not pending:
            return
        content = "\n".join(segment.text.strip() for segment in pending).strip()
        if content:
            chunks.append(
                TranscriptChunk(
                    chunk_index=len(chunks),
                    start_segment_index=pending[0].segment_index,
                    end_segment_index=pending[-1].segment_index,
                    started_at_ms=pending[0].started_at_ms,
                    ended_at_ms=pending[-1].ended_at_ms,
                    content=content,
                    content_hash=transcript_hash(content),
                )
            )
        pending = []
        pending_length = 0

    for segment in sorted(segments, key=lambda value: value.segment_index):
        text = " ".join(segment.text.split())
        if not text:
            continue
        if len(text) > max_characters:
            flush()
            for part in _split_oversized_segment(text, max_characters):
                chunks.append(
                    TranscriptChunk(
                        chunk_index=len(chunks),
                        start_segment_index=segment.segment_index,
                        end_segment_index=segment.segment_index,
                        started_at_ms=segment.started_at_ms,
                        ended_at_ms=segment.ended_at_ms,
                        content=part,
                        content_hash=transcript_hash(part),
                    )
                )
            continue

        additional_length = len(text) + (1 if pending else 0)
        if pending and pending_length + additional_length > max_characters:
            flush()
        pending.append(
            TranscriptSourceSegment(
                segment.segment_index,
                segment.started_at_ms,
                segment.ended_at_ms,
                text,
            )
        )
        pending_length += len(text) + (1 if len(pending) > 1 else 0)

    flush()
    return chunks


def transcript_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def transcript_segments_hash(segments: Sequence[object]) -> str:
    canonical_segments = sorted(
        (_segment_from_value(segment) for segment in segments),
        key=lambda value: value.segment_index,
    )
    canonical = "\n".join(
        (
            f"{segment.segment_index}\x1f{segment.started_at_ms}\x1f"
            f"{segment.ended_at_ms}\x1f{segment.text}"
        )
        for segment in canonical_segments
    )
    return transcript_hash(canonical)


def _source_segments(source: Mapping[str, object]) -> list[TranscriptSourceSegment]:
    values = source.get("segments")
    if not isinstance(values, list):
        raise ValueError("Transcript embedding source is missing segments")
    return [_segment_from_value(value) for value in values]


def _segment_from_value(value: object) -> TranscriptSourceSegment:
    if isinstance(value, Mapping):
        return TranscriptSourceSegment(
            int(value["segment_index"]),
            int(value["started_at_ms"]),
            int(value["ended_at_ms"]),
            str(value["text"]),
        )
    return TranscriptSourceSegment(
        int(value.segment_index),
        int(value.started_at_ms),
        int(value.ended_at_ms),
        str(value.text),
    )


def _split_oversized_segment(value: str, max_characters: int) -> list[str]:
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
    if not matches:
        return end
    return start + matches[-1].end()


def _is_finite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))
