from __future__ import annotations

from dataclasses import dataclass

CANVAS_AGENT_JOB_TYPE = "canvas_agent_step_requested"
CANVAS_AGENT_SCHEMA_VERSION = "canvas-agent:v1"
CANVAS_AGENT_INTENTS = {
    "chat",
    "find_shapes",
    "generate_html",
    "import_drive_file",
    "unsupported",
}
CANVAS_AGENT_ACTIONS = {
    "route_intent",
    "find_canvas_tool",
    "find_shapes",
    "select_shapes",
    "focus_viewport",
    "finish",
}
TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled", "expired", "draft_ready"}


@dataclass(frozen=True)
class CanvasAgentJob:
    run_id: str
    workspace_id: str
    canvas_id: str
    requested_by_user_id: str
    schema_version: str


@dataclass(frozen=True)
class CanvasAgentRunContext:
    run_id: str
    workspace_id: str
    canvas_id: str
    requested_by_user_id: str
    status: str
    prompt: str
    request_context: dict[str, object]
    previous_action: dict[str, object] | None


@dataclass(frozen=True)
class CanvasAgentIntentClassification:
    intent: str
    arguments: dict[str, object]
    message: str


@dataclass(frozen=True)
class CanvasSemanticShapeMatch:
    shape_id: str
    similarity: float


@dataclass(frozen=True)
class CanvasAgentProcessResult:
    delete_message: bool
    reason: str
    run_id: str | None = None
