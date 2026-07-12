from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Protocol

from app.canvas_agent.embeddings import CanvasEmbedder, CanvasEmbeddingError

TRANSCRIPT_CHUNK_MAX_CHARACTERS = 1_800
TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS = 240


@dataclass(frozen=True)
class TranscriptChunk:
    chunk_index: int
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


class MeetingTranscriptEmbeddingProcessor:
    def __init__(
        self,
        repository: MeetingTranscriptEmbeddingRepository,
        embedder: CanvasEmbedder,
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

            chunks = chunk_transcript(str(source["transcript_text"]))
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
        except CanvasEmbeddingError as error:
            self.repository.fail_transcript_embedding_job(job_id, str(error))
            return "meeting_transcript_embedding_failed"
        except Exception:
            self.repository.fail_transcript_embedding_job(
                job_id,
                "Meeting transcript embedding failed",
            )
            return "meeting_transcript_embedding_failed"


def chunk_transcript(
    transcript_text: str,
    *,
    max_characters: int = TRANSCRIPT_CHUNK_MAX_CHARACTERS,
    overlap_characters: int = TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS,
) -> list[TranscriptChunk]:
    normalized = " ".join(transcript_text.split())
    if not normalized:
        return []
    if max_characters <= 0 or overlap_characters < 0 or overlap_characters >= max_characters:
        raise ValueError("Invalid transcript chunking configuration")

    chunks: list[TranscriptChunk] = []
    start = 0
    while start < len(normalized):
        end = min(start + max_characters, len(normalized))
        if end < len(normalized):
            boundary = _last_boundary(normalized, start, end)
            if boundary > start:
                end = boundary

        content = normalized[start:end].strip()
        if content:
            chunks.append(
                TranscriptChunk(
                    chunk_index=len(chunks),
                    content=content,
                    content_hash=hashlib.sha256(content.encode("utf-8")).hexdigest(),
                )
            )
        if end >= len(normalized):
            break
        start = max(end - overlap_characters, start + 1)

    return chunks


def transcript_hash(transcript_text: str) -> str:
    return hashlib.sha256(transcript_text.encode("utf-8")).hexdigest()


def _last_boundary(value: str, start: int, end: int) -> int:
    matches = list(re.finditer(r"[.!?。！？]\s+|\s+", value[start:end]))
    if not matches:
        return end
    return start + matches[-1].end()
