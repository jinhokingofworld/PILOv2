from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

EMBEDDING_DIMENSIONS = 384
DEFAULT_CANVAS_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"
DEFAULT_CANVAS_EMBEDDING_REVISION = "main"
DEFAULT_MAX_SEQUENCE_LENGTH = 256

SHAPE_TYPE_ALIASES = {
    "arrow": ("화살표", "연결선", "커넥터"),
    "draw": ("펜", "자유 그리기", "드로잉"),
    "embed": ("임베드", "웹사이트", "외부 링크"),
    "frame": ("프레임", "영역", "그룹 영역"),
    "geo": ("도형", "사각형", "원", "삼각형", "카드"),
    "group": ("그룹", "묶음"),
    "highlight": ("형광펜", "하이라이트"),
    "line": ("선", "연결선"),
    "note": ("메모", "노트", "스티키 노트"),
    "pilo-code-block": ("코드 블록", "코드", "파일"),
    "text": ("텍스트", "글자", "문구"),
}


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
    normalized_shape_type = shape_type.strip()
    parts = [f"shape type: {normalized_shape_type}"]
    aliases = SHAPE_TYPE_ALIASES.get(normalized_shape_type)
    if aliases:
        parts.append(f"shape aliases: {', '.join(aliases)}")
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
