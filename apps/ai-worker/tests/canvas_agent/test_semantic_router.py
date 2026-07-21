from __future__ import annotations

from app.canvas_agent.routing.semantic_router import CanvasSemanticRouter
from app.canvas_agent.types import CanvasAgentRunContext, CanvasSemanticShapeMatch


class FakeEmbedder:
    model_name = "test-embedding"
    model_version = "test-revision"

    def embed_query(self, text: str) -> list[float]:
        if text == "로그인 화면":
            return [0.2, 0.8, *([0.0] * 382)]
        if text == "인증 메모":
            return [0.3, 0.7, *([0.0] * 382)]
        if "만들어" in text or "다이어그램" in text:
            return [0.0, 1.0, *([0.0] * 382)]
        return [1.0, 0.0, *([0.0] * 382)]

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
    def __init__(self, *, has_shapes=True, shapes=None, text_shapes=None) -> None:
        self.has_shapes = has_shapes
        self.shapes = shapes or []
        self.text_shapes = text_shapes or {}
        self.search_calls = 0
        self.text_search_calls: list[tuple[str, str, str]] = []

    def has_semantic_shapes(self, _workspace_id, _canvas_id):
        return self.has_shapes

    def search_text_shapes(self, workspace_id, canvas_id, query, limit=4):
        self.text_search_calls.append((workspace_id, canvas_id, query))
        return self.text_shapes.get(query, [])[:limit]

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


def context(prompt: str, previous_action=None) -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt=prompt,
        request_context={"selectedShapeIds": []},
        previous_action=previous_action,
    )


def test_semantic_router_classifies_confident_canvas_shape_match() -> None:
    repository = FakeRepository(
        shapes=[
            CanvasSemanticShapeMatch("shape:auth", 0.91),
            CanvasSemanticShapeMatch("shape:login", 0.7),
        ]
    )
    previous_action = {
        "actionName": "find_shapes",
        "input": {"query": "인증 흐름"},
        "output": {},
        "resourceRefs": [],
    }

    classification = CanvasSemanticRouter(repository, FakeEmbedder()).classify(
        context("인증 흐름 있는 곳으로 가줘", previous_action)
    )

    assert classification is not None
    assert classification.intent == "find_shapes"
    assert classification.arguments["shapeIds"] == ["shape:auth", "shape:login"]
    assert classification.arguments["focusResult"] is True
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "인증 흐름"),
    ]


def test_semantic_router_classifies_direct_shape_search_prompt() -> None:
    repository = FakeRepository(shapes=[CanvasSemanticShapeMatch("shape:auth", 0.91)])

    classification = CanvasSemanticRouter(repository, FakeEmbedder()).classify(
        context("인증 흐름 어디 있어?")
    )

    assert classification is not None
    assert classification.intent == "find_shapes"
    assert classification.arguments["shapeIds"] == ["shape:auth"]
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "인증 흐름 어디 있어?"),
    ]


def test_semantic_router_skips_embedding_when_canvas_has_no_indexed_shapes() -> None:
    repository = FakeRepository(has_shapes=False)

    classification = CanvasSemanticRouter(repository, FailingEmbedder()).classify(
        context("인증 화면 어디 있어?")
    )

    assert classification is None
    assert repository.search_calls == 0
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "인증 화면 어디 있어?"),
    ]


def test_semantic_router_uses_scoped_db_text_before_embedding() -> None:
    repository = FakeRepository(
        shapes=[
            CanvasSemanticShapeMatch("shape:other-a", 0.8),
            CanvasSemanticShapeMatch("shape:other-b", 0.79),
        ],
        text_shapes={
            "대시보드 와이어프레임": [
                CanvasSemanticShapeMatch("shape:dashboard", 1.0),
            ],
        },
    )

    classification = CanvasSemanticRouter(repository, FakeEmbedder()).classify(
        context("대시보드 와이어프레임 어디 있어?"),
        "대시보드 와이어프레임",
    )

    assert classification is not None
    assert classification.arguments["shapeIds"] == ["shape:dashboard"]
    assert classification.arguments["routingSource"] == "database_text"
    assert repository.search_calls == 0
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "대시보드 와이어프레임"),
    ]


def test_semantic_router_uses_scoped_db_text_without_embedding_index() -> None:
    repository = FakeRepository(
        has_shapes=False,
        text_shapes={
            "회의 메모": [CanvasSemanticShapeMatch("shape:meeting", 1.0)],
        },
    )

    classification = CanvasSemanticRouter(repository, FailingEmbedder()).classify(
        context("회의 메모 찾아줘"),
        "회의 메모",
    )

    assert classification is not None
    assert classification.arguments["shapeIds"] == ["shape:meeting"]
    assert classification.arguments["routingSource"] == "database_text"
    assert repository.search_calls == 0
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "회의 메모"),
    ]


def test_semantic_router_treats_mutation_wording_as_existing_shape_search() -> None:
    repository = FakeRepository(shapes=[CanvasSemanticShapeMatch("shape:auth", 0.91)])

    classification = CanvasSemanticRouter(repository, FakeEmbedder()).classify(
        context("인증 흐름을 다이어그램으로 만들어줘")
    )

    assert classification is not None
    assert classification.intent == "find_shapes"
    assert classification.arguments["shapeIds"] == ["shape:auth"]


def test_semantic_router_falls_back_to_embedding_after_empty_db_search() -> None:
    repository = FakeRepository(
        shapes=[CanvasSemanticShapeMatch("shape:auth", 0.91)],
    )

    classification = CanvasSemanticRouter(repository, FakeEmbedder()).classify(
        context("인증 흐름 어디 있어?"),
        "인증 흐름",
    )

    assert classification is not None
    assert classification.arguments["shapeIds"] == ["shape:auth"]
    assert classification.arguments["routingSource"] == "shape_embedding"
    assert repository.text_search_calls == [
        ("workspace-1", "canvas-1", "인증 흐름"),
    ]
    assert repository.search_calls == 1
