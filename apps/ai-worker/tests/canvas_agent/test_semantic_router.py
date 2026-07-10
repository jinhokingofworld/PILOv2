from __future__ import annotations

from app.canvas_agent.semantic_router import CanvasSemanticRouter
from app.canvas_agent.types import (
    CanvasAgentRunContext,
    CanvasIntentExampleMatch,
    CanvasSemanticShapeMatch,
)


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_query(self, text: str) -> list[float]:
        assert text == "인증 흐름"
        return [0.1] * 384

    def embed_passage(self, _text: str) -> list[float]:
        raise AssertionError("semantic routing only embeds a query")


class FakeRepository:
    def __init__(self, *, intents=None, shapes=None) -> None:
        self.intents = intents or []
        self.shapes = shapes or []
        self.used_intent_ids: list[str] = []

    def search_semantic_shapes(self, _workspace_id, _canvas_id, _embedding, limit=4):
        assert limit == 4
        return self.shapes

    def search_active_intent_examples(self, _workspace_id, _user_id, _embedding, limit=2):
        assert limit == 2
        return self.intents

    def increment_intent_example_usage(self, intent_example_id: str) -> None:
        self.used_intent_ids.append(intent_example_id)


def unmatched_find_context() -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="인증 흐름 있는 곳으로 가줘",
        request_context={"selectedShapeIds": []},
        previous_action={
            "actionName": "find_shapes",
            "input": {"query": "인증 흐름"},
            "output": {},
            "resourceRefs": [],
        },
    )


def test_semantic_router_uses_confident_canvas_shape_match() -> None:
    repository = FakeRepository(
        shapes=[
            CanvasSemanticShapeMatch("shape:auth", 0.91),
            CanvasSemanticShapeMatch("shape:login", 0.7),
        ]
    )

    plan = CanvasSemanticRouter(repository, FakeEmbedder()).plan(unmatched_find_context())

    assert plan is not None
    assert plan.action_name == "find_shapes"
    assert plan.input["shapeIds"] == ["shape:auth", "shape:login"]
    assert plan.input["focusResult"] is True


def test_semantic_router_uses_only_user_approved_draft_intent() -> None:
    repository = FakeRepository(
        intents=[
            CanvasIntentExampleMatch(
                intent_example_id="intent-1",
                intent="create_draft",
                action_template={
                    "actionName": "create_draft",
                    "kind": "organize",
                    "style": "간결한 흐름도",
                },
                similarity=0.96,
            )
        ]
    )

    plan = CanvasSemanticRouter(repository, FakeEmbedder()).plan(unmatched_find_context())

    assert plan is not None
    assert plan.action_name == "create_draft"
    assert plan.input == {"kind": "organize", "style": "간결한 흐름도"}
    assert repository.used_intent_ids == ["intent-1"]
