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
                "arguments": {"query": "로그인 흐름"},
            }
        )
    )

    assert result.intent == "find_shapes"
    assert result.arguments == {"query": "로그인 흐름"}


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

    assert normal_intents == {"find_shapes"}
    assert tool_help_intents == {"find_shapes"}
    assert "allowedActions" not in normal_payload
    assert "availableCanvasTools" not in normal_payload
    assert "intent classifier" in system_prompt()


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
