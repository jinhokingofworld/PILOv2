from __future__ import annotations

import json

import pytest

from app.canvas_agent.planner import CanvasAgentPlannerError, parse_canvas_agent_plan


def test_parse_canvas_agent_plan_accepts_bounded_action() -> None:
    result = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "create_draft",
                "message": "선택한 메모를 흐름도 초안으로 정리합니다.",
                "inputJson": json.dumps(
                    {
                        "kind": "organize",
                        "sourceShapeIds": ["shape:1", "shape:2"],
                    }
                ),
            }
        )
    )

    assert result.action_name == "create_draft"
    assert result.input["kind"] == "organize"


def test_parse_canvas_agent_plan_rejects_unknown_action() -> None:
    with pytest.raises(CanvasAgentPlannerError):
        parse_canvas_agent_plan(
            json.dumps(
                {
                    "actionName": "delete_shapes",
                    "message": "삭제합니다.",
                    "inputJson": "{}",
                }
            )
        )
