from __future__ import annotations

from app.canvas_agent.processor import CanvasAgentProcessor
from app.canvas_agent.types import CanvasAgentIntentClassification, CanvasAgentRunContext


class FakeRepository:
    def __init__(self) -> None:
        self.classified: tuple[str, dict[str, object], str, str] | None = None

    def try_acquire_run_lock(self, _run_id: str) -> bool:
        return True

    def release_run_lock(self, _run_id: str) -> None:
        return None

    def get_run_context(self, _job):
        return CanvasAgentRunContext(
            run_id="11111111-1111-1111-1111-111111111111",
            workspace_id="22222222-2222-2222-2222-222222222222",
            canvas_id="33333333-3333-3333-3333-333333333333",
            requested_by_user_id="44444444-4444-4444-4444-444444444444",
            status="planning",
            prompt="회의 메모를 찾아줘",
            request_context={"selectedShapeIds": []},
            previous_action=None,
        )

    def create_classified_intent(
        self,
        _context,
        intent: str,
        arguments: dict[str, object],
        message: str,
        model_name: str,
    ) -> None:
        self.classified = (intent, arguments, message, model_name)

    def update_progress(self, _run_id: str, _message: str) -> None:
        return None

    def mark_failed(self, _run_id: str, _error_message: str) -> None:
        raise AssertionError("intent classifier should not fail")


class FakeIntentClassifier:
    model = "test-model"

    def classify(self, _context) -> CanvasAgentIntentClassification:
        return CanvasAgentIntentClassification(
            intent="find_shapes",
            arguments={"query": "회의"},
            message="회의 관련 도형을 찾고 있습니다.",
        )


def test_canvas_agent_processor_classifies_one_intent() -> None:
    repository = FakeRepository()
    processor = CanvasAgentProcessor(repository, FakeIntentClassifier())

    result = processor.process_payload(
        {
            "jobType": "canvas_agent_step_requested",
            "runId": "11111111-1111-1111-1111-111111111111",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "canvasId": "33333333-3333-3333-3333-333333333333",
            "requestedByUserId": "44444444-4444-4444-4444-444444444444",
            "schemaVersion": "canvas-agent:v1",
        }
    )

    assert result.delete_message is True
    assert result.reason == "canvas_agent_intent_classified"
    assert repository.classified == (
        "find_shapes",
        {"query": "회의", "shapeIds": [], "routingSource": "llm_intent_classifier"},
        "회의 관련 도형을 찾고 있습니다.",
        "test-model",
    )


class FakeClientShapeIntentClassifier:
    model = "test-model"

    def classify(self, _context) -> CanvasAgentIntentClassification:
        return CanvasAgentIntentClassification(
            intent="find_shapes",
            arguments={"query": "회의", "shapeIds": ["shape:meeting"]},
            message="현재 캔버스의 회의 메모를 찾았습니다.",
        )


def test_canvas_agent_processor_prioritizes_client_shape_context() -> None:
    repository = FakeRepository()
    processor = CanvasAgentProcessor(repository, FakeClientShapeIntentClassifier())

    result = processor.process_payload(
        {
            "jobType": "canvas_agent_step_requested",
            "runId": "11111111-1111-1111-1111-111111111111",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "canvasId": "33333333-3333-3333-3333-333333333333",
            "requestedByUserId": "44444444-4444-4444-4444-444444444444",
            "schemaVersion": "canvas-agent:v1",
        }
    )

    assert result.reason == "canvas_agent_intent_classified"
    assert repository.classified == (
        "find_shapes",
        {
            "query": "회의",
            "shapeIds": ["shape:meeting"],
            "routingSource": "client_shape_context",
            "focusResult": True,
        },
        "현재 캔버스의 회의 메모를 찾았습니다.",
        "test-model",
    )


class FakeSemanticRouter:
    model = "test-embedding"

    def __init__(self) -> None:
        self.queries: list[str] = []

    def classify(self, _context, query_override=None) -> CanvasAgentIntentClassification:
        self.queries.append(query_override)
        return CanvasAgentIntentClassification(
            intent="find_shapes",
            arguments={
                "query": query_override,
                "shapeIds": ["shape:indexed"],
                "routingSource": "shape_embedding",
                "focusResult": True,
            },
            message="임베딩에서 관련 도형을 찾았습니다.",
        )


def test_canvas_agent_processor_uses_extracted_query_for_embedding_fallback() -> None:
    repository = FakeRepository()
    semantic_router = FakeSemanticRouter()
    processor = CanvasAgentProcessor(repository, FakeIntentClassifier(), semantic_router)

    result = processor.process_payload(
        {
            "jobType": "canvas_agent_step_requested",
            "runId": "11111111-1111-1111-1111-111111111111",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "canvasId": "33333333-3333-3333-3333-333333333333",
            "requestedByUserId": "44444444-4444-4444-4444-444444444444",
            "schemaVersion": "canvas-agent:v1",
        }
    )

    assert result.reason == "canvas_agent_semantic_intent_classified"
    assert semantic_router.queries == ["회의"]
    assert repository.classified == (
        "find_shapes",
        {
            "query": "회의",
            "shapeIds": ["shape:indexed"],
            "routingSource": "shape_embedding",
            "focusResult": True,
        },
        "임베딩에서 관련 도형을 찾았습니다.",
        "test-embedding",
    )


class FakeHtmlIntentClassifier:
    model = "classifier-model"

    def classify(self, _context) -> CanvasAgentIntentClassification:
        return CanvasAgentIntentClassification(
            intent="generate_html",
            arguments={},
            message="선택 영역을 HTML로 변환합니다.",
        )


class FakeHtmlGenerator:
    model = "html-model"

    def generate(self, _context) -> dict[str, object]:
        return {
            "kind": "html",
            "title": "회의 화면",
            "html": "<!doctype html><html><body>회의</body></html>",
            "sourceShapeIds": ["shape:meeting"],
        }


def test_canvas_agent_processor_generates_html_for_selected_scene() -> None:
    repository = FakeRepository()
    original_get_run_context = repository.get_run_context

    def get_run_context(job):
        context = original_get_run_context(job)
        context.request_context["selectedScene"] = {"shapes": [{"id": "shape:meeting"}]}
        return context

    repository.get_run_context = get_run_context
    processor = CanvasAgentProcessor(
        repository,
        FakeHtmlIntentClassifier(),
        html_generator=FakeHtmlGenerator(),
    )

    result = processor.process_payload(
        {
            "jobType": "canvas_agent_step_requested",
            "runId": "11111111-1111-1111-1111-111111111111",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "canvasId": "33333333-3333-3333-3333-333333333333",
            "requestedByUserId": "44444444-4444-4444-4444-444444444444",
            "schemaVersion": "canvas-agent:v1",
        }
    )

    assert result.reason == "canvas_agent_html_generated"
    assert repository.classified == (
        "generate_html",
        {
            "artifact": {
                "kind": "html",
                "title": "회의 화면",
                "html": "<!doctype html><html><body>회의</body></html>",
                "sourceShapeIds": ["shape:meeting"],
            }
        },
        "선택한 영역의 정적 HTML/CSS 초안을 만들었습니다.",
        "html-model",
    )


def test_canvas_agent_processor_requests_selection_before_html_generation() -> None:
    repository = FakeRepository()
    processor = CanvasAgentProcessor(
        repository,
        FakeHtmlIntentClassifier(),
        html_generator=FakeHtmlGenerator(),
    )

    result = processor.process_payload(
        {
            "jobType": "canvas_agent_step_requested",
            "runId": "11111111-1111-1111-1111-111111111111",
            "workspaceId": "22222222-2222-2222-2222-222222222222",
            "canvasId": "33333333-3333-3333-3333-333333333333",
            "requestedByUserId": "44444444-4444-4444-4444-444444444444",
            "schemaVersion": "canvas-agent:v1",
        }
    )

    assert result.reason == "canvas_agent_intent_classified"
    assert repository.classified[0] == "generate_html"
    assert repository.classified[1] == {"missingSelection": True}
    assert repository.classified[2] == "HTML로 만들 캔버스 영역을 먼저 선택해주세요."
