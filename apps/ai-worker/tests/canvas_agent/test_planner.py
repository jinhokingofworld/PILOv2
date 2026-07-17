from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.planner import CanvasAgentPlannerError, parse_canvas_agent_plan
from app.canvas_agent.planning.prompts import system_prompt, user_prompt
from app.canvas_agent.types import CanvasAgentRunContext


def test_parse_canvas_agent_plan_accepts_existing_shape_search() -> None:
    result = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "find_shapes",
                "message": "관련 도형을 찾습니다.",
                "inputJson": json.dumps(
                    {
                        "query": "로그인 흐름",
                        "shapeIds": ["shape:login"],
                        "focusResult": True,
                    }
                ),
            }
        )
    )

    assert result.action_name == "find_shapes"
    assert result.input["shapeIds"] == ["shape:login"]


@pytest.mark.parametrize("action_name", ["create_draft", "connect_shapes", "delete_shapes"])
def test_parse_canvas_agent_plan_rejects_shape_mutation_actions(action_name: str) -> None:
    with pytest.raises(CanvasAgentPlannerError):
        parse_canvas_agent_plan(
            json.dumps(
                {
                    "actionName": action_name,
                    "message": "Canvas를 변경합니다.",
                    "inputJson": "{}",
                }
            )
        )


def test_parse_canvas_agent_plan_rejects_disallowed_tool_help_action() -> None:
    with pytest.raises(CanvasAgentPlannerError):
        parse_canvas_agent_plan(
            json.dumps(
                {
                    "actionName": "find_canvas_tool",
                    "message": "Memo 도구를 찾겠습니다.",
                    "inputJson": json.dumps(
                        {"toolTarget": "toolbar.memo", "toolTargetLabel": "Memo"}
                    ),
                }
            ),
            {"find_shapes", "select_shapes", "focus_viewport", "finish"},
        )


def test_user_prompt_exposes_only_read_only_canvas_actions() -> None:
    normal_payload = json.loads(user_prompt(run_context(tool_help_mode=False)))
    tool_help_payload = json.loads(user_prompt(run_context(tool_help_mode=True)))

    normal_actions = {action["name"] for action in normal_payload["allowedActions"]}
    tool_help_actions = {action["name"] for action in tool_help_payload["allowedActions"]}

    assert normal_actions == {"find_shapes", "select_shapes", "focus_viewport", "finish"}
    assert tool_help_actions == normal_actions | {"find_canvas_tool"}
    assert "availableCanvasTools" not in normal_payload
    assert "draftTemplates" not in normal_payload
    assert "read-only" in system_prompt()


def run_context(tool_help_mode: bool) -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="로그인 메모 찾아줘",
        request_context={"selectedShapeIds": [], "toolHelpMode": tool_help_mode},
        previous_action=None,
    )
