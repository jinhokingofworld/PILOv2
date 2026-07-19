from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.embedding_failure import RetryableEmbeddingError, TerminalEmbeddingError


class ActivityEvidenceEmbedder(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    def embed_passage(self, text: str) -> list[float]: ...


@dataclass(frozen=True)
class ActivityEvidenceSource:
    id: str
    source_index: int
    occurred_at: datetime | str
    action: str
    summary: str


@dataclass(frozen=True)
class ActivityEvidenceChunk:
    activity_evidence_id: str
    source_index: int
    occurred_at: datetime | str
    action: str
    summary: str
    content: str
    content_hash: str


class MeetingActivityEvidenceEmbeddingRepository(Protocol):
    def claim_activity_evidence_embedding_job(self) -> dict[str, object] | None: ...

    def get_activity_evidence_embedding_source(
        self, job: dict[str, object]
    ) -> dict[str, object] | None: ...

    def replace_activity_evidence_chunks(
        self,
        job: dict[str, object],
        chunks: list[ActivityEvidenceChunk],
        embeddings: list[list[float]],
        model_name: str,
        model_version: str,
    ) -> bool: ...

    def complete_activity_evidence_embedding_job(self, job_id: str) -> None: ...

    def supersede_activity_evidence_embedding_job(self, job_id: str) -> None: ...

    def fail_activity_evidence_embedding_job(self, job_id: str, message: str) -> None: ...

    def requeue_activity_evidence_embedding_job(self, job_id: str, message: str) -> None: ...


class MeetingActivityEvidenceEmbeddingProcessor:
    def __init__(
        self,
        repository: MeetingActivityEvidenceEmbeddingRepository,
        embedder: ActivityEvidenceEmbedder,
    ) -> None:
        self.repository = repository
        self.embedder = embedder

    def process_next(self) -> str | None:
        job = self.repository.claim_activity_evidence_embedding_job()
        if job is None:
            return None

        job_id = str(job["id"])
        try:
            source = self.repository.get_activity_evidence_embedding_source(job)
            if source is None or source.get("evidence_hash") != job.get("evidence_hash"):
                self.repository.supersede_activity_evidence_embedding_job(job_id)
                return "meeting_activity_evidence_embedding_superseded"

            chunks = activity_evidence_chunks(_source_evidence(source))
            embeddings = [self.embedder.embed_passage(chunk.content) for chunk in chunks]
            if not self.repository.replace_activity_evidence_chunks(
                job,
                chunks,
                embeddings,
                self.embedder.model_name,
                self.embedder.model_version,
            ):
                self.repository.supersede_activity_evidence_embedding_job(job_id)
                return "meeting_activity_evidence_embedding_superseded"

            self.repository.complete_activity_evidence_embedding_job(job_id)
            return "meeting_activity_evidence_embedding_completed"
        except RetryableEmbeddingError:
            if int(job.get("attempt_count", 1)) < 3:
                self.repository.requeue_activity_evidence_embedding_job(
                    job_id,
                    "Meeting activity evidence embedding is temporarily unavailable",
                )
                return "meeting_activity_evidence_embedding_retryable_failure"
            self.repository.fail_activity_evidence_embedding_job(
                job_id,
                "Meeting activity evidence embedding retry limit was reached",
            )
            return "meeting_activity_evidence_embedding_retry_exhausted"
        except TerminalEmbeddingError as error:
            self.repository.fail_activity_evidence_embedding_job(job_id, str(error))
            return "meeting_activity_evidence_embedding_failed"
        except Exception:
            self.repository.fail_activity_evidence_embedding_job(
                job_id,
                "Meeting activity evidence embedding failed",
            )
            return "meeting_activity_evidence_embedding_failed"


def activity_evidence_chunks(
    evidence: Sequence[ActivityEvidenceSource],
) -> list[ActivityEvidenceChunk]:
    chunks: list[ActivityEvidenceChunk] = []
    for item in sorted(evidence, key=lambda value: value.source_index):
        action = " ".join(item.action.split())
        summary = " ".join(item.summary.split())
        if not action or not summary:
            continue
        content = f"실제 사용자 활동: {summary}\n활동 유형: {action}"
        chunks.append(
            ActivityEvidenceChunk(
                activity_evidence_id=item.id,
                source_index=item.source_index,
                occurred_at=item.occurred_at,
                action=action,
                summary=summary,
                content=content,
                content_hash=activity_evidence_content_hash(content),
            )
        )
    return chunks


def activity_evidence_hash(evidence: Sequence[object]) -> str:
    canonical_values = sorted(
        (_canonical_evidence_fields(value) for value in evidence),
        key=lambda value: value[0],
    )
    canonical = "\n".join(
        (
            f"{source_index}\x1f{_occurred_at_text(occurred_at)}\x1f"
            f"{' '.join(str(action).split())}\x1f"
            f"{' '.join(str(summary).split())}"
        )
        for source_index, occurred_at, action, summary in canonical_values
    )
    return activity_evidence_content_hash(canonical)


def activity_evidence_content_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _source_evidence(source: Mapping[str, object]) -> list[ActivityEvidenceSource]:
    values = source.get("evidence")
    if not isinstance(values, list):
        raise ValueError("Activity evidence embedding source is missing evidence")
    return [_evidence_from_value(value) for value in values]


def _evidence_from_value(value: object) -> ActivityEvidenceSource:
    if isinstance(value, Mapping):
        return ActivityEvidenceSource(
            id=str(value["id"]),
            source_index=int(value["source_index"]),
            occurred_at=value["occurred_at"],
            action=str(value["action"]),
            summary=str(value["summary"]),
        )
    return ActivityEvidenceSource(
        id=str(value.id),
        source_index=int(value.source_index),
        occurred_at=value.occurred_at,
        action=str(value.action),
        summary=str(value.summary),
    )


def _canonical_evidence_fields(
    value: object,
) -> tuple[int, datetime | str, str, str]:
    if isinstance(value, Mapping):
        return (
            int(value["source_index"]),
            value["occurred_at"],
            str(value["action"]),
            str(value["summary"]),
        )
    return (
        int(value.source_index),
        value.occurred_at,
        str(value.action),
        str(value.summary),
    )


def _occurred_at_text(value: datetime | str) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)
