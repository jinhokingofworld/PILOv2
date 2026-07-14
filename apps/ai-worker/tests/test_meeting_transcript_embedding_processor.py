from types import SimpleNamespace

from app.meeting_transcript_embedding_processor import (
    OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS,
    MeetingTranscriptEmbeddingProcessor,
    OpenAiTranscriptEmbedder,
    TranscriptSourceSegment,
    chunk_transcript_segments,
    transcript_hash,
    transcript_segments_hash,
)


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_passage(self, text: str) -> list[float]:
        assert text
        return [0.1] * OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS

    def embed_query(self, _text: str) -> list[float]:
        raise AssertionError("Transcript indexing must not use query embedding")


def test_openai_transcript_embedder_requests_1536_dimension_float_embeddings() -> None:
    created: dict[str, object] = {}

    class FakeEmbeddings:
        def create(self, **kwargs):
            created.update(kwargs)
            return SimpleNamespace(
                data=[SimpleNamespace(embedding=[0.1] * OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS)]
            )

    embedder = OpenAiTranscriptEmbedder.__new__(OpenAiTranscriptEmbedder)
    embedder.client = SimpleNamespace(embeddings=FakeEmbeddings())
    embedder.model_name = "text-embedding-3-small"

    assert embedder.embed_passage("  회의록\n  근거  ") == [
        0.1
    ] * OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS
    assert created == {
        "input": "회의록 근거",
        "model": "text-embedding-3-small",
        "dimensions": OPENAI_TRANSCRIPT_EMBEDDING_DIMENSIONS,
        "encoding_format": "float",
    }


class FakeRepository:
    def __init__(self) -> None:
        self.segments = [
            TranscriptSourceSegment(0, 0, 1_000, "진호: 검색 API를 구현한다."),
            TranscriptSourceSegment(1, 1_000, 2_000, "은재: 근거를 남긴다."),
        ]
        self.job = {
            "id": "job-1",
            "meeting_report_id": "report-1",
            "transcript_hash": transcript_segments_hash(self.segments),
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
            "segments": self.segments,
            "transcript_hash": transcript_segments_hash(self.segments),
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


def test_processor_chunks_and_indexes_completed_transcript_segments() -> None:
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
    assert chunks[0].start_segment_index == 0
    assert chunks[0].end_segment_index == 1
    assert chunks[0].started_at_ms == 0
    assert chunks[0].ended_at_ms == 2_000
    assert chunks[0].content_hash == transcript_hash(chunks[0].content)
    assert (model_name, model_version) == ("test-embedding", "test-revision")


def test_processor_supersedes_changed_segments_without_writing_chunks() -> None:
    repository = FakeRepository()
    repository.get_transcript_embedding_source = lambda _job: {
        "segments": repository.segments,
        "transcript_hash": "different-hash",
    }
    processor = MeetingTranscriptEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "meeting_transcript_embedding_superseded"
    assert repository.superseded_jobs == ["job-1"]
    assert repository.replaced is None


def test_chunk_transcript_segments_keeps_boundaries_and_splits_only_oversized_segment() -> None:
    segments = [
        TranscriptSourceSegment(0, 0, 1_000, "첫 번째 발화"),
        TranscriptSourceSegment(1, 1_000, 2_000, "두 번째 발화"),
        TranscriptSourceSegment(2, 2_000, 3_000, " ".join(["긴발화"] * 100)),
    ]

    chunks = chunk_transcript_segments(segments, max_characters=10)

    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert chunks[0].start_segment_index == chunks[0].end_segment_index == 0
    assert chunks[1].start_segment_index == chunks[1].end_segment_index == 1
    assert all(len(chunk.content) <= 10 for chunk in chunks)
    assert all(chunk.start_segment_index == chunk.end_segment_index == 2 for chunk in chunks[2:])


def test_transcript_segments_hash_changes_when_segment_time_or_text_changes() -> None:
    original = [TranscriptSourceSegment(0, 0, 1_000, "결정을 기록한다.")]
    changed_time = [TranscriptSourceSegment(0, 0, 1_100, "결정을 기록한다.")]
    changed_text = [TranscriptSourceSegment(0, 0, 1_000, "다른 결정을 기록한다.")]

    assert transcript_segments_hash(original) != transcript_segments_hash(changed_time)
    assert transcript_segments_hash(original) != transcript_segments_hash(changed_text)
