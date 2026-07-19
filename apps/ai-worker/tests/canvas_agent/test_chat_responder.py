from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.chat_responder import (
    CanvasAgentChatResponderError,
    build_canvas_agent_chat_request,
    parse_canvas_agent_chat_response,
)
from app.canvas_agent.types import CanvasAgentRunContext


def test_parse_canvas_agent_chat_response_accepts_bounded_answer() -> None:
    answer = parse_canvas_agent_chat_response(
        json.dumps(
            {"answer": "REST API는 HTTP로 자원을 다루는 인터페이스입니다."}, ensure_ascii=False
        )
    )

    assert answer == "REST API는 HTTP로 자원을 다루는 인터페이스입니다."


def test_parse_canvas_agent_chat_response_rejects_empty_answer() -> None:
    with pytest.raises(CanvasAgentChatResponderError):
        parse_canvas_agent_chat_response(json.dumps({"answer": ""}))


def test_general_chat_omits_selected_scene() -> None:
    payload = build_canvas_agent_chat_request(run_context(), "none")

    assert payload["contextScope"] == "none"
    assert "selectionContext" not in payload
    assert payload["conversation"] == {
        "messages": [{"role": "user", "content": "아까 답변을 더 설명해줘"}],
        "lastTask": {
            "prompt": "대시보드 구성을 평가해줘",
            "status": "completed",
            "summary": "정보 우선순위를 정리해 보세요.",
        },
    }


def test_selection_chat_replaces_internal_shape_ids() -> None:
    payload = build_canvas_agent_chat_request(run_context(), "selected_scene")
    selection = payload["selectionContext"]

    assert isinstance(selection, dict)
    assert selection["rootShapeRefs"] == ["shape-1"]
    assert selection["shapes"] == [
        {
            "ref": "shape-1",
            "shapeType": "frame",
            "title": "대시보드",
            "x": 0,
            "y": 0,
            "width": 1200,
            "height": 800,
            "rotation": 0,
            "zIndex": 0,
            "depth": 0,
            "parentRef": None,
            "style": {"backgroundColor": "#ffffff"},
        },
        {
            "ref": "shape-2",
            "shapeType": "text",
            "text": "팀 운영 대시보드",
            "x": 40,
            "y": 32,
            "width": 300,
            "height": 50,
            "rotation": 0,
            "zIndex": 1,
            "depth": 1,
            "parentRef": "shape-1",
            "style": {"color": "black"},
        },
    ]
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "shape:frame-secret" not in serialized
    assert "shape:title-secret" not in serialized
    assert "asset:private" not in serialized


def run_context() -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-private",
        workspace_id="workspace-private",
        canvas_id="canvas-private",
        requested_by_user_id="user-private",
        status="planning",
        prompt="이 프레임 구성이 어때?",
        request_context={
            "conversationContext": {
                "messages": [
                    {"role": "user", "content": "아까 답변을 더 설명해줘"},
                ],
                "lastTask": {
                    "prompt": "대시보드 구성을 평가해줘",
                    "status": "completed",
                    "summary": "정보 우선순위를 정리해 보세요.",
                    "draftId": "draft-private",
                },
            },
            "selectedScene": {
                "selectionMode": "frame",
                "bounds": {"width": 1200, "height": 800},
                "rootShapeIds": ["shape:frame-secret"],
                "shapes": [
                    {
                        "id": "shape:frame-secret",
                        "shapeType": "frame",
                        "parentId": None,
                        "x": 0,
                        "y": 0,
                        "width": 1200,
                        "height": 800,
                        "rotation": 0,
                        "zIndex": 0,
                        "depth": 0,
                        "title": "대시보드",
                        "assetRef": "asset:private",
                        "style": {"backgroundColor": "#ffffff"},
                    },
                    {
                        "id": "shape:title-secret",
                        "shapeType": "text",
                        "parentId": "shape:frame-secret",
                        "x": 40,
                        "y": 32,
                        "width": 300,
                        "height": 50,
                        "rotation": 0,
                        "zIndex": 1,
                        "depth": 1,
                        "text": "팀 운영 대시보드",
                        "style": {"color": "black"},
                    },
                ],
            },
        },
        previous_action=None,
    )
