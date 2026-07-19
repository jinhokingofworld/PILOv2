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

        classification = parse_canvas_agent_intent_classification(output_text, allowed_intents)
        return _restrict_shape_ids_to_context(classification, context)


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
        shape_ids = sanitized_arguments.get("shapeIds")
        sanitized_arguments["shapeIds"] = (
            [item for item in shape_ids if isinstance(item, str)][:40]
            if isinstance(shape_ids, list)
            else []
        )
    elif intent == "import_drive_file":
        query = sanitized_arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            raise CanvasAgentIntentClassifierError(
                "Canvas Agent import_drive_file query is required"
            )
        sanitized_arguments = {"query": query.strip()[:120]}
    elif intent == "generate_html":
        sanitized_arguments = {}
    elif intent == "chat":
        context_scope = sanitized_arguments.get("contextScope")
        if context_scope not in {"none", "selected_scene"}:
            raise CanvasAgentIntentClassifierError("Canvas Agent chat contextScope is invalid")
        reason_code = sanitized_arguments.get("reasonCode")
        if reason_code not in {
            "general_question",
            "selection_question",
            "follow_up_question",
        }:
            raise CanvasAgentIntentClassifierError("Canvas Agent chat reasonCode is invalid")
        sanitized_arguments = {
            "contextScope": context_scope,
            "reasonCode": reason_code,
        }
    elif intent == "unsupported":
        query = sanitized_arguments.get("query")
        sanitized_arguments = {"query": query.strip()[:120] if isinstance(query, str) else ""}

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
                "required": ["query", "shapeIds", "contextScope", "reasonCode"],
                "properties": {
                    "query": {"type": "string"},
                    "shapeIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 40,
                    },
                    "contextScope": {
                        "type": "string",
                        "enum": ["none", "selected_scene"],
                    },
                    "reasonCode": {"type": "string"},
                },
            },
        },
    }


def _restrict_shape_ids_to_context(
    classification: CanvasAgentIntentClassification,
    context: CanvasAgentRunContext,
) -> CanvasAgentIntentClassification:
    if classification.intent != "find_shapes":
        return classification

    summaries = context.request_context.get("shapeSummaries")
    allowed_ids = (
        {
            item.get("id")
            for item in summaries
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        if isinstance(summaries, list)
        else set()
    )
    arguments = dict(classification.arguments)
    shape_ids = arguments.get("shapeIds")
    arguments["shapeIds"] = (
        [
            shape_id
            for shape_id in shape_ids
            if isinstance(shape_id, str) and shape_id in allowed_ids
        ]
        if isinstance(shape_ids, list)
        else []
    )
    return CanvasAgentIntentClassification(
        intent=classification.intent,
        arguments=arguments,
        message=classification.message,
    )


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
