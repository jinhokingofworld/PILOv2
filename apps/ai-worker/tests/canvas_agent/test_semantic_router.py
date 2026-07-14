from __future__ import annotations

from app.canvas_agent.routing.semantic_router import (
    NON_SHAPE_SEARCH_PROTOTYPES,
    SHAPE_SEARCH_PROTOTYPES,
    CanvasSemanticRouter,
)
from app.canvas_agent.types import (
    CanvasAgentRunContext,
    CanvasSemanticShapeMatch,
)


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_query(self, text: str) -> list[float]:
        if text == "로그인 화면":
            return [0.2, 0.8, *([0.0] * 382)]
        if text == "인증 메모":
            return [0.3, 0.7, *([0.0] * 382)]
        if text in SHAPE_SEARCH_PROTOTYPES or "어디" in text or "찾아" in text:
            return [1.0, 0.0, *([0.0] * 382)]
        if text in NON_SHAPE_SEARCH_PROTOTYPES or "만들어" in text or "다이어그램" in text:
            return [0.0, 1.0, *([0.0] * 382)]
        return [0.7, 0.3, *([0.0] * 382)]

    def embed_passage(self, _text: str) -> list[float]:
        raise AssertionError("semantic routing only embeds a query")


class FailingEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_query(self, text: str) -> list[float]:
        raise AssertionError(f"semantic router must skip embedding for an empty canvas: {text}")

    def embed_passage(self, _text: str) -> list[float]:
        raise AssertionError("semantic routing only embeds a query")


class FakeRepository:
    def __init__(self, *, has_shapes=True, shapes=None) -> None:
        self.has_shapes = has_shapes
        self.shapes = shapes or []
        self.search_calls = 0

    def has_semantic_shapes(self, _workspace_id, _canvas_id):
        return self.has_shapes

    def search_semantic_shapes(self, _workspace_id, _canvas_id, _embedding, limit=4):
        self.search_calls += 1
        assert limit == 4
        if _embedding[0] == 0.2:
            return [
                CanvasSemanticShapeMatch("shape:login", 0.92),
                CanvasSemanticShapeMatch("shape:other", 0.7),
            ]
        if _embedding[0] == 0.3:
            return [
                CanvasSemanticShapeMatch("shape:auth", 0.91),
                CanvasSemanticShapeMatch("shape:other", 0.7),
            ]
        return self.shapes


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


def test_semantic_router_uses_direct_shape_search_prompt() -> None:
    repository = FakeRepository(shapes=[CanvasSemanticShapeMatch("shape:auth", 0.91)])
    context = CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="인증 흐름 어디 있어?",
        request_context={"selectedShapeIds": []},
        previous_action=None,
    )

    plan = CanvasSemanticRouter(repository, FakeEmbedder()).plan(context)

    assert plan is not None
    assert plan.action_name == "find_shapes"
    assert plan.input["shapeIds"] == ["shape:auth"]
    assert plan.input["focusResult"] is True


def test_semantic_router_skips_embedding_when_canvas_has_no_indexed_shapes() -> None:
    repository = FakeRepository(has_shapes=False)
    context = CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="?몄쬆 ?먮쫫 ?대뵒 ?덉뼱?",
        request_context={"selectedShapeIds": []},
        previous_action=None,
    )

    plan = CanvasSemanticRouter(repository, FailingEmbedder()).plan(context)

    assert plan is None
    assert repository.search_calls == 0


def test_semantic_router_skips_generation_prompt_for_planner() -> None:
    repository = FakeRepository(shapes=[CanvasSemanticShapeMatch("shape:auth", 0.91)])
    context = CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="인증 흐름을 다이어그램으로 만들어줘",
        request_context={"selectedShapeIds": []},
        previous_action=None,
    )

    plan = CanvasSemanticRouter(repository, FakeEmbedder()).plan(context)

    assert plan is None


def test_semantic_router_connects_two_confident_shape_matches() -> None:
    repository = FakeRepository()
    context = CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="로그인 화면이랑 인증 메모 연결해줘",
        request_context={"selectedShapeIds": []},
        previous_action=None,
    )

    plan = CanvasSemanticRouter(repository, FakeEmbedder()).plan(context)

    assert plan is not None
    assert plan.action_name == "connect_shapes"
    assert plan.input["fromShapeId"] == "shape:login"
    assert plan.input["toShapeId"] == "shape:auth"
    assert plan.input["connectionKind"] == "arrow"
