from __future__ import annotations

from typing import Protocol

from app.canvas_agent.embeddings import CanvasEmbedder, CanvasEmbeddingError, build_shape_passage


class CanvasEmbeddingRepository(Protocol):
    def claim_embedding_job(self) -> dict[str, object] | None: ...

    def get_shape_embedding_source(self, job: dict[str, object]) -> dict[str, object] | None: ...

    def upsert_shape_embedding(
        self,
        job: dict[str, object],
        embedding: list[float],
        model_name: str,
        model_version: str,
    ) -> bool: ...

    def delete_shape_embedding(self, shape_id: str) -> None: ...

    def complete_embedding_job(self, job_id: str) -> None: ...

    def supersede_embedding_job(self, job_id: str) -> None: ...

    def fail_embedding_job(self, job_id: str, message: str) -> None: ...


class CanvasEmbeddingProcessor:
    def __init__(self, repository: CanvasEmbeddingRepository, embedder: CanvasEmbedder) -> None:
        self.repository = repository
        self.embedder = embedder

    def process_next(self) -> str | None:
        job = self.repository.claim_embedding_job()
        if job is not None:
            return self._process_shape_job(job)

        return None

    def _process_shape_job(self, job: dict[str, object]) -> str:
        job_id = str(job["id"])
        try:
            if job["operation"] == "delete":
                self.repository.delete_shape_embedding(str(job["shape_id"]))
                self.repository.complete_embedding_job(job_id)
                return "canvas_shape_embedding_deleted"

            source = self.repository.get_shape_embedding_source(job)
            if source is None or source.get("source_text_hash") != job.get(
                "expected_source_text_hash"
            ):
                self.repository.supersede_embedding_job(job_id)
                return "canvas_shape_embedding_superseded"

            passage = build_shape_passage(
                str(source["shape_type"]),
                _optional_text(source.get("title")),
                _optional_text(source.get("text_content")),
            )
            embedding = self.embedder.embed_passage(passage)
            if not self.repository.upsert_shape_embedding(
                job,
                embedding,
                self.embedder.model_name,
                self.embedder.model_version,
            ):
                self.repository.supersede_embedding_job(job_id)
                return "canvas_shape_embedding_superseded"

            self.repository.complete_embedding_job(job_id)
            return "canvas_shape_embedding_completed"
        except CanvasEmbeddingError as error:
            self.repository.fail_embedding_job(job_id, str(error))
            return "canvas_shape_embedding_failed"
        except Exception:
            self.repository.fail_embedding_job(job_id, "Canvas shape embedding failed")
            return "canvas_shape_embedding_failed"


def _optional_text(value: object) -> str | None:
    return value if isinstance(value, str) else None
