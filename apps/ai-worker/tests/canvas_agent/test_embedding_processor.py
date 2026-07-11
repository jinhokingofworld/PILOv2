from __future__ import annotations

from app.canvas_agent.embedding_processor import CanvasEmbeddingProcessor
from app.canvas_agent.embeddings import build_shape_passage


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_passage(self, text: str) -> list[float]:
        assert "shape type: sticky-note" in text
        assert "title: 인증" in text
        return [0.1] * 384

    def embed_query(self, text: str) -> list[float]:
        raise AssertionError(f"shape embedding processor must not embed query text: {text}")


class FakeRepository:
    def __init__(self) -> None:
        self.jobs = [
            {
                "id": "job-1",
                "operation": "upsert",
                "shape_id": "shape:1",
                "expected_source_text_hash": "hash-1",
            }
        ]
        self.completed_jobs: list[str] = []

    def claim_embedding_job(self):
        return self.jobs.pop(0) if self.jobs else None

    def get_shape_embedding_source(self, _job):
        return {
            "shape_type": "sticky-note",
            "title": "인증",
            "text_content": "JWT 로그인 흐름",
            "source_text_hash": "hash-1",
        }

    def upsert_shape_embedding(self, _job, embedding, model_name, model_version):
        assert len(embedding) == 384
        assert (model_name, model_version) == ("test-embedding", "test-revision")
        return True

    def delete_shape_embedding(self, _shape_id):
        raise AssertionError("upsert job must not delete")

    def complete_embedding_job(self, job_id):
        self.completed_jobs.append(job_id)

    def supersede_embedding_job(self, _job_id):
        raise AssertionError("source is current")

    def fail_embedding_job(self, _job_id, _message):
        raise AssertionError("embedding must not fail")


def test_embedding_processor_indexes_shape_job() -> None:
    repository = FakeRepository()
    processor = CanvasEmbeddingProcessor(repository, FakeEmbedder())

    assert processor.process_next() == "canvas_shape_embedding_completed"
    assert repository.completed_jobs == ["job-1"]


def test_shape_passage_includes_canvas_shape_aliases() -> None:
    note_passage = build_shape_passage("note", "회의 메모", "")
    frame_passage = build_shape_passage("frame", "프레임 1", "")

    assert "shape aliases: 메모" in note_passage
    assert "shape aliases: 프레임" in frame_passage
