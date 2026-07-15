from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.planner import (
    CanvasAgentPlannerContractError,
    CanvasAgentPlannerError,
    _enforce_code_generation_contract,
    parse_canvas_agent_plan,
)
from app.canvas_agent.planning.prompts import user_prompt
from app.canvas_agent.types import CanvasAgentRunContext


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


def test_code_generation_contract_forces_code_kind_and_requires_code_content() -> None:
    plan = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "create_draft",
                "message": "로그인 페이지 코드를 만들게요.",
                "inputJson": json.dumps(
                    {
                        "kind": "diagram",
                        "title": "로그인 페이지 코드",
                        "nodes": [
                            {
                                "id": "code-1",
                                "kind": "code",
                                "x": 100,
                                "y": 100,
                                "width": 480,
                                "height": 320,
                                "title": "LoginPage.tsx",
                                "language": "tsx",
                                "code": (
                                    "export function LoginPage() { " "return <main>Login</main>; }"
                                ),
                            }
                        ],
                    }
                ),
            }
        )
    )

    result = _enforce_code_generation_contract(
        plan,
        code_run_context("이 구조에 맞는 로그인 페이지 코드 만들어줘"),
    )

    assert result.input["kind"] == "code"
    assert result.input["nodes"][0]["title"] == "LoginPage.tsx"
    assert result.input["nodes"][0]["language"] == "tsx"
    assert result.input["nodes"][0]["code"]


def test_code_generation_contract_rejects_empty_code_node() -> None:
    plan = parse_canvas_agent_plan(
        json.dumps(
            {
                "actionName": "create_draft",
                "message": "로그인 페이지 코드를 만들게요.",
                "inputJson": json.dumps(
                    {
                        "kind": "code",
                        "nodes": [
                            {
                                "id": "code-1",
                                "kind": "code",
                                "title": "LoginPage.tsx",
                                "language": "tsx",
                                "code": "",
                            }
                        ],
                    }
                ),
            }
        )
    )

    with pytest.raises(CanvasAgentPlannerContractError):
        _enforce_code_generation_contract(
            plan,
            code_run_context("로그인 페이지 코드 만들어줘"),
        )


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
            {"find_shapes", "connect_shapes", "create_draft", "finish"},
        )


def test_user_prompt_allows_tool_help_only_in_tool_help_mode() -> None:
    normal_payload = json.loads(user_prompt(run_context(tool_help_mode=False)))
    tool_help_payload = json.loads(user_prompt(run_context(tool_help_mode=True)))

    normal_actions = {action["name"] for action in normal_payload["allowedActions"]}
    tool_help_actions = {action["name"] for action in tool_help_payload["allowedActions"]}

    assert "find_canvas_tool" not in normal_actions
    assert "find_canvas_tool" in tool_help_actions


def code_run_context(prompt: str) -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt=prompt,
        request_context={"selectedShapeIds": [], "toolHelpMode": False},
        previous_action=None,
    )


def run_context(tool_help_mode: bool) -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="메모랑 프레임이랑 연결해줘",
        request_context={"selectedShapeIds": [], "toolHelpMode": tool_help_mode},
        previous_action=None,
    )
