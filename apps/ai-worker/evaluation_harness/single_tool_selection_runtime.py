from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.agent_processor import (
    AgentPlannerClient,
    AgentRouterClient,
    AgentRunContext,
    AgentRunJob,
    AgentRunProcessor,
)

from evaluation_harness.single_tool_selection_catalog import SingleToolSelectionCase


@dataclass(frozen=True)
class SingleToolSelectionResult:
    case_id: str
    attempt: int
    expected_tool_name: str
    selected_tool_name: str | None
    passed: bool
    failure_code: str | None
    execution_handoff_count: int


def evaluate_single_tool_selection_case(
    planner: AgentPlannerClient,
    router: AgentRouterClient,
    job: AgentRunJob,
    case: SingleToolSelectionCase,
    *,
    current_date: str,
    timezone: str,
    attempt: int = 1,
) -> SingleToolSelectionResult:
    repository = _SelectionRepository(job, case.prompt, timezone)
    handoff = _RecordingHandoff(repository)
    processor = AgentRunProcessor(
        repository,
        planner,
        handoff,
        current_date_provider=lambda _timezone: date.fromisoformat(current_date),
        router_client=router,
        tool_retrieval_mode="llm_router",
    )
    evaluation_job = job
    if case.context_surface is not None:
        evaluation_job = AgentRunJob(
            **{
                **job.__dict__,
                "request_context": {"surface": case.context_surface},
            }
        )
    try:
        processor.process_job(evaluation_job)
    except Exception:
        return SingleToolSelectionResult(
            case_id=case.case_id,
            attempt=attempt,
            expected_tool_name=case.expected_tool_name,
            selected_tool_name=repository.selected_tool_name,
            passed=False,
            failure_code="runtime_failure",
            execution_handoff_count=repository.execution_handoff_count,
        )

    selected_tool_name = repository.selected_tool_name
    if selected_tool_name is None:
        failure_code = "no_tool"
    elif selected_tool_name != case.expected_tool_name:
        failure_code = "wrong_tool"
    elif repository.execution_handoff_count != 1:
        failure_code = "unexpected_handoff_count"
    else:
        failure_code = None
    return SingleToolSelectionResult(
        case_id=case.case_id,
        attempt=attempt,
        expected_tool_name=case.expected_tool_name,
        selected_tool_name=selected_tool_name,
        passed=failure_code is None,
        failure_code=failure_code,
        execution_handoff_count=repository.execution_handoff_count,
    )


class _SelectionRepository:
    def __init__(self, job: AgentRunJob, prompt: str, timezone: str) -> None:
        self.job = job
        self.prompt = prompt
        self.timezone = timezone
        self.status = "planning"
        self.planner_turn_count = 0
        self.selected_tool_name: str | None = None
        self.execution_handoff_count = 0

    def try_acquire_run_lock(self, _run_id: str) -> bool:
        return True

    def release_run_lock(self, _run_id: str) -> None:
        return None

    def get_run_context(self, _job: AgentRunJob) -> AgentRunContext:
        return AgentRunContext(
            run_id=self.job.run_id,
            workspace_id=self.job.workspace_id,
            requested_by_user_id=self.job.requested_by_user_id,
            status=self.status,
            prompt=self.prompt,
            timezone=self.timezone,
            planner_turn_count=self.planner_turn_count,
            planning_context="",
        )

    def start_planner_step(self, _job: AgentRunJob, _context: AgentRunContext) -> str:
        self.planner_turn_count += 1
        return f"selection-step-{self.planner_turn_count}"

    def complete_planner_step(
        self, _run_id: str, _step_id: str, output_summary: dict[str, object]
    ) -> bool:
        tool_name = output_summary.get("toolName")
        self.selected_tool_name = tool_name if isinstance(tool_name, str) else None
        return True

    def fail_planner_step(self, *_args: object) -> None:
        self.status = "failed"

    def complete_run(self, *_args: object) -> None:
        self.status = "completed"

    def mark_tool_execution_ready(self, *_args: object) -> None:
        self.status = "running"

    def mark_failed(self, *_args: object) -> None:
        self.status = "failed"

    def wait_for_user_input(self, _run_id: str, _message: str) -> bool:
        self.status = "waiting_user_input"
        return True


class _RecordingHandoff:
    def __init__(self, repository: _SelectionRepository) -> None:
        self.repository = repository

    def execute(self, _run_id: str) -> None:
        self.repository.execution_handoff_count += 1
