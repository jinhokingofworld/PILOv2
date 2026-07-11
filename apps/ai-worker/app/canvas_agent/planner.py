from __future__ import annotations

import json
from typing import Any

from app.canvas_agent.prompts import system_prompt, user_prompt
from app.canvas_agent.types import CANVAS_AGENT_ACTIONS, CanvasAgentPlan, CanvasAgentRunContext
from app.meeting_report_processor import InfrastructureError


class CanvasAgentPlannerError(Exception):
    pass


class OpenAiCanvasAgentPlanner:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import OpenAI

        self.client = OpenAI(api_key=api_key)
        self.model = model

    def plan(self, context: CanvasAgentRunContext) -> CanvasAgentPlan:
        try:
            response = self.client.responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": system_prompt()},
                    {"role": "user", "content": user_prompt(context)},
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "canvas_agent_plan",
                        "strict": True,
                        "schema": _schema(),
                    }
                },
            )
        except _retryable_errors() as error:
            raise InfrastructureError("OpenAI Canvas Agent planner retryable failure") from error
        except Exception as error:
            raise CanvasAgentPlannerError("Canvas Agent planner provider failure") from error

        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text.strip():
            output_text = _extract_response_text(response)

        return parse_canvas_agent_plan(output_text)


def parse_canvas_agent_plan(output_text: str) -> CanvasAgentPlan:
    if not isinstance(output_text, str) or not output_text.strip():
        raise CanvasAgentPlannerError("Canvas Agent planner returned no output")

    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError as error:
        raise CanvasAgentPlannerError("Canvas Agent planner returned invalid JSON") from error

    if not isinstance(payload, dict):
        raise CanvasAgentPlannerError("Canvas Agent planner output must be an object")

    action_name = payload.get("actionName")
    message = payload.get("message")
    input_json = payload.get("inputJson")
    if not isinstance(action_name, str) or action_name not in CANVAS_AGENT_ACTIONS:
        raise CanvasAgentPlannerError("Canvas Agent planner action is invalid")
    if not isinstance(message, str) or not message.strip():
        raise CanvasAgentPlannerError("Canvas Agent planner message is invalid")
    if not isinstance(input_json, str):
        raise CanvasAgentPlannerError("Canvas Agent planner inputJson is invalid")

    try:
        action_input = json.loads(input_json)
    except json.JSONDecodeError as error:
        raise CanvasAgentPlannerError("Canvas Agent planner inputJson must be JSON") from error
    if not isinstance(action_input, dict):
        raise CanvasAgentPlannerError("Canvas Agent planner inputJson must be an object")

    return CanvasAgentPlan(
        action_name=action_name,
        input=_sanitize_object(action_input),
        message=message.strip()[:1000],
    )


def _schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["actionName", "message", "inputJson"],
        "properties": {
            "actionName": {"type": "string", "enum": sorted(CANVAS_AGENT_ACTIONS)},
            "message": {"type": "string"},
            "inputJson": {"type": "string"},
        },
    }


def _sanitize_object(value: dict[object, object]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str) or _is_forbidden_key(key):
            continue
        result[key] = _sanitize_value(item)
    return result


def _sanitize_value(value: object) -> object:
    if isinstance(value, dict):
        return _sanitize_object(value)
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value[:100]]
    if isinstance(value, str):
        return value[:12000]
    if isinstance(value, int | float | bool) or value is None:
        return value
    return None


def _is_forbidden_key(key: str) -> bool:
    normalized = key.replace("_", "").replace("-", "").lower()
    return any(
        part in normalized
        for part in ("token", "secret", "credential", "password", "cookie", "authorization")
    )


def _retryable_errors() -> tuple[type[BaseException], ...]:
    try:
        from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError
    except Exception:
        return ()
    return (APIConnectionError, APITimeoutError, InternalServerError, RateLimitError)


def _extract_response_text(response: Any) -> str:
    output = getattr(response, "output", None)
    if not isinstance(output, list):
        return ""
    texts: list[str] = []
    for item in output:
        content = getattr(item, "content", None)
        if not isinstance(content, list):
            continue
        for part in content:
            text = getattr(part, "text", None)
            if isinstance(text, str):
                texts.append(text)
    return "".join(texts)
