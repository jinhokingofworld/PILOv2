from __future__ import annotations

import json
from typing import Any

from app.canvas_agent.planning.prompts import system_prompt, user_prompt
from app.canvas_agent.planning.tool_catalog import allowed_action_names_for_context
from app.canvas_agent.types import CANVAS_AGENT_ACTIONS, CanvasAgentPlan, CanvasAgentRunContext
from app.meeting_report_processor import InfrastructureError


class CanvasAgentPlannerError(Exception):
    pass


class CanvasAgentPlannerContractError(CanvasAgentPlannerError):
    pass


CODE_GENERATION_FAILURE_MESSAGE = "코드 생성 중 오류가 났어요. 다시 시도해 주세요."
CODE_CONTRACT_RETRY_INSTRUCTION = (
    "The previous planner output violated the code draft contract. "
    "For this code generation request, return actionName=create_draft and inputJson.kind=code. "
    "Every code node must include title as a file name, language, and a non-empty code field. "
    "Do not return an empty code block."
)


class OpenAiCanvasAgentPlanner:
    def __init__(self, api_key: str, model: str, timeout_seconds: float | None = None) -> None:
        from openai import OpenAI

        kwargs: dict[str, object] = {"api_key": api_key}
        if timeout_seconds is not None:
            kwargs["timeout"] = timeout_seconds
        self.client = OpenAI(**kwargs)
        self.model = model

    def plan(self, context: CanvasAgentRunContext) -> CanvasAgentPlan:
        allowed_actions = allowed_action_names_for_context(context)
        for attempt in range(2):
            try:
                system_content = system_prompt()
                if attempt > 0:
                    system_content = f"{system_content} {CODE_CONTRACT_RETRY_INSTRUCTION}"
                response = self.client.responses.create(
                    model=self.model,
                    input=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_prompt(context)},
                    ],
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "canvas_agent_plan",
                            "strict": True,
                            "schema": _schema(allowed_actions),
                        }
                    },
                )
            except _retryable_errors() as error:
                raise InfrastructureError(
                    "OpenAI Canvas Agent planner retryable failure"
                ) from error
            except Exception as error:
                raise CanvasAgentPlannerError("Canvas Agent planner provider failure") from error

            output_text = getattr(response, "output_text", None)
            if not isinstance(output_text, str) or not output_text.strip():
                output_text = _extract_response_text(response)

            plan = parse_canvas_agent_plan(output_text, allowed_actions)
            try:
                return _enforce_code_generation_contract(plan, context)
            except CanvasAgentPlannerContractError as error:
                if attempt == 0:
                    continue
                raise CanvasAgentPlannerError(CODE_GENERATION_FAILURE_MESSAGE) from error

        raise CanvasAgentPlannerError(CODE_GENERATION_FAILURE_MESSAGE)


def parse_canvas_agent_plan(
    output_text: str,
    allowed_actions: set[str] | None = None,
) -> CanvasAgentPlan:
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
    valid_actions = allowed_actions or CANVAS_AGENT_ACTIONS
    if not isinstance(action_name, str) or action_name not in valid_actions:
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


def _schema(allowed_actions: set[str] | None = None) -> dict[str, object]:
    valid_actions = allowed_actions or CANVAS_AGENT_ACTIONS
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["actionName", "message", "inputJson"],
        "properties": {
            "actionName": {"type": "string", "enum": sorted(valid_actions)},
            "message": {"type": "string"},
            "inputJson": {"type": "string"},
        },
    }


def _enforce_code_generation_contract(
    plan: CanvasAgentPlan,
    context: CanvasAgentRunContext,
) -> CanvasAgentPlan:
    if not _looks_like_code_generation_request(context):
        return plan
    if plan.action_name != "create_draft":
        raise CanvasAgentPlannerContractError("Code generation must use create_draft")

    action_input = dict(plan.input)
    action_input["kind"] = "code"
    _normalize_code_node_file_names(action_input)
    if not _has_non_empty_code_payload(action_input):
        raise CanvasAgentPlannerContractError("Code generation returned no code")

    return CanvasAgentPlan(
        action_name=plan.action_name,
        input=action_input,
        message=plan.message,
    )


def _looks_like_code_generation_request(context: CanvasAgentRunContext) -> bool:
    if context.request_context.get("toolHelpMode") is True:
        return False
    prompt = context.prompt.lower()
    code_terms = (
        "코드",
        "구현",
        "컴포넌트",
        "파일",
        "code",
        "component",
        "snippet",
        "tsx",
        "jsx",
        "typescript",
        "javascript",
    )
    generation_terms = (
        "만들",
        "짜",
        "작성",
        "생성",
        "구현",
        "그려",
        "create",
        "generate",
        "write",
        "implement",
    )
    return any(term in prompt for term in code_terms) and any(
        term in prompt for term in generation_terms
    )


def _normalize_code_node_file_names(action_input: dict[str, object]) -> None:
    nodes = action_input.get("nodes")
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict) or not _is_code_node_kind(_node_kind(node)):
            continue
        file_name = node.get("fileName")
        if not _non_empty_string(node.get("title")) and _non_empty_string(file_name):
            node["title"] = file_name


def _has_non_empty_code_payload(action_input: dict[str, object]) -> bool:
    nodes = action_input.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        return _non_empty_string(action_input.get("code"))

    code_nodes = [
        node for node in nodes if isinstance(node, dict) and _is_code_node_kind(_node_kind(node))
    ]
    if not code_nodes:
        return False

    return all(
        _non_empty_string(node.get("title"))
        and _non_empty_string(node.get("language"))
        and _non_empty_string(node.get("code"))
        for node in code_nodes
    )


def _node_kind(node: dict[object, object]) -> str:
    value = node.get("kind", node.get("tool"))
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace("-", "_")


def _is_code_node_kind(value: str) -> bool:
    return value in {"code", "code_block"}


def _non_empty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


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
