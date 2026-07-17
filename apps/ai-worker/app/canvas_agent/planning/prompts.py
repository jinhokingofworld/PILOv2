from __future__ import annotations

import json

from app.canvas_agent.planning.tool_catalog import allowed_intents_for_context
from app.canvas_agent.types import CanvasAgentRunContext


def system_prompt() -> str:
    return (
        "You are the PILO Canvas AI intent classifier. Return only JSON matching the schema. "
        "Classify the request into exactly one allowed intent and extract typed arguments. "
        "Do not execute actions or promise Canvas mutations. Canvas AI is currently read-only. "
        "Every request reaching this classifier is interpreted as a search for existing Canvas "
        "content, even when the wording asks to create, update, connect, or delete something. "
        "For find_shapes, extract a concise query naming the existing content the user wants. "
        "For example, '대시보드 와이어프레임 만들어줘' becomes query "
        "'대시보드 와이어프레임'. Never access Calendar, Issue, PR, Meeting, or any "
        "external-domain resource. "
        "requestContext.conversationContext is short-lived memory from the same Canvas AI "
        "chat panel. Use it only to resolve a follow-up search query; the current prompt remains "
        "authoritative. "
        "Never include raw provider data, full Canvas snapshots, tokens, credentials, secrets, "
        "or lengthy text."
    )


def user_prompt(context: CanvasAgentRunContext) -> str:
    return json.dumps(
        {
            "runId": context.run_id,
            "prompt": context.prompt,
            "requestContext": context.request_context,
            "previousAction": context.previous_action,
            "allowedIntents": allowed_intents_for_context(context),
        },
        ensure_ascii=False,
    )
