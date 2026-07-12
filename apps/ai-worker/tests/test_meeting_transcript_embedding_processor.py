from app.meeting_transcript_embedding_processor import (
    MeetingTranscriptEmbeddingProcessor,
    chunk_transcript,
    transcript_hash,
)


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_passage(self, text: str) -> list[float]:
        assert text
        return [0.1] * 384

    def embed_query(self, _text: str) -> list[float]:
        raise AssertionError("Transcript indexing must not use query embedding")


class FakeRepository:
    def __init__(self) -> None:
        self.job = {
            "id": "job-1",
            "meeting_report_id": "report-1",
            "transcript_hash": transcript_hash("진호: 검색 API를 구현한다."),
        }
        self.completed_jobs: list[str] = []
        self.replaced: tuple[object, object, object, object, object] | None = None
        self.superseded_jobs: list[str] = []
        self.failed_jobs: list[tuple[str, str]] = []

    def claim_transcript_embedding_job(self):
        job, self.job = self.job, None
        return job

    def get_transcript_embedding_source(self, _job):
        return {
            "transcript_text": "진호: 검색 API를 구현한다.",
            "transcript_hash": transcript_hash("진호: 검색 API를 구현한다."),
        }

    def replace_transcript_chunks(self, job, chunks, embeddings, model_name, model_version):
        self.replaced = (job, chunks, embeddings, model_name, model_version)
        return True

    def complete_transcript_embedding_job(self, job_id):
        self.completed_jobs.append(job_id)

    def supersede_transcript_embedding_job(self, job_id):
        self.superseded_jobs.append(job_id)

    def fail_transcript_embedding_job(self, job_id, message):
        self.failed_jobs.append((job_id, message))


def test_processor_chunks_and_indexes_completed_transcript() -> None:
    repository = FakeRepository()
    processor = MeetingTranscriptEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "meeting_transcript_embedding_completed"
    assert repository.completed_jobs == ["job-1"]
    assert repository.superseded_jobs == []
    assert repository.failed_jobs == []
    assert repository.replaced is not None
    _job, chunks, embeddings, model_name, model_version = repository.replaced
    assert len(chunks) == len(embeddings) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].content_hash == transcript_hash(chunks[0].content)
    assert (model_name, model_version) == ("test-embedding", "test-revision")


def test_processor_supersedes_changed_transcript_without_writing_chunks() -> None:
    repository = FakeRepository()
    repository.get_transcript_embedding_source = lambda _job: {
        "transcript_text": "진호: 검색 API를 구현한다.",
        "transcript_hash": "different-hash",
    }
    processor = MeetingTranscriptEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "meeting_transcript_embedding_superseded"
    assert repository.superseded_jobs == ["job-1"]
    assert repository.replaced is None


def test_chunk_transcript_preserves_order_with_overlap() -> None:
    transcript = " ".join(["문장입니다."] * 500)

    chunks = chunk_transcript(transcript, max_characters=100, overlap_characters=20)

    assert len(chunks) > 1
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert all(len(chunk.content) <= 100 for chunk in chunks)
    assert chunks[0].content[-20:] in chunks[1].content
