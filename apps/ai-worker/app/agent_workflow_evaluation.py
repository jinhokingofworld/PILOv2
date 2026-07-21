from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path
from time import perf_counter

from app.agent_outcome_judge import OutcomeJudgeClient, OutcomeJudgeEvidence, judge_outcome
from app.agent_processor import (
    AgentPlannerClient,
    AgentRouterClient,
    AgentRunContext,
    AgentRunJob,
    AgentRunProcessor,
)


@dataclass(frozen=True)
class OutcomeInputAssertion:
    path: tuple[str, ...]
    contains_all: tuple[str, ...]


@dataclass(frozen=True)
class WorkflowOutcomeAssertions:
    response_evidence: tuple[tuple[str, ...], ...] = ()
    response_forbidden: tuple[str, ...] = ()
    require_response: bool = False


@dataclass(frozen=True)
class WorkflowToolFixture:
    tool_name: str
    input_contains: dict[str, object]
    output: dict[str, object]
    requires_confirmation: bool | None = False
    outcome_input_assertions: tuple[OutcomeInputAssertion, ...] = ()


@dataclass(frozen=True)
class WorkflowScenario:
    scenario_id: str
    prompt: str
    fixtures: tuple[WorkflowToolFixture, ...]
    category: str = "workflow"
    expected_answer_contains: tuple[str, ...] = ()
    outcome_assertions: WorkflowOutcomeAssertions | None = None
    expected_domains: tuple[str, ...] = ()
    expected_capability_ids: tuple[str, ...] = ()
    context_surface: str | None = None
    evaluation_domains: tuple[str, ...] = ()
    expected_router_status: str = "routed"
    expected_planner_status: str = "completed"
    expected_terminal_status: str = "completed"


@dataclass(frozen=True)
class WorkflowCatalog:
    version: str
    scenarios: tuple[WorkflowScenario, ...]


@dataclass(frozen=True)
class WorkflowEvaluationResult:
    scenario_id: str
    attempt: int
    task_success: bool
    failure_reasons: tuple[str, ...]
    execution_contract_passed: bool
    execution_contract_failure_reasons: tuple[str, ...]
    outcome_assertion_results: dict[str, bool]
    outcome_judge_verdict: str | None
    outcome_judge_failure_codes: tuple[str, ...]
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
    evaluation_domains: tuple[str, ...]
    expected_router_status: str
    expected_tool_count: int
    category: str


def load_workflow_scenarios(catalog_path: Path) -> tuple[WorkflowScenario, ...]:
    return load_workflow_catalog(catalog_path).scenarios


def load_workflow_catalog(catalog_path: Path) -> WorkflowCatalog:
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError("Workflow catalog must contain valid JSON") from error
    if not isinstance(catalog, dict):
        raise ValueError("Workflow catalog must be an object")
    version = _required_string(catalog, "version")
    is_legacy_multi_tool_catalog = "workflowCases" not in catalog
    workflows = catalog.get("workflowCases", catalog.get("multiToolCases"))
    if not isinstance(workflows, list) or not workflows:
        raise ValueError("Workflow catalog must include workflowCases or multiToolCases")

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
            if (
                not isinstance(input_contains, dict)
                or not isinstance(output, dict)
                or (not output and requires_confirmation is not True)
            ):
                raise ValueError("Workflow Tool stages require inputContains and output objects")
            if requires_confirmation is not None and not isinstance(requires_confirmation, bool):
                raise ValueError("Workflow confirmation policy must be boolean or null")
            fixtures.append(
                WorkflowToolFixture(
                    tool_name=tool_name,
                    input_contains=dict(input_contains),
                    output=dict(output),
                    requires_confirmation=requires_confirmation,
                    outcome_input_assertions=_optional_outcome_input_assertions(stage),
                )
            )
        expected_domains = _optional_string_tuple(workflow, "expectedDomains")
        evaluation_domains = (
            _optional_string_tuple(workflow, "evaluationDomains") or expected_domains
        )
        if not evaluation_domains:
            raise ValueError("Workflow must include evaluationDomains or expectedDomains")
        expected_router_status = _optional_string(workflow, "expectedRouterStatus") or "routed"
        expected_planner_status = _optional_string(workflow, "expectedPlannerStatus") or "completed"
        expected_terminal_status = (
            _optional_string(workflow, "expectedTerminalStatus") or "completed"
        )
        if expected_router_status not in {"routed", "needs_clarification", "unsupported"}:
            raise ValueError("Workflow expectedRouterStatus is invalid")
        if expected_planner_status not in {
            "tool_candidate",
            "completed",
            "needs_clarification",
            "unsupported",
        }:
            raise ValueError("Workflow expectedPlannerStatus is invalid")
        if expected_terminal_status not in {"completed", "waiting_user_input"}:
            raise ValueError("Workflow expectedTerminalStatus is invalid")
        scenarios.append(
            WorkflowScenario(
                scenario_id=_required_string(workflow, "id"),
                prompt=_required_string(workflow, "prompt"),
                fixtures=tuple(fixtures),
                category=(
                    _optional_string(workflow, "category")
                    or ("multi_tool" if is_legacy_multi_tool_catalog else "workflow")
                ),
                expected_answer_contains=_optional_string_tuple(workflow, "finalAnswerContains"),
                outcome_assertions=_optional_outcome_assertions(workflow),
                expected_domains=expected_domains,
                expected_capability_ids=_optional_string_tuple(
                    workflow,
                    "expectedCapabilityIds",
                ),
                context_surface=_optional_string(workflow, "contextSurface"),
                evaluation_domains=evaluation_domains,
                expected_router_status=expected_router_status,
                expected_planner_status=expected_planner_status,
                expected_terminal_status=expected_terminal_status,
            )
        )
    if len({scenario.scenario_id for scenario in scenarios}) != len(scenarios):
        raise ValueError("Workflow scenario IDs must be unique")
    return WorkflowCatalog(version=version, scenarios=tuple(scenarios))


def evaluate_workflow_suite(
    planner: AgentPlannerClient,
    router: AgentRouterClient,
    job: AgentRunJob,
    scenarios: tuple[WorkflowScenario, ...],
    *,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
    outcome_judge: OutcomeJudgeClient | None = None,
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
            outcome_judge=outcome_judge,
        )
        for attempt in range(1, repetitions + 1)
        for scenario in scenarios
    )


def build_workflow_evaluation_report(
    results: tuple[WorkflowEvaluationResult, ...],
) -> dict[str, object]:
    scenario_ids = {result.scenario_id for result in results}
    task_successes = sum(result.task_success for result in results)
    contract_passes = sum(result.execution_contract_passed for result in results)
    multi_tool_results = [result for result in results if result.expected_tool_count > 1]
    multi_tool_scenario_ids = {result.scenario_id for result in multi_tool_results}
    safety_violation_count = sum(len(result.safety_violations) for result in results)
    funnel_predicates = (
        ("routerRouted", lambda result: result.router_routed),
        ("domainExact", lambda result: result.domain_exact),
        ("capabilityExact", lambda result: result.capability_exact),
        ("toolExact", lambda result: "tool_sequence" not in result.failure_reasons),
        ("requiredInputExact", lambda result: "tool_input" not in result.failure_reasons),
        ("executionPolicyExact", lambda result: not result.safety_violations),
        ("endToEndExact", lambda result: result.execution_contract_passed),
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
        "exactAttemptRate": _fraction(contract_passes, len(results)),
        "executionContractPassAttempts": contract_passes,
        "routingFunnel": {
            "toolSelectionAttempts": len(results),
            "stages": stages,
        },
        "multiToolWorkflows": {
            "workflowCount": len(multi_tool_scenario_ids),
            "workflowAttempts": len(multi_tool_results),
            "exactWorkflowAttempts": sum(
                result.execution_contract_passed for result in multi_tool_results
            ),
            "exactWorkflowRate": _fraction(
                sum(result.execution_contract_passed for result in multi_tool_results),
                len(multi_tool_results),
            ),
        },
        "workflowEvaluation": {
            "taskSuccessRate": _fraction(task_successes, len(results)),
            "executionContractPassRate": _fraction(contract_passes, len(results)),
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
                "kind": result.category,
                "passed": result.task_success,
                "failureReasons": list(result.failure_reasons),
                "executionContractPassed": result.execution_contract_passed,
                "executionContractFailureReasons": list(result.execution_contract_failure_reasons),
                "expected": {
                    "domains": list(result.expected_domains),
                    "capabilityIds": list(result.expected_capability_ids),
                    "evaluationDomains": list(result.evaluation_domains),
                    "routerStatus": result.expected_router_status,
                },
                "workflow": {
                    "taskSuccess": result.task_success,
                    "taskOutcomeSuccess": result.task_success,
                    "executionContractPassed": result.execution_contract_passed,
                    "outcomeAssertions": result.outcome_assertion_results,
                    "outcomeJudge": {
                        "verdict": result.outcome_judge_verdict,
                        "failureCodes": list(result.outcome_judge_failure_codes),
                    },
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
    outcome_judge: OutcomeJudgeClient | None,
) -> WorkflowEvaluationResult:
    request_context = dict(job.request_context or {})
    if scenario.context_surface is not None:
        request_context["surface"] = scenario.context_surface
    scenario_job = replace(job, request_context=request_context or None)
    repository = _ReplayRepository(scenario_job, scenario.prompt, timezone)
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
            result = processor.process_job(scenario_job)
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

    has_outcome_assertions = scenario.outcome_assertions is not None
    outcome_failures = (
        list(repository.outcome_failures)
        if has_outcome_assertions
        else list(repository.validation_failures)
    )
    if runtime_failure is not None:
        outcome_failures.append(runtime_failure)
    if repository.status != scenario.expected_terminal_status:
        outcome_failures.append("terminal_state")
    planner_status = (repository.latest_output_summary or {}).get("status")
    expected_tools = tuple(fixture.tool_name for fixture in scenario.fixtures)
    outcome_judge_verdict: str | None = None
    outcome_judge_failure_codes: tuple[str, ...] = ()
    if has_outcome_assertions and outcome_judge is None:
        outcome_failures.extend(
            _response_outcome_failures(repository.final_answer, scenario.outcome_assertions)
        )
    elif (
        has_outcome_assertions
        and scenario.outcome_assertions.require_response
        and not _normalize_text(repository.final_answer)
    ):
        outcome_failures.append("response_missing")
    else:
        if tuple(repository.executed_tool_names) != expected_tools:
            outcome_failures.append("tool_sequence")
        if not _contains_normalized_text(
            repository.final_answer, scenario.expected_answer_contains
        ):
            outcome_failures.append("final_answer_grounding")
    routing_decisions = router_recorder.decisions
    router_routed = bool(routing_decisions) and all(
        getattr(decision, "status", None) == scenario.expected_router_status
        for decision in routing_decisions
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
            set(getattr(decision, "capability_ids", ())) == set(scenario.expected_capability_ids)
            for decision in routing_decisions
        )
    )
    if not has_outcome_assertions:
        if not router_routed:
            outcome_failures.append("router_status")
        if not domain_exact:
            outcome_failures.append("domain")
        if not capability_exact:
            outcome_failures.append("capability")
    if outcome_judge is not None and not outcome_failures and not repository.safety_violations:
        verdict = judge_outcome(
            OutcomeJudgeEvidence(
                user_task=scenario.prompt,
                expected_outcome=_expected_outcome_text(scenario),
                tool_facts=tuple(repository.tool_facts),
                final_answer=repository.final_answer,
                terminal_state=repository.status,
                safety_passed=not repository.safety_violations,
            ),
            outcome_judge,
        )
        outcome_judge_verdict = verdict.verdict
        outcome_judge_failure_codes = verdict.failure_codes
        if verdict.verdict != "pass":
            outcome_failures.append(f"judge_{verdict.verdict}")
    failure_reasons = tuple(dict.fromkeys(outcome_failures))
    contract_failures = list(repository.validation_failures)
    if runtime_failure is not None:
        contract_failures.append(runtime_failure)
    if repository.status != scenario.expected_terminal_status:
        contract_failures.append("terminal_state")
    if tuple(repository.executed_tool_names) != expected_tools:
        contract_failures.append("tool_sequence")
    if planner_status != scenario.expected_planner_status:
        contract_failures.append("planner_status")
    if any(item not in repository.final_answer for item in scenario.expected_answer_contains):
        contract_failures.append("final_answer_grounding")
    if not router_routed:
        contract_failures.append("router_status")
    if not domain_exact:
        contract_failures.append("domain")
    if not capability_exact:
        contract_failures.append("capability")
    execution_contract_failure_reasons = tuple(dict.fromkeys(contract_failures))
    return WorkflowEvaluationResult(
        scenario_id=scenario.scenario_id,
        attempt=attempt,
        task_success=not failure_reasons and not repository.safety_violations,
        failure_reasons=failure_reasons,
        execution_contract_passed=(
            not execution_contract_failure_reasons and not repository.safety_violations
        ),
        execution_contract_failure_reasons=execution_contract_failure_reasons,
        outcome_assertion_results={
            "taskCriticalInput": "task_critical_input" not in failure_reasons,
            "responseEvidence": "response_evidence" not in failure_reasons,
            "responseForbidden": "response_forbidden" not in failure_reasons,
            "responsePresent": "response_missing" not in failure_reasons,
        },
        outcome_judge_verdict=outcome_judge_verdict,
        outcome_judge_failure_codes=outcome_judge_failure_codes,
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
        evaluation_domains=scenario.evaluation_domains or scenario.expected_domains,
        expected_router_status=scenario.expected_router_status,
        expected_tool_count=len(scenario.fixtures),
        category=scenario.category,
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
        self.tool_facts: list[str] = []
        self.executed_tool_names: list[str] = []
        self.validation_failures: list[str] = []
        self.outcome_failures: list[str] = []
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
        self.final_answer = _message
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
            self.repository.outcome_failures.append("task_critical_tool")
        if not isinstance(tool_input, dict) or not _contains(tool_input, fixture.input_contains):
            self.repository.validation_failures.append("tool_input")
        outcome_input_matches = isinstance(tool_input, dict) and _matches_outcome_input(
            tool_input, fixture
        )
        if not outcome_input_matches:
            self.repository.outcome_failures.append("task_critical_input")
        if summary.get("requiresConfirmation") != fixture.requires_confirmation:
            self.repository.safety_violations.append("confirmation_policy")
        self.repository.executed_tool_names.append(tool_name)
        if fixture.requires_confirmation is True:
            self.repository.status = "waiting_user_input"
            return
        output = json.dumps(
            (
                fixture.output
                if tool_name == fixture.tool_name and outcome_input_matches
                else {"error": "fixture task-critical input did not match"}
            ),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        if tool_name == fixture.tool_name and outcome_input_matches:
            self.repository.tool_facts.extend(_fixture_facts(fixture.output))
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


def _matches_outcome_input(tool_input: dict[str, object], fixture: WorkflowToolFixture) -> bool:
    if not fixture.outcome_input_assertions:
        return _contains(tool_input, fixture.input_contains)
    return all(
        _contains_all_normalized_terms(
            _value_at_path(tool_input, assertion.path), assertion.contains_all
        )
        for assertion in fixture.outcome_input_assertions
    )


def _value_at_path(value: dict[str, object], path: tuple[str, ...]) -> object | None:
    current: object = value
    for part in path:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _contains_all_normalized_terms(value: object | None, expected: tuple[str, ...]) -> bool:
    if value is None:
        return False
    normalized_value = _normalize_text(value if isinstance(value, str) else str(value))
    return all(_normalize_text(item) in normalized_value for item in expected)


def _response_outcome_failures(
    final_answer: str, assertions: WorkflowOutcomeAssertions
) -> list[str]:
    normalized_answer = _normalize_text(final_answer)
    failures: list[str] = []
    if assertions.require_response and not normalized_answer:
        failures.append("response_missing")
    if any(
        not all(_normalize_text(item) in normalized_answer for item in evidence)
        for evidence in assertions.response_evidence
    ):
        failures.append("response_evidence")
    if any(_normalize_text(item) in normalized_answer for item in assertions.response_forbidden):
        failures.append("response_forbidden")
    return failures


def _expected_outcome_text(scenario: WorkflowScenario) -> str:
    assertions = scenario.outcome_assertions
    if assertions is None or not assertions.response_evidence:
        return "Provide the expected terminal response safely."
    return "; ".join(" ".join(group) for group in assertions.response_evidence)


def _fixture_facts(value: object, prefix: str = "") -> tuple[str, ...]:
    if isinstance(value, dict):
        return tuple(
            fact
            for key, nested in sorted(value.items())
            for fact in _fixture_facts(nested, f"{prefix}{key}.")
        )
    if isinstance(value, list):
        return tuple(
            fact
            for index, nested in enumerate(value)
            for fact in _fixture_facts(nested, f"{prefix}{index}.")
        )
    if isinstance(value, str | int | float | bool) or value is None:
        return (f"{prefix.rstrip('.')}: {value}",)
    return ()


def _contains_normalized_text(actual: str, expected: tuple[str, ...]) -> bool:
    normalized_actual = _normalize_text(actual)
    normalized_expected = tuple(_normalize_text(item) for item in expected)
    if not normalized_expected:
        return True
    if not all(item in normalized_actual for item in normalized_expected):
        return False
    if any(_is_negative_outcome(item) for item in normalized_expected):
        return not any(
            "아닙" in normalized_actual[normalized_actual.find(item) + len(item) :]
            for item in normalized_expected
        )
    return not _is_negative_outcome(normalized_actual)


def _normalize_text(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def _is_negative_outcome(value: str) -> bool:
    return any(marker in value for marker in ("찾지못", "못찾", "없습니다", "없어요", "없음"))


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


def _optional_string_tuple(value: dict[str, object], key: str) -> tuple[str, ...]:
    items = value.get(key)
    if items is None:
        return ()
    if not isinstance(items, list) or not all(
        isinstance(item, str) and item.strip() for item in items
    ):
        raise ValueError(f"Workflow {key} must be a string array")
    return tuple(item.strip() for item in items)


def _optional_outcome_input_assertions(
    value: dict[str, object],
) -> tuple[OutcomeInputAssertion, ...]:
    assertions = value.get("outcomeInputAssertions")
    if assertions is None:
        return ()
    if not isinstance(assertions, list):
        raise ValueError("Workflow outcomeInputAssertions must be an array")
    result: list[OutcomeInputAssertion] = []
    for assertion in assertions:
        if not isinstance(assertion, dict):
            raise ValueError("Workflow outcomeInputAssertions must contain objects")
        path = assertion.get("path")
        contains_all = assertion.get("containsAll")
        if (
            not isinstance(path, list)
            or not path
            or not all(isinstance(item, str) and item.strip() for item in path)
            or not isinstance(contains_all, list)
            or not contains_all
            or not all(isinstance(item, str) and item.strip() for item in contains_all)
        ):
            raise ValueError("Workflow outcomeInputAssertions entries are invalid")
        result.append(
            OutcomeInputAssertion(
                path=tuple(item.strip() for item in path),
                contains_all=tuple(item.strip() for item in contains_all),
            )
        )
    return tuple(result)


def _optional_outcome_assertions(
    value: dict[str, object],
) -> WorkflowOutcomeAssertions | None:
    outcome = value.get("outcome")
    if outcome is None:
        return None
    if not isinstance(outcome, dict):
        raise ValueError("Workflow outcome must be an object")
    response_evidence = outcome.get("responseEvidence", [])
    response_forbidden = outcome.get("responseForbidden", [])
    require_response = outcome.get("requireResponse")
    if (
        not isinstance(response_evidence, list)
        or not isinstance(response_forbidden, list)
        or not isinstance(require_response, bool)
        or not all(isinstance(item, str) and item.strip() for item in response_forbidden)
    ):
        raise ValueError("Workflow outcome assertions are invalid")
    evidence_groups: list[tuple[str, ...]] = []
    for evidence in response_evidence:
        if (
            not isinstance(evidence, dict)
            or not isinstance(evidence.get("allOf"), list)
            or not evidence["allOf"]
            or not all(isinstance(item, str) and item.strip() for item in evidence["allOf"])
        ):
            raise ValueError("Workflow outcome responseEvidence is invalid")
        evidence_groups.append(tuple(item.strip() for item in evidence["allOf"]))
    return WorkflowOutcomeAssertions(
        response_evidence=tuple(evidence_groups),
        response_forbidden=tuple(item.strip() for item in response_forbidden),
        require_response=require_response,
    )


def _optional_string(value: dict[str, object], key: str) -> str | None:
    item = value.get(key)
    if item is None:
        return None
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Workflow {key} must be a non-empty string or null")
    return item.strip()
