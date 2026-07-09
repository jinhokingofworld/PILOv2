from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from app.meeting_report_processor import InfrastructureError

AGENT_RUN_REQUESTED_JOB_TYPE = "agent_run_requested"
TERMINAL_AGENT_RUN_STATUSES = {"completed", "failed", "cancelled"}


@dataclass(frozen=True)
class AgentRunJob:
    run_id: str
    workspace_id: str
    requested_by_user_id: str


@dataclass(frozen=True)
class AgentRunContext:
    run_id: str
    workspace_id: str
    requested_by_user_id: str
    status: str


@dataclass(frozen=True)
class AgentProcessResult:
    delete_message: bool
    reason: str
    run_id: str | None = None


class AgentRunRepository(Protocol):
    def try_acquire_run_lock(self, run_id: str) -> bool: ...

    def release_run_lock(self, run_id: str) -> None: ...

    def get_run_context(self, job: AgentRunJob) -> AgentRunContext | None: ...

    def mark_failed(
        self,
        run_id: str,
        error_code: str,
        error_message: str,
        message: str,
    ) -> None: ...


def parse_agent_run_job_payload(payload: dict[str, object]) -> AgentRunJob:
    if payload.get("jobType") != AGENT_RUN_REQUESTED_JOB_TYPE:
        raise ValueError("Unsupported Agent job type")

    return AgentRunJob(
        run_id=_require_uuid_string(payload, "runId"),
        workspace_id=_require_uuid_string(payload, "workspaceId"),
        requested_by_user_id=_require_uuid_string(payload, "requestedByUserId"),
    )


class AgentRunProcessor:
    def __init__(self, repository: AgentRunRepository) -> None:
        self.repository = repository

    def process_payload(self, payload: dict[str, object]) -> AgentProcessResult:
        try:
            job = parse_agent_run_job_payload(payload)
        except ValueError:
            return AgentProcessResult(delete_message=True, reason="invalid_agent_job")

        try:
            return self.process_job(job)
        except InfrastructureError:
            return AgentProcessResult(
                delete_message=False,
                reason="infrastructure_failure",
                run_id=job.run_id,
            )

    def process_job(self, job: AgentRunJob) -> AgentProcessResult:
        lock_acquired = self.repository.try_acquire_run_lock(job.run_id)
        if not lock_acquired:
            return self._result(
                job,
                delete_message=False,
                reason="agent_run_duplicate_in_progress",
            )

        try:
            context = self.repository.get_run_context(job)
            if context is None:
                return self._result(job, delete_message=True, reason="agent_run_not_found")

            status = context.status
            if status in TERMINAL_AGENT_RUN_STATUSES:
                return self._result(job, delete_message=True, reason="terminal_agent_run")

            if status == "waiting_confirmation":
                return self._result(
                    job,
                    delete_message=True,
                    reason="agent_run_waiting_confirmation",
                )

            if status != "planning":
                return self._result(
                    job,
                    delete_message=True,
                    reason="agent_run_unsupported_status",
                )

            return self._result(
                job,
                delete_message=False,
                reason="agent_planning_not_implemented",
            )
        finally:
            self.repository.release_run_lock(job.run_id)

    def _result(
        self,
        job: AgentRunJob,
        delete_message: bool,
        reason: str,
    ) -> AgentProcessResult:
        return AgentProcessResult(
            delete_message=delete_message,
            reason=reason,
            run_id=job.run_id,
        )


def _require_uuid_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid {key}")

    normalized = value.strip()
    try:
        UUID(normalized)
    except ValueError as error:
        raise ValueError(f"Invalid {key}") from error

    return normalized
