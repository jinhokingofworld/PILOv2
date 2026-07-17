from __future__ import annotations

import json
from typing import Any

from app.canvas_agent.planning.prompts import system_prompt, user_prompt
from app.canvas_agent.planning.tool_catalog import allowed_intent_names_for_context
from app.canvas_agent.types import (
    CANVAS_AGENT_INTENTS,
    CanvasAgentIntentClassification,
    CanvasAgentRunContext,
)
from app.meeting_report_processor import InfrastructureError


class CanvasAgentIntentClassifierError(Exception):
    pass


class OpenAiCanvasAgentIntentClassifier:
    def __init__(self, api_key: str, model: str, timeout_seconds: float | None = None) -> None:
        from openai import OpenAI

        kwargs: dict[str, object] = {"api_key": api_key}
        if timeout_seconds is not None:
            kwargs["timeout"] = timeout_seconds
        self.client = OpenAI(**kwargs)
        self.model = model

    def classify(self, context: CanvasAgentRunContext) -> CanvasAgentIntentClassification:
        allowed_intents = allowed_intent_names_for_context(context)
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
                        "name": "canvas_agent_intent",
                        "strict": True,
                        "schema": _schema(allowed_intents),
                    }
                },
            )
        except _retryable_errors() as error:
            raise InfrastructureError(
                "OpenAI Canvas Agent intent classifier retryable failure"
            ) from error
        except Exception as error:
            raise CanvasAgentIntentClassifierError(
                "Canvas Agent intent classifier provider failure"
            ) from error

        output_text = getattr(response, "output_text", None)
        if not isinstance(output_text, str) or not output_text.strip():
            output_text = _extract_response_text(response)

        return parse_canvas_agent_intent_classification(output_text, allowed_intents)


def parse_canvas_agent_intent_classification(
    output_text: str,
    allowed_intents: set[str] | None = None,
) -> CanvasAgentIntentClassification:
    if not isinstance(output_text, str) or not output_text.strip():
        raise CanvasAgentIntentClassifierError("Canvas Agent intent classifier returned no output")

    try:
        payload = json.loads(output_text)
    except json.JSONDecodeError as error:
        raise CanvasAgentIntentClassifierError(
            "Canvas Agent intent classifier returned invalid JSON"
        ) from error

    if not isinstance(payload, dict):
        raise CanvasAgentIntentClassifierError(
            "Canvas Agent intent classifier output must be an object"
        )

    intent = payload.get("intent")
    message = payload.get("message")
    arguments = payload.get("arguments")
    valid_intents = allowed_intents or CANVAS_AGENT_INTENTS
    if not isinstance(intent, str) or intent not in valid_intents:
        raise CanvasAgentIntentClassifierError("Canvas Agent intent is invalid")
    if not isinstance(message, str) or not message.strip():
        raise CanvasAgentIntentClassifierError("Canvas Agent intent message is invalid")
    if not isinstance(arguments, dict):
        raise CanvasAgentIntentClassifierError("Canvas Agent intent arguments are invalid")

    sanitized_arguments = _sanitize_object(arguments)
    if intent == "find_shapes":
        query = sanitized_arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            raise CanvasAgentIntentClassifierError("Canvas Agent find_shapes query is required")
        sanitized_arguments["query"] = query.strip()[:120]

    return CanvasAgentIntentClassification(
        intent=intent,
        arguments=sanitized_arguments,
        message=message.strip()[:1000],
    )


def _schema(allowed_intents: set[str] | None = None) -> dict[str, object]:
    valid_intents = allowed_intents or CANVAS_AGENT_INTENTS
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["intent", "message", "arguments"],
        "properties": {
            "intent": {"type": "string", "enum": sorted(valid_intents)},
            "message": {"type": "string"},
            "arguments": {
                "type": "object",
                "additionalProperties": False,
                "required": ["query"],
                "properties": {"query": {"type": "string"}},
            },
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
