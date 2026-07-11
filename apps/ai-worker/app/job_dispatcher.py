from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from app.agent_processor import (
    AGENT_RUN_REQUESTED_JOB_TYPE,
    AgentProcessResult,
)
from app.canvas_agent.types import CANVAS_AGENT_JOB_TYPE, CanvasAgentProcessResult
from app.meeting_report_processor import InfrastructureError, ProcessResult

MEETING_REPORT_JOB_TYPE = "meeting_report"


@dataclass(frozen=True)
class JobProcessResult:
    delete_message: bool
    reason: str
    job_type: str | None = None
    resource_id: str | None = None


class MeetingReportProcessorLike(Protocol):
    def process_payload(self, payload: dict[str, object]) -> ProcessResult: ...


class AgentRunProcessorLike(Protocol):
    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult: ...


class CanvasAgentProcessorLike(Protocol):
    def process_payload(self, payload: dict[str, object]) -> CanvasAgentProcessResult: ...


class JobDispatcher:
    def __init__(
        self,
        meeting_report_processor: MeetingReportProcessorLike,
        agent_run_processor: AgentRunProcessorLike,
        canvas_agent_processor: CanvasAgentProcessorLike | None = None,
    ) -> None:
        self.meeting_report_processor = meeting_report_processor
        self.agent_run_processor = agent_run_processor
        self.canvas_agent_processor = canvas_agent_processor

    def process_message(self, message_body: str) -> JobProcessResult:
        try:
            payload = json.loads(message_body)
        except json.JSONDecodeError:
            return JobProcessResult(delete_message=True, reason="invalid_job_json")

        if not isinstance(payload, dict):
            return JobProcessResult(delete_message=True, reason="invalid_job_payload")

        job_type = payload.get("jobType")
        if not isinstance(job_type, str) or not job_type.strip():
            return JobProcessResult(delete_message=True, reason="invalid_job_type")

        normalized_job_type = job_type.strip()

        try:
            if normalized_job_type == MEETING_REPORT_JOB_TYPE:
                return self._process_meeting_report(payload)

            if normalized_job_type == AGENT_RUN_REQUESTED_JOB_TYPE:
                return self._process_agent_run(payload)

            if normalized_job_type == CANVAS_AGENT_JOB_TYPE:
                return self._process_canvas_agent(payload)
        except InfrastructureError:
            return JobProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                job_type=normalized_job_type,
            )

        return JobProcessResult(
            delete_message=True,
            reason="unsupported_job_type",
            job_type=normalized_job_type,
        )

    def _process_meeting_report(self, payload: dict[str, object]) -> JobProcessResult:
        result = self.meeting_report_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=MEETING_REPORT_JOB_TYPE,
            resource_id=result.report_id,
        )

    def _process_agent_run(self, payload: dict[str, object]) -> JobProcessResult:
        result = self.agent_run_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=AGENT_RUN_REQUESTED_JOB_TYPE,
            resource_id=result.run_id,
        )

    def _process_canvas_agent(self, payload: dict[str, object]) -> JobProcessResult:
        if self.canvas_agent_processor is None:
            return JobProcessResult(
                delete_message=True,
                reason="canvas_agent_processor_unavailable",
                job_type=CANVAS_AGENT_JOB_TYPE,
            )

        result = self.canvas_agent_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=CANVAS_AGENT_JOB_TYPE,
            resource_id=result.run_id,
        )
