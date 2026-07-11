from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.planner import CanvasAgentPlannerError, parse_canvas_agent_plan


def test_parse_canvas_agent_plan_accepts_bounded_action() -> None:
    result = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "create_draft",
                "message": "선택한 메모를 흐름도 초안으로 정리합니다.",
                "inputJson": json.dumps(
                    {
                        "kind": "code",
                        "title": "JWT auth example",
                        "nodes": [
                            {
                                "id": "code-1",
                                "kind": "code",
                                "x": 100,
                                "y": 100,
                                "width": 360,
                                "height": 240,
                                "title": "auth.ts",
                                "text": "export const verifyJwt = () => true;",
                            }
                        ],
                    }
                ),
            }
        )
    )

    assert result.action_name == "create_draft"
    assert result.input["kind"] == "code"
    assert result.input["nodes"][0]["kind"] == "code"


def test_parse_canvas_agent_plan_accepts_generated_canvas_nodes() -> None:
    result = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "create_draft",
                "message": "로그인 흐름을 Canvas 도구로 배치합니다.",
                "inputJson": json.dumps(
                    {
                        "kind": "diagram",
                        "title": "로그인 흐름",
                        "summary": "프레임과 도형으로 로그인 흐름을 구성합니다.",
                        "nodes": [
                            {
                                "id": "frame-1",
                                "kind": "frame",
                                "x": 100,
                                "y": 100,
                                "width": 720,
                                "height": 360,
                                "title": "로그인 흐름",
                            },
                            {
                                "id": "step-1",
                                "kind": "rectangle",
                                "x": 48,
                                "y": 120,
                                "width": 180,
                                "height": 88,
                                "title": "로그인 페이지",
                                "parentId": "frame-1",
                            },
                        ],
                        "connections": [],
                        "recommendedColors": [
                            {
                                "name": "blue",
                                "label": "파랑",
                                "usage": "핵심 흐름을 표현합니다.",
                            }
                        ],
                    }
                ),
            }
        )
    )

    assert result.action_name == "create_draft"
    assert result.input["nodes"][1]["kind"] == "rectangle"
    assert result.input["recommendedColors"][0]["name"] == "blue"


def test_parse_canvas_agent_plan_accepts_connect_shapes() -> None:
    result = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "connect_shapes",
                "message": "두 도형을 연결합니다.",
                "inputJson": json.dumps(
                    {
                        "fromShapeId": "shape:login",
                        "toShapeId": "shape:auth",
                        "connectionKind": "arrow",
                    }
                ),
            }
        )
    )

    assert result.action_name == "connect_shapes"
    assert result.input["fromShapeId"] == "shape:login"


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
