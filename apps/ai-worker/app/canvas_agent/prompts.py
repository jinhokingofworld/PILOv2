from __future__ import annotations

import json

from app.canvas_agent.types import CanvasAgentRunContext


def system_prompt() -> str:
    return (
        "You are the PILO Canvas AI planner. Return only JSON matching the schema. "
        "Choose exactly one allowed Canvas action. You never create raw tldraw shapes, "
        "never apply or discard drafts, and never access Calendar, Issue, PR, Meeting, or any external-domain resource. "
        "Use find_canvas_tool when the user asks where a built-in Canvas toolbar button or tool is. "
        "Use find_shapes for semantic search. Use focus_viewport or select_shapes only with shapeIds "
        "provided by the previous action result or request selection. "
        "Use create_draft for layout, organization, user journeys, diagrams, or visual design proposals. "
        "Set kind to organize when rearranging existing selected notes. "
        "Use create_code_block when the user asks for code and place concise example code in input.code. "
        "Use finish when the previous action already completed the requested outcome. "
        "Never include raw provider data, full Canvas snapshots, tokens, credentials, secrets, or lengthy text."
    )


def user_prompt(context: CanvasAgentRunContext) -> str:
    return json.dumps(
        {
            "runId": context.run_id,
            "prompt": context.prompt,
            "requestContext": context.request_context,
            "previousAction": context.previous_action,
            "allowedActions": [
                {
                    "name": "find_canvas_tool",
                    "input": {"toolTarget": "toolbar.memo", "toolTargetLabel": "Memo"},
                },
                {
                    "name": "find_shapes",
                    "input": {"query": "short keyword", "continuePlanning": "boolean"},
                },
                {"name": "select_shapes", "input": {"shapeIds": ["shape id"]}},
                {"name": "focus_viewport", "input": {"shapeIds": ["shape id"]}},
                {
                    "name": "create_draft",
                    "input": {
                        "kind": "diagram or organize",
                        "title": "short title",
                        "style": "short style",
                        "sourceShapeIds": ["optional selected shape id"],
                    },
                },
                {
                    "name": "create_code_block",
                    "input": {"title": "file name", "code": "short code", "language": "ts"},
                },
                {"name": "finish", "input": {"summary": "short result"}},
            ],
        },
        ensure_ascii=False,
    )
