from __future__ import annotations

from typing import Protocol
from uuid import UUID

from app.canvas_agent.planning.chat_responder import CanvasAgentChatResponderError
from app.canvas_agent.planning.html_generator import CanvasAgentHtmlGeneratorError
from app.canvas_agent.planning.planner import CanvasAgentIntentClassifierError
from app.canvas_agent.types import (
    CANVAS_AGENT_JOB_TYPE,
    CANVAS_AGENT_SCHEMA_VERSION,
    TERMINAL_RUN_STATUSES,
    CanvasAgentJob,
    CanvasAgentProcessResult,
    CanvasAgentRunContext,
)
from app.meeting_report_processor import InfrastructureError


class CanvasAgentRepository(Protocol):
    def try_acquire_run_lock(self, run_id: str) -> bool: ...

    def release_run_lock(self, run_id: str) -> None: ...

    def get_run_context(self, job: CanvasAgentJob) -> CanvasAgentRunContext | None: ...

    def create_classified_intent(
        self,
        context: CanvasAgentRunContext,
        intent: str,
        arguments: dict[str, object],
        message: str,
        model_name: str,
    ) -> None: ...

    def update_progress(self, run_id: str, message: str) -> None: ...

    def mark_failed(self, run_id: str, error_message: str) -> None: ...


class CanvasAgentIntentClassifier(Protocol):
    model: str

    def classify(self, context: CanvasAgentRunContext): ...


class CanvasSemanticIntentRouter(Protocol):
    model: str

    def classify(self, context: CanvasAgentRunContext, query_override: str | None = None): ...


class CanvasHtmlGenerator(Protocol):
    model: str

    def generate(self, context: CanvasAgentRunContext) -> dict[str, object]: ...


class CanvasChatResponder(Protocol):
    model: str

    def respond(self, context: CanvasAgentRunContext, context_scope: str) -> str: ...


def parse_canvas_agent_job_payload(payload: dict[str, object]) -> CanvasAgentJob:
    if payload.get("jobType") != CANVAS_AGENT_JOB_TYPE:
        raise ValueError("Unsupported Canvas Agent job type")
    schema_version = _require_string(payload, "schemaVersion")
    if schema_version != CANVAS_AGENT_SCHEMA_VERSION:
        raise ValueError("Unsupported Canvas Agent schema version")
    return CanvasAgentJob(
        run_id=_require_uuid(payload, "runId"),
        workspace_id=_require_uuid(payload, "workspaceId"),
        canvas_id=_require_uuid(payload, "canvasId"),
        requested_by_user_id=_require_uuid(payload, "requestedByUserId"),
        schema_version=schema_version,
    )


class CanvasAgentProcessor:
    def __init__(
        self,
        repository: CanvasAgentRepository,
        intent_classifier: CanvasAgentIntentClassifier,
        semantic_router: CanvasSemanticIntentRouter | None = None,
        html_generator: CanvasHtmlGenerator | None = None,
        chat_responder: CanvasChatResponder | None = None,
    ) -> None:
        self.repository = repository
        self.intent_classifier = intent_classifier
        self.semantic_router = semantic_router
        self.html_generator = html_generator
        self.chat_responder = chat_responder

    def process_payload(self, payload: dict[str, object]) -> CanvasAgentProcessResult:
        try:
            job = parse_canvas_agent_job_payload(payload)
        except ValueError:
            return CanvasAgentProcessResult(delete_message=True, reason="invalid_canvas_agent_job")

        try:
            return self.process_job(job)
        except InfrastructureError:
            return CanvasAgentProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                run_id=job.run_id,
            )

    def process_job(self, job: CanvasAgentJob) -> CanvasAgentProcessResult:
        if not self.repository.try_acquire_run_lock(job.run_id):
            return CanvasAgentProcessResult(
                delete_message=False,
                reason="canvas_agent_run_duplicate_in_progress",
                run_id=job.run_id,
            )
        try:
            context = self.repository.get_run_context(job)
            if context is None:
                return CanvasAgentProcessResult(True, "canvas_agent_run_not_found", job.run_id)
            if context.status in TERMINAL_RUN_STATUSES:
                return CanvasAgentProcessResult(True, "terminal_canvas_agent_run", job.run_id)
            if context.status != "planning":
                return CanvasAgentProcessResult(
                    True,
                    "canvas_agent_run_unsupported_status",
                    job.run_id,
                )

            try:
                self.repository.update_progress(
                    context.run_id,
                    "현재 캔버스 도형과 요청 내용을 함께 확인하고 있어요.",
                )
                classification = self.intent_classifier.classify(context)
                arguments = dict(classification.arguments)
                model_name = self.intent_classifier.model
                message = classification.message
                result_reason = "canvas_agent_intent_classified"

                if classification.intent == "find_shapes":
                    shape_ids = arguments.get("shapeIds")
                    has_client_match = isinstance(shape_ids, list) and any(
                        isinstance(item, str) and item for item in shape_ids
                    )
                    if has_client_match:
                        arguments["routingSource"] = "client_shape_context"
                        arguments["focusResult"] = True
                    else:
                        query = arguments.get("query")
                        semantic_classification = self._semantic_classification(
                            context,
                            query if isinstance(query, str) else None,
                        )
                        if semantic_classification is not None:
                            arguments = dict(semantic_classification.arguments)
                            message = semantic_classification.message
                            model_name = (
                                self.semantic_router.model
                                if self.semantic_router
                                else "local:canvas-embedding"
                            )
                            result_reason = "canvas_agent_semantic_intent_classified"
                        else:
                            arguments["shapeIds"] = []
                            arguments["routingSource"] = "llm_intent_classifier"
                elif classification.intent == "generate_html":
                    selection_error = context.request_context.get("selectedSceneError")
                    selected_scene = context.request_context.get("selectedScene")
                    if isinstance(selection_error, str) and selection_error.strip():
                        arguments = {"selectionError": selection_error.strip()[:500]}
                        message = selection_error.strip()[:1000]
                    elif not isinstance(selected_scene, dict):
                        arguments = {"missingSelection": True}
                        message = "HTML로 만들 캔버스 영역을 먼저 선택해주세요."
                    else:
                        if self.html_generator is None:
                            raise CanvasAgentHtmlGeneratorError(
                                "Canvas Agent HTML generator is not configured"
                            )
                        self.repository.update_progress(
                            context.run_id,
                            "선택한 영역을 정적 HTML/CSS로 변환하고 있어요.",
                        )
                        arguments = {"artifact": self.html_generator.generate(context)}
                        model_name = self.html_generator.model
                        message = "선택한 영역의 정적 HTML/CSS 초안을 만들었습니다."
                        result_reason = "canvas_agent_html_generated"
                elif classification.intent == "import_drive_file":
                    query = arguments.get("query")
                    arguments = {"query": query.strip()[:120] if isinstance(query, str) else ""}
                elif classification.intent == "chat":
                    context_scope = arguments.get("contextScope")
                    if context_scope not in {"none", "selected_scene"}:
                        raise CanvasAgentChatResponderError(
                            "Canvas Agent chat context scope is invalid"
                        )
                    reason_code = arguments.get("reasonCode")
                    used_chat_responder = False
                    if context_scope == "selected_scene":
                        selection_error = context.request_context.get("selectedSceneError")
                        selected_scene = context.request_context.get("selectedScene")
                        if isinstance(selection_error, str) and selection_error.strip():
                            answer = (
                                "선택 영역 정보를 모두 불러오지 못했습니다. "
                                "잠시 후 다시 선택해 질문해 주세요."
                            )
                        elif not isinstance(selected_scene, dict):
                            answer = "답변할 캔버스 프레임이나 도형을 먼저 선택해 주세요."
                        else:
                            answer = self._chat_response(context, context_scope)
                            used_chat_responder = True
                    else:
                        answer = self._chat_response(context, context_scope)
                        used_chat_responder = True
                    arguments = {
                        "answer": answer,
                        "contextScope": context_scope,
                        "reasonCode": (
                            reason_code[:80] if isinstance(reason_code, str) else "general_question"
                        ),
                    }
                    if used_chat_responder and self.chat_responder is not None:
                        model_name = self.chat_responder.model
                    message = answer
                    result_reason = "canvas_agent_chat_responded"
                else:
                    arguments = {}

                self.repository.create_classified_intent(
                    context,
                    classification.intent,
                    arguments,
                    message,
                    model_name,
                )
            except CanvasAgentHtmlGeneratorError:
                self.repository.mark_failed(
                    job.run_id,
                    "코드 생성 중 오류가 났어요. 다시 시도해 주세요.",
                )
                return CanvasAgentProcessResult(
                    True,
                    "canvas_agent_html_generation_failed",
                    job.run_id,
                )
            except CanvasAgentChatResponderError:
                self.repository.mark_failed(
                    job.run_id,
                    "대화 답변을 만드는 중 오류가 났어요. 다시 시도해 주세요.",
                )
                return CanvasAgentProcessResult(
                    True,
                    "canvas_agent_chat_response_failed",
                    job.run_id,
                )
            except CanvasAgentIntentClassifierError as error:
                self.repository.mark_failed(job.run_id, str(error))
                return CanvasAgentProcessResult(
                    True,
                    "canvas_agent_intent_classification_failed",
                    job.run_id,
                )

            return CanvasAgentProcessResult(True, result_reason, job.run_id)
        finally:
            self.repository.release_run_lock(job.run_id)

    def _chat_response(
        self,
        context: CanvasAgentRunContext,
        context_scope: str,
    ) -> str:
        if self.chat_responder is None:
            raise CanvasAgentChatResponderError("Canvas Agent chat responder is not configured")
        return self.chat_responder.respond(context, context_scope)

    def _semantic_classification(
        self,
        context: CanvasAgentRunContext,
        query: str | None,
    ):
        if self.semantic_router is None or not query:
            return None
        try:
            return self.semantic_router.classify(context, query)
        except Exception:
            # Local retrieval must never make the Canvas AI unavailable. A
            # failed or not-yet-ready index becomes an empty search result.
            return None


def _require_uuid(payload: dict[str, object], key: str) -> str:
    value = _require_string(payload, key)
    try:
        UUID(value)
    except ValueError as error:
        raise ValueError(f"Invalid {key}") from error
    return value


def _require_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {key}")
    return value.strip()
