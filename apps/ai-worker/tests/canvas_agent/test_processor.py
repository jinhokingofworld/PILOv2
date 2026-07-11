from __future__ import annotations

from app.canvas_agent.processor import CanvasAgentProcessor
from app.canvas_agent.types import CanvasAgentPlan, CanvasAgentRunContext


class FakeRepository:
    def __init__(self) -> None:
        self.planned: tuple[str, dict[str, object], str, str] | None = None

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

    def create_planned_action(
        self,
        _context,
        action_name: str,
        action_input: dict[str, object],
        message: str,
        model_name: str,
    ) -> None:
        self.planned = (action_name, action_input, message, model_name)

    def update_progress(self, _run_id: str, _message: str) -> None:
        return None

    def mark_failed(self, _run_id: str, _error_message: str) -> None:
        raise AssertionError("planner should not fail")


class FakePlanner:
    model = "test-model"

    def plan(self, _context) -> CanvasAgentPlan:
        return CanvasAgentPlan(
            action_name="find_shapes",
            input={"query": "회의"},
            message="회의 관련 도형을 찾고 있습니다.",
        )


def test_canvas_agent_processor_plans_one_action() -> None:
    repository = FakeRepository()
    processor = CanvasAgentProcessor(repository, FakePlanner())

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
    assert result.reason == "canvas_agent_action_planned"
    assert repository.planned == (
        "find_shapes",
        {"query": "회의", "routingSource": "llm_planner"},
        "회의 관련 도형을 찾고 있습니다.",
        "test-model",
    )
