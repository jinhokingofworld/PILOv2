from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


EMBEDDING_DIMENSIONS = 384
DEFAULT_CANVAS_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
DEFAULT_CANVAS_EMBEDDING_REVISION = "main"
DEFAULT_MAX_SEQUENCE_LENGTH = 256


class CanvasEmbeddingError(Exception):
    pass


class CanvasEmbedder(Protocol):
    @property
    def model_name(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    def embed_query(self, text: str) -> list[float]: ...

    def embed_passage(self, text: str) -> list[float]: ...


@dataclass
class LocalSentenceTransformerCanvasEmbedder:
    model_name: str = DEFAULT_CANVAS_EMBEDDING_MODEL
    model_version: str = DEFAULT_CANVAS_EMBEDDING_REVISION
    max_sequence_length: int = DEFAULT_MAX_SEQUENCE_LENGTH
    _model: object | None = None

    def embed_query(self, text: str) -> list[float]:
        return self._embed("query: ", text)

    def embed_passage(self, text: str) -> list[float]:
        return self._embed("passage: ", text)

    def _embed(self, prefix: str, text: str) -> list[float]:
        normalized = _bounded_text(text)
        if not normalized:
            raise CanvasEmbeddingError("Canvas embedding text is empty")

        try:
            output = self._get_model().encode(
                f"{prefix}{normalized}",
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        except CanvasEmbeddingError:
            raise
        except Exception as error:
            raise CanvasEmbeddingError("Local Canvas embedding model failed") from error

        vector = [float(value) for value in output.tolist()]
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise CanvasEmbeddingError("Canvas embedding dimension is invalid")
        if any(not _is_finite(value) for value in vector):
            raise CanvasEmbeddingError("Canvas embedding contains a non-finite value")
        return vector

    def _get_model(self):
        if self._model is not None:
            return self._model

        try:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(
                self.model_name,
                revision=self.model_version,
                device="cpu",
            )
            model.max_seq_length = self.max_sequence_length
        except Exception as error:
            raise CanvasEmbeddingError(
                "Local Canvas embedding model could not be loaded"
            ) from error

        self._model = model
        return model


def build_shape_passage(shape_type: str, title: str | None, text_content: str | None) -> str:
    parts = [f"shape type: {shape_type.strip()}"]
    if title and title.strip():
        parts.append(f"title: {title.strip()}")
    if text_content and text_content.strip():
        parts.append(f"content: {text_content.strip()}")
    return _bounded_text("\n".join(parts))


def _bounded_text(value: str, limit: int = 6000) -> str:
    normalized = " ".join(value.split())
    return normalized[:limit]


def _is_finite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))
