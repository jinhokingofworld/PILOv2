from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from time import perf_counter

from app.agent_processor import (
    AgentPlannerClient,
    AgentProcessResult,
    AgentRouterClient,
    AgentRunContext,
    AgentRunJob,
    AgentRunProcessor,
)


@dataclass(frozen=True)
class WorkflowToolFixture:
    tool_name: str
    input_contains: dict[str, object]
    output: dict[str, object]
    requires_confirmation: bool | None = False


@dataclass(frozen=True)
class WorkflowScenario:
    scenario_id: str
    prompt: str
    fixtures: tuple[WorkflowToolFixture, ...]
    expected_answer_contains: tuple[str, ...] = ()
    expected_domains: tuple[str, ...] = ()
    expected_capability_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class WorkflowEvaluationResult:
    scenario_id: str
    attempt: int
    task_success: bool
    failure_reasons: tuple[str, ...]
    executed_tool_names: tuple[str, ...]
    latency_ms: float
    provider_total_tokens: int | None
    safety_violations: tuple[str, ...]
    final_answer: str
    expected_domains: tuple[str, ...]
    expected_capability_ids: tuple[str, ...]
    router_routed: bool
    domain_exact: bool
    capability_exact: bool


def load_workflow_scenarios(catalog_path: Path) -> tuple[WorkflowScenario, ...]:
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("Workflow catalog must contain valid JSON") from error
    workflows = catalog.get("multiToolCases") if isinstance(catalog, dict) else None
    if not isinstance(workflows, list) or not workflows:
        raise ValueError("Workflow catalog must include multiToolCases")

    scenarios: list[WorkflowScenario] = []
    for workflow in workflows:
        if not isinstance(workflow, dict):
            raise ValueError("Workflow definition must be an object")
        stages = workflow.get("stages")
        if not isinstance(stages, list):
            raise ValueError("Workflow stages must be an array")
        fixtures: list[WorkflowToolFixture] = []
        for stage in stages:
            if not isinstance(stage, dict) or stage.get("toolName") is None:
                continue
            tool_name = _required_string(stage, "toolName")
            input_contains = stage.get("inputContains", {})
            output = stage.get("output")
            requires_confirmation = stage.get("requiresConfirmation", False)
            if not isinstance(input_contains, dict) or not isinstance(output, dict) or not output:
                raise ValueError("Workflow Tool stages require inputContains and output objects")
            if requires_confirmation is not None and not isinstance(
                requires_confirmation, bool
            ):
                raise ValueError("Workflow confirmation policy must be boolean or null")
            fixtures.append(
                WorkflowToolFixture(
                    tool_name=tool_name,
                    input_contains=dict(input_contains),
                    output=dict(output),
                    requires_confirmation=requires_confirmation,
                )
            )
        if not fixtures:
            raise ValueError("Workflow must include at least one Tool stage")
        scenarios.append(
            WorkflowScenario(
                scenario_id=_required_string(workflow, "id"),
                prompt=_required_string(workflow, "prompt"),
                fixtures=tuple(fixtures),
                expected_answer_contains=_string_tuple(workflow, "finalAnswerContains"),
                expected_domains=_string_tuple(workflow, "expectedDomains"),
                expected_capability_ids=_string_tuple(
                    workflow,
                    "expectedCapabilityIds",
                ),
            )
        )
    if len({scenario.scenario_id for scenario in scenarios}) != len(scenarios):
        raise ValueError("Workflow scenario IDs must be unique")
    return tuple(scenarios)


def evaluate_workflow_suite(
    planner: AgentPlannerClient,
    router: AgentRouterClient,
    job: AgentRunJob,
    scenarios: tuple[WorkflowScenario, ...],
    *,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
) -> tuple[WorkflowEvaluationResult, ...]:
    if repetitions < 1:
        raise ValueError("Workflow evaluation repetitions must be at least 1")
    return tuple(
        _evaluate_workflow(
            planner,
            router,
            job,
            scenario,
            attempt=attempt,
            current_date=current_date,
            timezone=timezone,
        )
        for attempt in range(1, repetitions + 1)
        for scenario in scenarios
    )


def build_workflow_evaluation_report(
    results: tuple[WorkflowEvaluationResult, ...],
) -> dict[str, object]:
    scenario_ids = {result.scenario_id for result in results}
    task_successes = sum(result.task_success for result in results)
    safety_violation_count = sum(len(result.safety_violations) for result in results)
    funnel_predicates = (
        ("routerRouted", lambda result: result.router_routed),
        ("domainExact", lambda result: result.domain_exact),
        ("capabilityExact", lambda result: result.capability_exact),
        ("toolExact", lambda result: "tool_sequence" not in result.failure_reasons),
        ("requiredInputExact", lambda result: "tool_input" not in result.failure_reasons),
        ("executionPolicyExact", lambda result: not result.safety_violations),
        ("endToEndExact", lambda result: result.task_success),
    )
    stages: dict[str, object] = {}
    cumulative = list(results)
    previous_count = len(cumulative)
    for name, predicate in funnel_predicates:
        cumulative = [result for result in cumulative if predicate(result)]
        stages[name] = {
            "count": len(cumulative),
            "conditionalRate": _fraction(len(cumulative), previous_count),
            "overallRate": _fraction(len(cumulative), len(results)),
        }
        previous_count = len(cumulative)
    return {
        "totalCases": len(scenario_ids),
        "totalAttempts": len(results),
        "passedCases": sum(
            all(result.task_success for result in results if result.scenario_id == scenario_id)
            for scenario_id in scenario_ids
        ),
        "passedAttempts": task_successes,
        "exactAttemptRate": _fraction(task_successes, len(results)),
        "routingFunnel": {
            "toolSelectionAttempts": len(results),
            "stages": stages,
        },
        "multiToolWorkflows": {
            "workflowCount": len(scenario_ids),
            "workflowAttempts": len(results),
            "exactWorkflowAttempts": task_successes,
            "exactWorkflowRate": _fraction(task_successes, len(results)),
        },
        "workflowEvaluation": {
            "taskSuccessRate": _fraction(task_successes, len(results)),
            "latencyMs": _number_summary([result.latency_ms for result in results]),
            "providerTotalTokens": _optional_number_summary(
                [result.provider_total_tokens for result in results]
            ),
            "safetyViolations": safety_violation_count,
        },
        "results": [
            {
                "id": result.scenario_id,
                "attempt": result.attempt,
                "kind": "multi_tool",
                "passed": result.task_success,
                "failureReasons": list(result.failure_reasons),
                "expected": {
                    "domains": list(result.expected_domains),
                    "capabilityIds": list(result.expected_capability_ids),
                },
                "workflow": {
                    "taskSuccess": result.task_success,
                    "latencyMs": round(result.latency_ms, 3),
                    "providerTotalTokens": result.provider_total_tokens,
                    "safetyViolations": list(result.safety_violations),
                },
            }
            for result in results
        ],
    }


def _evaluate_workflow(
    planner: AgentPlannerClient,
    router: AgentRouterClient,
    job: AgentRunJob,
    scenario: WorkflowScenario,
    *,
    attempt: int,
    current_date: str,
    timezone: str,
) -> WorkflowEvaluationResult:
    repository = _ReplayRepository(job, scenario.prompt, timezone)
    planner_recorder = _TokenRecorder(planner)
    router_recorder = _TokenRecorder(router)
    handoff = _ReplayHandoff(repository, scenario)
    processor = AgentRunProcessor(
        repository,
        planner_recorder,
        handoff,
        current_date_provider=lambda _timezone: date.fromisoformat(current_date),
        router_client=router_recorder,
        tool_retrieval_mode="llm_router",
    )
    runtime_failure: str | None = None
    started = perf_counter()
    try:
        for _ in range(len(scenario.fixtures) + 2):
            result = processor.process_job(job)
            if repository.status in {"completed", "failed", "cancelled", "waiting_user_input"}:
                break
            if result.reason not in {
                "agent_execution_handoff_completed",
                "agent_execution_handoff_retried",
            }:
                break
    except Exception as error:
        runtime_failure = _runtime_failure(error)
    latency_ms = max(0.0, (perf_counter() - started) * 1000)

    failures = list(repository.validation_failures)
    if runtime_failure is not None:
        failures.append(runtime_failure)
    if repository.status != "completed":
        failures.append("terminal_state")
    expected_tools = tuple(fixture.tool_name for fixture in scenario.fixtures)
    if tuple(repository.executed_tool_names) != expected_tools:
        failures.append("tool_sequence")
    if any(item not in repository.final_answer for item in scenario.expected_answer_contains):
        failures.append("final_answer_grounding")
    failure_reasons = tuple(dict.fromkeys(failures))
    routing_decisions = router_recorder.decisions
    router_routed = bool(routing_decisions) and all(
        getattr(decision, "status", None) == "routed" for decision in routing_decisions
    )
    domain_exact = not scenario.expected_domains or (
        router_routed
        and all(
            set(getattr(decision, "domains", ())) == set(scenario.expected_domains)
            for decision in routing_decisions
        )
    )
    capability_exact = not scenario.expected_capability_ids or (
        router_routed
        and all(
            set(getattr(decision, "capability_ids", ()))
            == set(scenario.expected_capability_ids)
            for decision in routing_decisions
        )
    )
    return WorkflowEvaluationResult(
        scenario_id=scenario.scenario_id,
        attempt=attempt,
        task_success=not failure_reasons and not repository.safety_violations,
        failure_reasons=failure_reasons,
        executed_tool_names=tuple(repository.executed_tool_names),
        latency_ms=latency_ms,
        provider_total_tokens=_sum_optional(
            planner_recorder.provider_total_tokens,
            router_recorder.provider_total_tokens,
        ),
        safety_violations=tuple(repository.safety_violations),
        final_answer=repository.final_answer,
        expected_domains=scenario.expected_domains,
        expected_capability_ids=scenario.expected_capability_ids,
        router_routed=router_routed,
        domain_exact=domain_exact,
        capability_exact=capability_exact,
    )


class _ReplayRepository:
    def __init__(self, job: AgentRunJob, prompt: str, timezone: str) -> None:
        self.job = job
        self.prompt = prompt
        self.timezone = timezone
        self.status = "planning"
        self.planner_turn_count = 0
        self.planning_context = ""
        self.latest_planner_tool_name: str | None = None
        self.latest_output_summary: dict[str, object] | None = None
        self.final_answer = ""
        self.executed_tool_names: list[str] = []
        self.validation_failures: list[str] = []
        self.safety_violations: list[str] = []

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
            latest_planner_tool_name=self.latest_planner_tool_name,
            planning_context=self.planning_context,
        )

    def start_planner_step(self, _job: AgentRunJob, _context: AgentRunContext) -> str:
        self.planner_turn_count += 1
        return f"workflow-step-{self.planner_turn_count}"

    def complete_planner_step(
        self,
        _run_id: str,
        _step_id: str,
        output_summary: dict[str, object],
    ) -> bool:
        self.latest_output_summary = output_summary
        tool_name = output_summary.get("toolName")
        self.latest_planner_tool_name = tool_name if isinstance(tool_name, str) else None
        return True

    def fail_planner_step(self, *_args: object) -> None:
        self.status = "failed"

    def complete_run(
        self,
        _run_id: str,
        final_answer: str,
        _message: str,
        _risk_level: str | None,
    ) -> None:
        self.status = "completed"
        self.final_answer = final_answer

    def mark_tool_execution_ready(
        self,
        _run_id: str,
        _message: str,
        _risk_level: str,
    ) -> None:
        self.status = "running"

    def mark_failed(self, *_args: object) -> None:
        self.status = "failed"

    def wait_for_user_input(self, _run_id: str, _message: str) -> bool:
        self.status = "waiting_user_input"
        return True


class _ReplayHandoff:
    def __init__(self, repository: _ReplayRepository, scenario: WorkflowScenario) -> None:
        self.repository = repository
        self.scenario = scenario

    def execute(self, _run_id: str) -> None:
        summary = self.repository.latest_output_summary or {}
        tool_name = summary.get("toolName")
        tool_input = summary.get("input")
        index = len(self.repository.executed_tool_names)
        if index >= len(self.scenario.fixtures) or not isinstance(tool_name, str):
            self.repository.safety_violations.append("unexpected_tool")
            self.repository.status = "failed"
            return
        fixture = self.scenario.fixtures[index]
        if tool_name != fixture.tool_name:
            self.repository.validation_failures.append("tool_sequence")
        if not isinstance(tool_input, dict) or not _contains(tool_input, fixture.input_contains):
            self.repository.validation_failures.append("tool_input")
        if summary.get("requiresConfirmation") != fixture.requires_confirmation:
            self.repository.safety_violations.append("confirmation_policy")
        self.repository.executed_tool_names.append(tool_name)
        output = json.dumps(
            fixture.output,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        line = f"tool {tool_name}: {output}"
        self.repository.planning_context = "\n".join(
            item for item in (self.repository.planning_context, line) if item
        )
        self.repository.status = "planning"


class _TokenRecorder:
    def __init__(self, client: object) -> None:
        self.client = client
        self.provider_total_tokens: int | None = None
        self.decisions: list[object] = []

    def plan(self, request):
        decision = self.client.plan(request)
        self._record(decision)
        return decision

    def route(self, request):
        decision = self.client.route(request)
        self._record(decision)
        return decision

    def _record(self, decision: object) -> None:
        self.decisions.append(decision)
        value = getattr(decision, "provider_total_tokens", None)
        if isinstance(value, int) and value >= 0:
            self.provider_total_tokens = (self.provider_total_tokens or 0) + value


def _contains(actual: dict[str, object], expected: dict[str, object]) -> bool:
    return all(key in actual and actual[key] == value for key, value in expected.items())


def _sum_optional(*values: int | None) -> int | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def _fraction(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _number_summary(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "average": round(sum(ordered) / len(ordered), 3),
        "p50": round(_percentile(ordered, 0.5), 3),
        "p95": round(_percentile(ordered, 0.95), 3),
    }


def _optional_number_summary(values: list[int | None]) -> dict[str, float] | None:
    present = [float(value) for value in values if value is not None]
    return _number_summary(present)


def _percentile(values: list[float], ratio: float) -> float:
    index = max(0, min(len(values) - 1, round((len(values) - 1) * ratio)))
    return values[index]


def _runtime_failure(error: Exception) -> str:
    name = type(error).__name__.lower()
    if "router" in name:
        return "router_output"
    if "planner" in name:
        return "planner_output"
    if "infrastructure" in name:
        return "provider_infrastructure"
    return "runtime_error"


def _required_string(value: dict[str, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Workflow {key} must be a non-empty string")
    return item.strip()


def _string_tuple(value: dict[str, object], key: str) -> tuple[str, ...]:
    items = value.get(key)
    if not isinstance(items, list) or not items or not all(
        isinstance(item, str) and item.strip() for item in items
    ):
        raise ValueError(f"Workflow {key} must be a non-empty string array")
    return tuple(item.strip() for item in items)
