from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from app.agent_processor import (
    AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE,
    AGENT_RUN_REQUESTED_JOB_TYPE,
    AgentProcessResult,
)
from app.canvas_agent.types import CANVAS_AGENT_JOB_TYPE, CanvasAgentProcessResult
from app.meeting_report_processor import InfrastructureError, ProcessResult
from app.pr_review_analysis_processor import (
    PR_REVIEW_ANALYSIS_JOB_TYPE,
    PrReviewAnalysisProcessResult,
)

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


class PrReviewAnalysisProcessorLike(Protocol):
    def process_payload(self, payload: dict[str, object]) -> PrReviewAnalysisProcessResult: ...


class JobDispatcher:
    def __init__(
        self,
        meeting_report_processor: MeetingReportProcessorLike | None = None,
        agent_run_processor: AgentRunProcessorLike | None = None,
        grounded_answer_processor: AgentRunProcessorLike | None = None,
        canvas_agent_processor: CanvasAgentProcessorLike | None = None,
        pr_review_analysis_processor: PrReviewAnalysisProcessorLike | None = None,
    ) -> None:
        self.meeting_report_processor = meeting_report_processor
        self.agent_run_processor = agent_run_processor
        self.grounded_answer_processor = grounded_answer_processor
        self.canvas_agent_processor = canvas_agent_processor
        self.pr_review_analysis_processor = pr_review_analysis_processor

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

            if normalized_job_type == AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE:
                return self._process_grounded_answer(payload)

            if normalized_job_type == CANVAS_AGENT_JOB_TYPE:
                return self._process_canvas_agent(payload)

            if normalized_job_type == PR_REVIEW_ANALYSIS_JOB_TYPE:
                return self._process_pr_review_analysis(payload)
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
        if self.meeting_report_processor is None:
            return JobProcessResult(
                delete_message=False,
                reason="meeting_report_processor_unavailable",
                job_type=MEETING_REPORT_JOB_TYPE,
            )
        result = self.meeting_report_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=MEETING_REPORT_JOB_TYPE,
            resource_id=result.report_id,
        )

    def _process_agent_run(self, payload: dict[str, object]) -> JobProcessResult:
        if self.agent_run_processor is None:
            return JobProcessResult(
                delete_message=False,
                reason="agent_run_processor_unavailable",
                job_type=AGENT_RUN_REQUESTED_JOB_TYPE,
            )
        result = self.agent_run_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=AGENT_RUN_REQUESTED_JOB_TYPE,
            resource_id=result.run_id,
        )

    def _process_grounded_answer(self, payload: dict[str, object]) -> JobProcessResult:
        if self.grounded_answer_processor is None:
            return JobProcessResult(
                delete_message=False,
                reason="grounded_answer_processor_unavailable",
                job_type=AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE,
            )
        result = self.grounded_answer_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=AGENT_GROUNDED_ANSWER_REQUESTED_JOB_TYPE,
            resource_id=result.run_id,
        )

    def _process_canvas_agent(self, payload: dict[str, object]) -> JobProcessResult:
        if self.canvas_agent_processor is None:
            return JobProcessResult(
                delete_message=False,
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

    def _process_pr_review_analysis(self, payload: dict[str, object]) -> JobProcessResult:
        if self.pr_review_analysis_processor is None:
            return JobProcessResult(
                delete_message=False,
                reason="pr_review_analysis_processor_unavailable",
                job_type=PR_REVIEW_ANALYSIS_JOB_TYPE,
            )

        result = self.pr_review_analysis_processor.process_payload(payload)
        return JobProcessResult(
            delete_message=result.delete_message,
            reason=result.reason,
            job_type=PR_REVIEW_ANALYSIS_JOB_TYPE,
            resource_id=result.job_id,
        )
