from __future__ import annotations

from typing import Protocol, TypeVar

from app.canvas_agent.embeddings import CanvasEmbedder, CanvasEmbeddingError
from app.canvas_agent.types import (
    CanvasAgentIntentClassification,
    CanvasAgentRunContext,
    CanvasSemanticShapeMatch,
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
        shape_similarity_min: float = 0.78,
        similarity_margin_min: float = 0.08,
    ) -> None:
        self.repository = repository
        self.embedder = embedder
        self.shape_similarity_min = shape_similarity_min
        self.similarity_margin_min = similarity_margin_min

    @property
    def model(self) -> str:
        return f"local:{self.embedder.model_name}@{self.embedder.model_version}"

    def classify(
        self,
        context: CanvasAgentRunContext,
    ) -> CanvasAgentIntentClassification | None:
        request = _semantic_request(context)
        if request is None:
            return None
        query = request

        text_matches = self.repository.search_text_shapes(context.canvas_id, query)
        if text_matches:
            return CanvasAgentIntentClassification(
                intent="find_shapes",
                arguments={
                    "query": query,
                    "shapeIds": [match.shape_id for match in text_matches[:4]],
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
            return CanvasAgentIntentClassification(
                intent="find_shapes",
                arguments={
                    "query": query,
                    "shapeIds": shape_ids,
                    "focusResult": True,
                    "routingSource": "shape_embedding",
                },
                message="임베딩 검색으로 찾았어요. 여기 있는 내용이 가장 가까워요.",
            )

        return None


def _semantic_request(context: CanvasAgentRunContext) -> str | None:
    previous = context.previous_action
    if previous is None:
        normalized = context.prompt.strip()
        return normalized[:2000] if normalized else None
    if previous.get("actionName") not in {"find_shapes", "route_intent"}:
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
    if previous.get("actionName") == "route_intent":
        arguments = action_input.get("arguments")
        query = arguments.get("query") if isinstance(arguments, dict) else None
    if not isinstance(query, str):
        return None
    normalized = query.strip()
    return normalized[:120] if normalized else None


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
