from __future__ import annotations

from typing import Protocol
from uuid import UUID

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

    def classify(self, context: CanvasAgentRunContext): ...


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
    ) -> None:
        self.repository = repository
        self.intent_classifier = intent_classifier
        self.semantic_router = semantic_router

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
                if self.semantic_router is not None:
                    self.repository.update_progress(
                        context.run_id,
                        "먼저 캔버스 위 도형 임베딩에서 관련 내용을 찾아보고 있어요.",
                    )
                local_classification = self._semantic_classification(context)
                if local_classification is not None:
                    self.repository.create_classified_intent(
                        context,
                        local_classification.intent,
                        local_classification.arguments,
                        local_classification.message,
                        (
                            self.semantic_router.model
                            if self.semantic_router
                            else "local:canvas-embedding"
                        ),
                    )
                    return CanvasAgentProcessResult(
                        True,
                        "canvas_agent_semantic_intent_classified",
                        job.run_id,
                    )

                self.repository.update_progress(
                    context.run_id,
                    "임베딩으로 확실한 도형을 찾지 못해서 검색어를 정리하고 있어요.",
                )
                classification = self.intent_classifier.classify(context)
                arguments = dict(classification.arguments)
                arguments.setdefault("routingSource", "llm_intent_classifier")
                self.repository.create_classified_intent(
                    context,
                    classification.intent,
                    arguments,
                    classification.message,
                    self.intent_classifier.model,
                )
            except CanvasAgentIntentClassifierError as error:
                self.repository.mark_failed(job.run_id, str(error))
                return CanvasAgentProcessResult(
                    True,
                    "canvas_agent_intent_classification_failed",
                    job.run_id,
                )

            return CanvasAgentProcessResult(True, "canvas_agent_intent_classified", job.run_id)
        finally:
            self.repository.release_run_lock(job.run_id)

    def _semantic_classification(self, context: CanvasAgentRunContext):
        if self.semantic_router is None:
            return None
        try:
            return self.semantic_router.classify(context)
        except Exception:
            # Local retrieval must never make the Canvas AI unavailable. A
            # failed or not-yet-ready index falls through to the GPT classifier.
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
