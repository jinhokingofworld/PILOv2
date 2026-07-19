from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.planner import (
    CanvasAgentIntentClassifierError,
    parse_canvas_agent_intent_classification,
)
from app.canvas_agent.planning.prompts import system_prompt, user_prompt
from app.canvas_agent.types import CanvasAgentRunContext


def test_parse_intent_classification_accepts_existing_shape_search() -> None:
    result = parse_canvas_agent_intent_classification(
        json.dumps(
            {
                "intent": "find_shapes",
                "message": "관련 도형을 찾습니다.",
                "arguments": {"query": "로그인 흐름", "shapeIds": []},
            }
        )
    )

    assert result.intent == "find_shapes"
    assert result.arguments == {"query": "로그인 흐름", "shapeIds": []}


@pytest.mark.parametrize("intent", ["create_shapes", "connect_shapes", "delete_shapes"])
def test_parse_intent_classification_rejects_shape_mutation_intents(intent: str) -> None:
    with pytest.raises(CanvasAgentIntentClassifierError):
        parse_canvas_agent_intent_classification(
            json.dumps(
                {
                    "intent": intent,
                    "message": "Canvas를 변경합니다.",
                    "arguments": {"query": "로그인 흐름"},
                }
            )
        )


def test_parse_intent_classification_requires_find_shapes_query() -> None:
    with pytest.raises(CanvasAgentIntentClassifierError):
        parse_canvas_agent_intent_classification(
            json.dumps(
                {
                    "intent": "find_shapes",
                    "message": "관련 도형을 찾습니다.",
                    "arguments": {"query": ""},
                }
            )
        )


def test_user_prompt_exposes_only_current_canvas_intents() -> None:
    normal_payload = json.loads(user_prompt(run_context(tool_help_mode=False)))
    tool_help_payload = json.loads(user_prompt(run_context(tool_help_mode=True)))

    normal_intents = {intent["name"] for intent in normal_payload["allowedIntents"]}
    tool_help_intents = {intent["name"] for intent in tool_help_payload["allowedIntents"]}

    expected = {"chat", "find_shapes", "generate_html", "import_drive_file", "unsupported"}
    assert normal_intents == expected
    assert tool_help_intents == expected
    assert "allowedActions" not in normal_payload
    assert "availableCanvasTools" not in normal_payload
    assert "intent classifier" in system_prompt()
    assert "same language as the user's prompt" in system_prompt()
    assert "never translate them" in system_prompt()
    assert "Ordinary questions must not be classified as unsupported" in system_prompt()


def test_parse_intent_classification_accepts_selection_chat() -> None:
    result = parse_canvas_agent_intent_classification(
        json.dumps(
            {
                "intent": "chat",
                "message": "선택한 프레임을 살펴볼게요.",
                "arguments": {
                    "query": "",
                    "shapeIds": [],
                    "contextScope": "selected_scene",
                    "reasonCode": "selection_question",
                },
            },
            ensure_ascii=False,
        )
    )

    assert result.intent == "chat"
    assert result.arguments == {
        "contextScope": "selected_scene",
        "reasonCode": "selection_question",
    }


def test_parse_intent_classification_rejects_invalid_chat_scope() -> None:
    with pytest.raises(CanvasAgentIntentClassifierError):
        parse_canvas_agent_intent_classification(
            json.dumps(
                {
                    "intent": "chat",
                    "message": "답변할게요.",
                    "arguments": {
                        "query": "",
                        "shapeIds": [],
                        "contextScope": "whole_canvas",
                        "reasonCode": "general_question",
                    },
                },
                ensure_ascii=False,
            )
        )


def test_parse_intent_classification_accepts_html_generation() -> None:
    result = parse_canvas_agent_intent_classification(
        json.dumps(
            {
                "intent": "generate_html",
                "message": "선택 영역을 HTML로 변환합니다.",
                "arguments": {"query": "", "shapeIds": []},
            }
        )
    )

    assert result.intent == "generate_html"
    assert result.arguments == {}


def test_parse_intent_classification_accepts_drive_image_import() -> None:
    result = parse_canvas_agent_intent_classification(
        json.dumps(
            {
                "intent": "import_drive_file",
                "message": "팀에서 올린 로고 이미지를 찾습니다.",
                "arguments": {"query": "PILO 로고", "shapeIds": []},
            }
        )
    )

    assert result.intent == "import_drive_file"
    assert result.arguments == {"query": "PILO 로고"}


def test_classifier_prompt_redacts_full_selected_scene() -> None:
    context = run_context(tool_help_mode=False)
    context.request_context["selectedScene"] = {
        "selectionMode": "frame",
        "shapes": [{"id": "shape:secret", "text": "페이지 내용"}],
    }

    payload = json.loads(user_prompt(context))

    assert payload["requestContext"]["selectedScene"] == {
        "available": True,
        "selectionMode": "frame",
        "shapeCount": 1,
    }


def run_context(tool_help_mode: bool) -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="로그인 메모 찾아줘",
        request_context={
            "selectedShapeIds": [],
            "shapeSummaries": [],
            "toolHelpMode": tool_help_mode,
        },
        previous_action=None,
    )
