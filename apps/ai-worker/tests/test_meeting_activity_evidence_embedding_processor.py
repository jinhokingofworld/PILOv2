from datetime import UTC, datetime

from app.embedding_failure import RetryableEmbeddingError
from app.meeting_activity_evidence_embedding_processor import (
    MeetingActivityEvidenceEmbeddingProcessor,
    activity_evidence_chunks,
    activity_evidence_hash,
)
from app.meeting_transcript_embedding_processor import (
    OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS,
)


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_passage(self, text: str) -> list[float]:
        assert "실제 사용자 활동" in text
        return [0.1] * OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS


class FakeRepository:
    def __init__(self) -> None:
        self.evidence = [
            {
                "id": "evidence-1",
                "source_index": 0,
                "occurred_at": datetime(2026, 7, 16, 10, 0, tzinfo=UTC),
                "action": "calendar_event_updated",
                "summary": "디자인 리뷰 일정을 변경했습니다.",
            }
        ]
        self.job = {
            "id": "job-1",
            "meeting_report_id": "report-1",
            "evidence_hash": activity_evidence_hash(self.evidence),
            "attempt_count": 1,
        }
        self.completed_jobs: list[str] = []
        self.superseded_jobs: list[str] = []
        self.failed_jobs: list[tuple[str, str]] = []
        self.requeued_jobs: list[tuple[str, str]] = []
        self.replaced = None

    def claim_activity_evidence_embedding_job(self):
        job, self.job = self.job, None
        return job

    def get_activity_evidence_embedding_source(self, _job):
        return {"evidence": self.evidence, "evidence_hash": activity_evidence_hash(self.evidence)}

    def replace_activity_evidence_chunks(self, job, chunks, embeddings, model_name, model_version):
        self.replaced = (job, chunks, embeddings, model_name, model_version)
        return True

    def complete_activity_evidence_embedding_job(self, job_id):
        self.completed_jobs.append(job_id)

    def supersede_activity_evidence_embedding_job(self, job_id):
        self.superseded_jobs.append(job_id)

    def fail_activity_evidence_embedding_job(self, job_id, message):
        self.failed_jobs.append((job_id, message))

    def requeue_activity_evidence_embedding_job(self, job_id, message):
        self.requeued_jobs.append((job_id, message))


def test_activity_evidence_hash_ignores_snapshot_uuid_but_tracks_safe_content() -> None:
    original = {
        "id": "old-id",
        "source_index": 0,
        "occurred_at": "2026-07-16T10:00:00+00:00",
        "action": "calendar_event_updated",
        "summary": "일정을 변경했습니다.",
    }
    regenerated = {**original, "id": "new-id"}
    changed = {**original, "summary": "일정을 취소했습니다."}

    assert activity_evidence_hash([original]) == activity_evidence_hash([regenerated])
    assert activity_evidence_hash([original]) != activity_evidence_hash([changed])


def test_processor_indexes_only_safe_activity_evidence_snapshot() -> None:
    repository = FakeRepository()
    processor = MeetingActivityEvidenceEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "meeting_activity_evidence_embedding_completed"
    assert repository.completed_jobs == ["job-1"]
    assert repository.superseded_jobs == []
    assert repository.failed_jobs == []
    _job, chunks, embeddings, model_name, model_version = repository.replaced
    assert len(chunks) == len(embeddings) == 1
    assert chunks[0].summary == "디자인 리뷰 일정을 변경했습니다."
    assert (
        chunks[0].content
        == "실제 사용자 활동: 디자인 리뷰 일정을 변경했습니다.\n활동 유형: calendar_event_updated"
    )
    assert (model_name, model_version) == ("test-embedding", "test-revision")


def test_processor_supersedes_when_snapshot_changes_after_claim() -> None:
    repository = FakeRepository()
    repository.get_activity_evidence_embedding_source = lambda _job: {
        "evidence": repository.evidence,
        "evidence_hash": "different-hash",
    }
    processor = MeetingActivityEvidenceEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "meeting_activity_evidence_embedding_superseded"
    assert repository.superseded_jobs == ["job-1"]
    assert repository.replaced is None


def test_processor_requeues_temporary_embedding_failure() -> None:
    class TimeoutEmbedder(FakeEmbedder):
        def embed_passage(self, _text: str) -> list[float]:
            raise RetryableEmbeddingError("provider timeout")

    repository = FakeRepository()
    processor = MeetingActivityEvidenceEmbeddingProcessor(repository, TimeoutEmbedder())

    assert processor.process_next() == "meeting_activity_evidence_embedding_retryable_failure"
    assert repository.requeued_jobs[0][0] == "job-1"
    assert repository.failed_jobs == []


def test_activity_evidence_chunk_does_not_copy_unrelated_metadata() -> None:
    chunk = activity_evidence_chunks(
        [
            type(
                "Evidence",
                (),
                {
                    "id": "evidence-1",
                    "source_index": 0,
                    "occurred_at": "2026-07-16T10:00:00+00:00",
                    "action": "board_issue_updated",
                    "summary": "이슈 상태를 변경했습니다.",
                    "metadata": {"secret": "must-not-be-copied"},
                },
            )()
        ]
    )[0]

    assert "must-not-be-copied" not in chunk.content
