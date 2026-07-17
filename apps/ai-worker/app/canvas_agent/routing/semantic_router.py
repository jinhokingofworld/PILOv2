from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, TypeVar

from app.canvas_agent.embeddings import CanvasEmbedder, CanvasEmbeddingError
from app.canvas_agent.types import (
    CanvasAgentPlan,
    CanvasAgentRunContext,
    CanvasSemanticShapeMatch,
)

SHAPE_SEARCH_PROTOTYPES = (
    "관련 메모를 찾아줘",
    "해당 내용이 있는 도형을 보여줘",
    "캔버스에서 비슷한 카드를 찾아줘",
    "적어둔 내용을 찾아줘",
    "그 내용이 있는 곳으로 이동해줘",
    "관련 도형 위치로 가줘",
    "관련 도형을 하이라이트해줘",
    "작성해둔 노트를 보여줘",
    "이미 만든 도형을 찾아줘",
    "캔버스 위에 있는 내용을 찾아줘",
)

NON_SHAPE_SEARCH_PROTOTYPES = (
    "새 화면 초안을 만들어줘",
    "디자인 시안을 만들어줘",
    "플로우 다이어그램을 그려줘",
    "선택한 메모들을 정리해줘",
    "도형들을 보기 좋게 배치해줘",
    "코드 예시를 만들어줘",
    "컴포넌트 코드를 작성해줘",
    "이 화면을 더 보기 좋게 바꿔줘",
    "새로운 구조도를 만들어줘",
    "캔버스에 코드 블록을 생성해줘",
)


class SemanticCanvasAgentRepository(Protocol):
    def has_semantic_shapes(self, workspace_id: str, canvas_id: str) -> bool: ...

    def search_text_shapes(
        self,
        canvas_id: str,
        query: str,
        limit: int = 4,
    ) -> list[CanvasSemanticShapeMatch]: ...

    def search_semantic_shapes(
        self,
        workspace_id: str,
        canvas_id: str,
        query_embedding: list[float],
        limit: int = 4,
    ) -> list[CanvasSemanticShapeMatch]: ...


class CanvasSemanticRouter:
    def __init__(
        self,
        repository: SemanticCanvasAgentRepository,
        embedder: CanvasEmbedder,
        *,
        shape_search_similarity_min: float = 0.78,
        shape_search_margin_min: float = 0.04,
        shape_similarity_min: float = 0.78,
        similarity_margin_min: float = 0.08,
    ) -> None:
        self.repository = repository
        self.embedder = embedder
        self.shape_search_similarity_min = shape_search_similarity_min
        self.shape_search_margin_min = shape_search_margin_min
        self.shape_similarity_min = shape_similarity_min
        self.similarity_margin_min = similarity_margin_min
        self._prototype_embeddings: _PrototypeEmbeddings | None = None

    @property
    def model(self) -> str:
        return f"local:{self.embedder.model_name}@{self.embedder.model_version}"

    def plan(self, context: CanvasAgentRunContext) -> CanvasAgentPlan | None:
        request = _semantic_request(context)
        if request is None:
            return None
        query, requires_shape_search_classification = request

        text_matches = self.repository.search_text_shapes(context.canvas_id, query)
        if text_matches and (
            not requires_shape_search_classification
            or _is_direct_text_search_prompt(context.prompt)
        ):
            return CanvasAgentPlan(
                action_name="find_shapes",
                input={
                    "query": query,
                    "shapeIds": [match.shape_id for match in text_matches[:4]],
                    "continuePlanning": False,
                    "focusResult": True,
                    "routingSource": "deterministic_search",
                },
                message="Canvas 검색으로 먼저 찾았어요. 여기 있는 내용이 가장 가까워요.",
            )

        if not self.repository.has_semantic_shapes(context.workspace_id, context.canvas_id):
            return None

        try:
            query_embedding = self.embedder.embed_query(query)
        except CanvasEmbeddingError:
            return None

        if requires_shape_search_classification:
            try:
                if not self._is_shape_search(query_embedding):
                    return None
            except CanvasEmbeddingError:
                return None

        shape_matches = self.repository.search_semantic_shapes(
            context.workspace_id,
            context.canvas_id,
            query_embedding,
        )
        shape_match = _confident(
            shape_matches,
            self.shape_similarity_min,
            self.similarity_margin_min,
        )

        if isinstance(shape_match, CanvasSemanticShapeMatch):
            shape_ids = [match.shape_id for match in shape_matches[:4]]
            return CanvasAgentPlan(
                action_name="find_shapes",
                input={
                    "query": query,
                    "shapeIds": shape_ids,
                    "continuePlanning": False,
                    "focusResult": True,
                    "routingSource": "shape_embedding",
                },
                message="임베딩 검색으로 찾았어요. 여기 있는 내용이 가장 가까워요.",
            )

        return None

    def _is_shape_search(self, query_embedding: list[float]) -> bool:
        prototypes = self._get_prototype_embeddings()
        shape_score = _max_similarity(query_embedding, prototypes.shape_search)
        non_shape_score = _max_similarity(query_embedding, prototypes.non_shape_search)
        return (
            shape_score >= self.shape_search_similarity_min
            and shape_score - non_shape_score >= self.shape_search_margin_min
        )

    def _get_prototype_embeddings(self) -> _PrototypeEmbeddings:
        if self._prototype_embeddings is not None:
            return self._prototype_embeddings

        self._prototype_embeddings = _PrototypeEmbeddings(
            shape_search=[self.embedder.embed_query(text) for text in SHAPE_SEARCH_PROTOTYPES],
            non_shape_search=[
                self.embedder.embed_query(text) for text in NON_SHAPE_SEARCH_PROTOTYPES
            ],
        )
        return self._prototype_embeddings


@dataclass(frozen=True)
class _PrototypeEmbeddings:
    shape_search: list[list[float]]
    non_shape_search: list[list[float]]


def _semantic_request(context: CanvasAgentRunContext) -> tuple[str, bool] | None:
    previous = context.previous_action
    if previous is None:
        normalized = context.prompt.strip()
        return (normalized[:2000], True) if normalized else None
    if previous.get("actionName") != "find_shapes":
        return None
    resource_refs = previous.get("resourceRefs")
    if isinstance(resource_refs, list) and any(
        isinstance(value, str) and value for value in resource_refs
    ):
        return None
    action_input = previous.get("input")
    if not isinstance(action_input, dict):
        return None
    query = action_input.get("query")
    if not isinstance(query, str):
        return None
    normalized = query.strip()
    return (normalized[:120], False) if normalized else None


def _is_direct_text_search_prompt(value: str) -> bool:
    if not re.search(r"(찾아|찾기|검색|어디|위치|보여|이동|가줘|하이라이트)", value):
        return False
    return not re.search(
        r"(만들|생성|그려|초안|디자인|와이어|다이어그램|코드|작성|추가|수정|바꿔)",
        value,
    )


T = TypeVar("T")


def _confident(
    matches: list[T],
    similarity_min: float,
    margin_min: float,
) -> T | None:
    if not matches:
        return None
    top = matches[0]
    top_similarity = getattr(top, "similarity", 0.0)
    if top_similarity < similarity_min:
        return None
    if len(matches) > 1:
        next_similarity = getattr(matches[1], "similarity", 0.0)
        if top_similarity - next_similarity < margin_min:
            return None
    return top


def _max_similarity(query_embedding: list[float], prototype_embeddings: list[list[float]]) -> float:
    if not prototype_embeddings:
        return 0.0
    return max(_cosine_similarity(query_embedding, prototype) for prototype in prototype_embeddings)


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = sum(value * value for value in left) ** 0.5
    right_norm = sum(value * value for value in right) ** 0.5
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)
