from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from pathlib import Path
from time import perf_counter
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from app.agent_processor import (
    AGENT_RUN_REQUESTED_JOB_TYPE,
    AgentPlannerClient,
    AgentPlannerDecision,
    AgentPlannerOutputError,
    AgentPlanningRequest,
    AgentRouterClient,
    AgentRouterOutputError,
    AgentRoutingRequest,
    AgentRunJob,
    AgentToolSchema,
    NormalizedPlannerDecision,
    normalize_agent_planner_decision,
    normalize_agent_routing_decision,
    parse_agent_run_job_payload,
    select_agent_planner_tools_for_routing,
    select_pending_agent_planner_tools_for_routing,
)
from app.agent_tool_retrieval import (
    DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET,
    TOOL_RETRIEVER_VERSION,
    ToolRetrievalResult,
    parse_tool_capability_catalog,
    select_read_only_tool_shortlist,
)
from app.meeting_report_processor import InfrastructureError

EVALUATION_RUN_ID = "00000000-0000-4000-8000-000000000001"
EVALUATION_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002"
EVALUATION_USER_ID = "00000000-0000-4000-8000-000000000003"


def build_evaluation_input_hashes(
    tool_snapshot_path: Path,
    meeting_catalog_path: Path | None = None,
    tool_capability_catalog_path: Path | None = None,
    workflow_catalog_path: Path | None = None,
) -> dict[str, str]:
    hashes = {
        "suiteSha256": hashlib.sha256(tool_snapshot_path.read_bytes()).hexdigest(),
    }
    if meeting_catalog_path:
        hashes["meetingCatalogSha256"] = hashlib.sha256(
            meeting_catalog_path.read_bytes()
        ).hexdigest()
    if tool_capability_catalog_path:
        hashes["toolCapabilityCatalogFileSha256"] = hashlib.sha256(
            tool_capability_catalog_path.read_bytes()
        ).hexdigest()
    if workflow_catalog_path:
        hashes["workflowCatalogSha256"] = hashlib.sha256(
            workflow_catalog_path.read_bytes()
        ).hexdigest()
    return hashes


@dataclass(frozen=True)
class EvaluationExpectation:
    status: str
    tool_name: str | None
    input_contains: dict[str, object]
    requires_confirmation: bool | None
    missing_fields: tuple[str, ...]
    domain: str | None = None
    capability_id: str | None = None
    domains: tuple[str, ...] = ()
    capability_ids: tuple[str, ...] = ()
    required_tool_names: tuple[str, ...] = ()
    supported: bool | None = None


@dataclass(frozen=True)
class EvaluationCase:
    case_id: str
    prompt: str
    kind: str
    expectation: EvaluationExpectation
    planning_context: str = ""
    workflow_id: str | None = None
    workflow_stage: int | None = None
    workflow_stage_count: int | None = None


@dataclass(frozen=True)
class EvaluationSuite:
    version: str
    job: AgentRunJob
    cases: tuple[EvaluationCase, ...]


@dataclass(frozen=True)
class CaseEvaluationResult:
    case_id: str
    attempt: int
    prompt: str
    kind: str
    passed: bool
    failure_reasons: tuple[str, ...]
    runtime_failure: str | None
    expected: EvaluationExpectation
    actual: NormalizedPlannerDecision
    retrieval: ToolRetrievalResult | None
    routing_status: str | None
    routing_confidence: str | None
    shortlist_tool_names: tuple[str, ...]
    shortlist_schema_bytes: int
    retrieval_latency_ms: float
    planner_latency_ms: float
    shortlist_violation: bool
    expected_domain: str | None
    expected_capability_id: str | None
    expected_domains: tuple[str, ...]
    expected_capability_ids: tuple[str, ...]
    required_tool_names: tuple[str, ...]
    expected_supported: bool
    retrieved_domains: tuple[str, ...]
    retrieved_capability_ids: tuple[str, ...]
    model_version: str
    suite_version: str
    catalog_version: str | None
    catalog_sha256: str | None
    retriever_version: str | None
    current_date: str
    timezone: str
    evaluation_seed: int
    provider_input_tokens: int | None
    provider_output_tokens: int | None
    provider_total_tokens: int | None
    workflow_id: str | None
    workflow_stage: int | None
    workflow_stage_count: int | None


class PlannerEvaluator(Protocol):
    def plan(self, request: AgentPlanningRequest): ...


def attach_tool_capability_catalog(suite: EvaluationSuite, catalog_path: Path) -> EvaluationSuite:
    try:
        raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid tool capability catalog JSON: {catalog_path}") from error
    catalog = parse_tool_capability_catalog(
        raw, {tool.name: tool.input_schema for tool in suite.job.tools}
    )
    if catalog is None:
        raise ValueError("Tool capability catalog is required")
    return replace(suite, job=replace(suite.job, tool_capability_catalog=catalog))


def load_evaluation_suite(path: Path) -> EvaluationSuite:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid evaluation suite JSON: {path}") from error

    if not isinstance(raw, dict):
        raise ValueError("Evaluation suite must be an object")

    version = _require_string(raw, "version")
    tools = raw.get("tools")
    cases = raw.get("cases")
    if not isinstance(tools, list) or not isinstance(cases, list):
        raise ValueError("Evaluation suite must include tools and cases arrays")

    job = parse_agent_run_job_payload(
        {
            "jobType": AGENT_RUN_REQUESTED_JOB_TYPE,
            "runId": EVALUATION_RUN_ID,
            "workspaceId": EVALUATION_WORKSPACE_ID,
            "requestedByUserId": EVALUATION_USER_ID,
            "toolSchemaVersion": _require_string(raw, "toolSchemaVersion"),
            "tools": tools,
            "toolCapabilityCatalog": raw.get("toolCapabilityCatalog"),
        }
    )

    parsed_cases = tuple(_parse_case(item) for item in cases)
    if not parsed_cases:
        raise ValueError("Evaluation suite must include at least one case")
    if len({case.case_id for case in parsed_cases}) != len(parsed_cases):
        raise ValueError("Evaluation suite contains duplicate case IDs")

    return EvaluationSuite(version=version, job=job, cases=parsed_cases)


def load_meeting_regression_suite(
    catalog_path: Path,
    tool_snapshot_path: Path,
    variant: str,
) -> EvaluationSuite:
    if variant not in {"canonical", "held_out", "counterexample", "context", "multi_tool"}:
        raise ValueError(
            "Meeting regression variant must be canonical, held_out, counterexample, context, "
            "or multi_tool"
        )

    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid meeting regression catalog JSON: {catalog_path}") from error
    if not isinstance(catalog, dict):
        raise ValueError("Meeting regression catalog must be an object")

    prefixes = catalog.get("canonicalPrefixes")
    capabilities = catalog.get("capabilities")
    if (
        not isinstance(prefixes, list)
        or not all(isinstance(prefix, str) for prefix in prefixes)
        or not isinstance(capabilities, list)
    ):
        raise ValueError("Meeting regression catalog has invalid capability variants")

    base_suite = load_evaluation_suite(tool_snapshot_path)
    capability_by_id = {
        _require_string(capability, "id"): capability
        for capability in capabilities
        if isinstance(capability, dict)
    }
    quality_cases = catalog.get("qualityCases", [])
    if not isinstance(quality_cases, list):
        raise ValueError("Meeting regression qualityCases must be an array")
    if variant == "multi_tool":
        cases = _meeting_multi_tool_cases(catalog, base_suite)
        return EvaluationSuite(
            version=f"{_require_string(catalog, 'version')}:{variant}",
            job=base_suite.job,
            cases=cases,
        )
    cases: list[EvaluationCase] = []
    for capability in capabilities:
        if not isinstance(capability, dict):
            raise ValueError("Meeting regression capability must be an object")
        capability_id = _require_string(capability, "id")
        if variant == "canonical":
            expectation = _meeting_regression_expectation(capability)
            seeds = capability.get("canonicalSeeds")
            if not isinstance(seeds, list) or not all(
                isinstance(seed, str) and seed for seed in seeds
            ):
                raise ValueError("Meeting regression canonicalSeeds must be a string array")
            prompts = [f"{prefix}{seed}".strip() for prefix in prefixes for seed in seeds]
            prompt_expectations = [(prompt, expectation) for prompt in prompts]
        elif variant == "held_out":
            expectation = _meeting_regression_expectation(capability)
            prompts = capability.get("heldOutParaphrases")
            if not isinstance(prompts, list) or not all(
                isinstance(prompt, str) and prompt for prompt in prompts
            ):
                raise ValueError("Meeting regression heldOutParaphrases must be a string array")
            prompt_expectations = [(prompt, expectation) for prompt in prompts]
        elif variant == "counterexample":
            counterexamples = capability.get("counterexamples")
            if not isinstance(counterexamples, list):
                raise ValueError("Meeting regression counterexamples must be an array")
            prompt_expectations = []
            for item in counterexamples:
                if not isinstance(item, dict):
                    raise ValueError("Meeting regression counterexample must be an object")
                expected_capability = capability_by_id.get(
                    _require_string(item, "expectedCapability")
                )
                if expected_capability is None:
                    raise ValueError("Meeting regression counterexample capability is unknown")
                prompt_expectations.append(
                    (
                        _require_string(item, "prompt"),
                        _meeting_regression_expectation(expected_capability),
                    )
                )
        else:
            expectation = _meeting_regression_expectation(capability)
            prompts = capability.get("contextFollowups")
            if not isinstance(prompts, list) or not all(
                isinstance(prompt, str) and prompt for prompt in prompts
            ):
                raise ValueError("Meeting regression contextFollowups must be a string array")
            prompt_expectations = [(prompt, expectation) for prompt in prompts]

        for index, (prompt, expectation) in enumerate(prompt_expectations, start=1):
            cases.append(
                EvaluationCase(
                    case_id=f"{capability_id}:{variant}:{index}",
                    prompt=prompt,
                    kind=variant,
                    expectation=expectation,
                    planning_context=(
                        _meeting_regression_context(capability_id) if variant == "context" else ""
                    ),
                )
            )

    for value in quality_cases:
        quality_case = _parse_case(value)
        if quality_case.kind != variant:
            continue
        capability_id = quality_case.expectation.capability_id
        planning_context = (
            _meeting_regression_context(capability_id)
            if variant == "context" and capability_id
            else ""
        )
        cases.append(
            replace(
                quality_case,
                case_id=f"quality:{quality_case.case_id}",
                planning_context=planning_context,
            )
        )

    if not cases:
        raise ValueError("Meeting regression catalog must produce at least one case")
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError("Meeting regression catalog produced duplicate case IDs")

    return EvaluationSuite(
        version=f"{_require_string(catalog, 'version')}:{variant}",
        job=base_suite.job,
        cases=tuple(cases),
    )


def _meeting_multi_tool_cases(
    catalog: dict[str, object],
    base_suite: EvaluationSuite,
) -> tuple[EvaluationCase, ...]:
    workflows = catalog.get("multiToolCases")
    if not isinstance(workflows, list) or not workflows:
        raise ValueError("Meeting regression multiToolCases must be a non-empty array")
    eligible_tool_names = {tool.name for tool in base_suite.job.tools}
    cases: list[EvaluationCase] = []
    workflow_ids: set[str] = set()
    for workflow in workflows:
        if not isinstance(workflow, dict):
            raise ValueError("Meeting regression multi-tool workflow must be an object")
        workflow_id = _require_string(workflow, "id")
        if workflow_id in workflow_ids:
            raise ValueError("Meeting regression multi-tool workflow IDs must be unique")
        workflow_ids.add(workflow_id)
        prompt = _require_string(workflow, "prompt")
        domains = _string_tuple(workflow, "expectedDomains")
        capability_ids = _string_tuple(workflow, "expectedCapabilityIds")
        if len(domains) < 2 or len(capability_ids) < 2:
            raise ValueError("Multi-tool workflow must cover at least two capabilities and domains")
        stages = workflow.get("stages")
        if not isinstance(stages, list) or len(stages) < 3:
            raise ValueError("Multi-tool workflow must include tool stages and completion")
        tool_names = tuple(
            _require_string(stage, "toolName")
            for stage in stages
            if isinstance(stage, dict) and stage.get("toolName") is not None
        )
        if len(tool_names) < 2 or len(set(tool_names)) < 2:
            raise ValueError("Multi-tool workflow must select at least two distinct tools")
        if any(name not in eligible_tool_names for name in tool_names):
            raise ValueError("Multi-tool workflow references an unknown tool")
        completed: list[str] = []
        for index, stage in enumerate(stages, start=1):
            if not isinstance(stage, dict):
                raise ValueError("Multi-tool workflow stage must be an object")
            tool_name = stage.get("toolName")
            status = stage.get("status", "tool_candidate")
            if not isinstance(status, str) or not status:
                raise ValueError("Multi-tool workflow stage status must be a string")
            if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
                raise ValueError("Multi-tool workflow stage toolName must be a string")
            if status == "completed" and tool_name is not None:
                raise ValueError("Multi-tool completion stage must not select a tool")
            input_contains = stage.get("inputContains", {})
            if not isinstance(input_contains, dict):
                raise ValueError("Multi-tool workflow inputContains must be an object")
            requires_confirmation = stage.get("requiresConfirmation")
            if requires_confirmation is not None and not isinstance(requires_confirmation, bool):
                raise ValueError("Multi-tool workflow confirmation must be a boolean")
            planning_context = "\n".join(f"tool {name}: {{}}" for name in completed)
            cases.append(
                EvaluationCase(
                    case_id=f"multi_tool:{workflow_id}:stage:{index}",
                    prompt=prompt,
                    kind="multi_tool",
                    expectation=EvaluationExpectation(
                        status=status,
                        tool_name=tool_name,
                        input_contains=dict(input_contains),
                        requires_confirmation=requires_confirmation,
                        missing_fields=(),
                        domains=domains,
                        capability_ids=capability_ids,
                        required_tool_names=tool_names,
                        supported=True,
                    ),
                    planning_context=planning_context,
                    workflow_id=workflow_id,
                    workflow_stage=index,
                    workflow_stage_count=len(stages),
                )
            )
            if tool_name is not None:
                completed.append(tool_name)
        if stages[-1].get("status") != "completed":
            raise ValueError("Multi-tool workflow must end with completed")
    return tuple(cases)


def _meeting_regression_expectation(capability: dict[str, object]) -> EvaluationExpectation:
    raw = capability.get("currentExpectation")
    if not isinstance(raw, dict):
        raise ValueError("Meeting regression capability must include currentExpectation")
    tool_name = raw.get("toolName")
    if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
        raise ValueError("Meeting regression currentExpectation toolName must be a string")
    target = capability.get("target")
    if not isinstance(target, dict):
        raise ValueError("Meeting regression capability must include target")
    tool_sequence = target.get("toolSequence")
    if not isinstance(tool_sequence, list) or not all(
        isinstance(item, str) and item for item in tool_sequence
    ):
        raise ValueError("Meeting regression target toolSequence must be a string array")
    return EvaluationExpectation(
        status=_require_string(raw, "status"),
        tool_name=tool_name,
        input_contains={},
        requires_confirmation=None,
        missing_fields=(),
        domain="meeting",
        capability_id=_require_string(capability, "id"),
        required_tool_names=tuple(tool_sequence),
        supported=True,
    )


def _meeting_regression_context(capability_id: str) -> str:
    resource_type = (
        "meeting_room"
        if capability_id in {"meeting.start", "meeting.join", "meeting.participants"}
        else (
            "meeting_report"
            if capability_id.startswith("meeting_reports")
            or capability_id.startswith("meeting.action_items")
            or capability_id == "meeting.decision_evidence"
            else "meeting"
        )
    )
    return (
        "previous assistant: 이전 조회 결과에서 사용자가 대상을 선택했습니다.\n"
        f"previous resource: type={resource_type} label=선택한 후보"
    )


def evaluate_suite(
    planner: AgentPlannerClient,
    suite: EvaluationSuite,
    current_date: str,
    timezone: str = "Asia/Seoul",
    repetitions: int = 1,
    use_shadow_retrieval: bool = False,
    shadow_top_k: int = 8,
    model_version: str = "unknown",
    evaluation_seed: int = 0,
    router: AgentRouterClient | None = None,
    use_llm_routing: bool = False,
) -> tuple[CaseEvaluationResult, ...]:
    if repetitions < 1:
        raise ValueError("Evaluation repetitions must be at least 1")

    return tuple(
        evaluate_case(
            planner,
            suite.job,
            case,
            current_date,
            timezone,
            attempt,
            use_shadow_retrieval=use_shadow_retrieval,
            shadow_top_k=shadow_top_k,
            model_version=model_version,
            evaluation_seed=evaluation_seed,
            suite_version=suite.version,
            router=router,
            use_llm_routing=use_llm_routing,
        )
        for attempt in range(1, repetitions + 1)
        for case in suite.cases
    )


def evaluate_case(
    planner: AgentPlannerClient,
    job: AgentRunJob,
    case: EvaluationCase,
    current_date: str,
    timezone: str,
    attempt: int,
    *,
    use_shadow_retrieval: bool = False,
    shadow_top_k: int = 8,
    model_version: str = "unknown",
    evaluation_seed: int = 0,
    suite_version: str = "unknown",
    router: AgentRouterClient | None = None,
    use_llm_routing: bool = False,
) -> CaseEvaluationResult:
    tools = job.tools
    retrieval = None
    retrieval_latency_ms = 0.0
    routing = None
    runtime_failure: str | None = None
    if use_llm_routing:
        if router is None or job.tool_capability_catalog is None:
            raise ValueError("LLM routing evaluation requires a router and capability catalog")
        routing_started = perf_counter()
        try:
            routing = normalize_agent_routing_decision(
                router.route(
                    AgentRoutingRequest(
                        prompt=case.prompt,
                        timezone=timezone,
                        current_date=current_date,
                        catalog=job.tool_capability_catalog,
                        planning_context=case.planning_context,
                        context_surface=(
                            job.request_context.get("surface")
                            if job.request_context is not None
                            else None
                        ),
                    )
                ),
                job.tool_capability_catalog,
            )
        except AgentRouterOutputError:
            runtime_failure = "router_output"
        except InfrastructureError:
            runtime_failure = "router_infrastructure"
        finally:
            retrieval_latency_ms = (perf_counter() - routing_started) * 1000
        if routing is not None and routing.status == "routed":
            tools = select_agent_planner_tools_for_routing(
                job,
                routing,
                top_k=shadow_top_k,
            )
            tools = select_pending_agent_planner_tools_for_routing(
                job,
                routing,
                tools,
                case.planning_context,
            )
    elif use_shadow_retrieval:
        retrieval_started = perf_counter()
        tools, retrieval = select_shadow_planner_tools(job, case.prompt, top_k=shadow_top_k)
        retrieval_latency_ms = (perf_counter() - retrieval_started) * 1000

    planner_started = perf_counter()
    planner_output_failure: str | None = None
    completion_tool_names: tuple[str, ...] = ()
    workflow_incomplete = False
    if routing is not None and routing.status == "routed":
        completion_tool_names = _routing_completion_tool_names(job, routing.capability_ids)
        completed_tool_names = _completed_tool_names(case.planning_context)
        workflow_incomplete = not set(completion_tool_names).issubset(completed_tool_names)
    if runtime_failure is not None:
        decision = _rejected_planner_decision()
    elif routing is not None and routing.status != "routed":
        decision = AgentPlannerDecision(
            status=(
                "needs_clarification" if routing.status == "needs_clarification" else "unsupported"
            ),
            message="Router terminal decision",
            final_answer_draft=(
                routing.clarification_question
                if routing.status == "needs_clarification"
                else "현재 지원하지 않는 요청입니다."
            ),
            tool_name=None,
            tool_input={},
            requires_confirmation=False,
            missing_fields=("intent",) if routing.status == "needs_clarification" else (),
            unsupported_reason=routing.unsupported_reason,
        )
    else:
        try:
            decision = planner.plan(
                AgentPlanningRequest(
                    run_id=str(
                        uuid5(
                            NAMESPACE_URL,
                            f"agent-planner-evaluation:{evaluation_seed}:{case.case_id}:{attempt}",
                        )
                    ),
                    prompt=case.prompt,
                    timezone=timezone,
                    current_date=current_date,
                    tool_schema_version=job.tool_schema_version,
                    tools=tools,
                    planning_context=case.planning_context,
                    routing=routing,
                    completion_tool_names=completion_tool_names,
                    workflow_incomplete=workflow_incomplete,
                )
            )
        except AgentPlannerOutputError as error:
            planner_output_failure = _planner_output_failure(error)
            decision = _rejected_planner_decision()
        except InfrastructureError:
            runtime_failure = "planner_infrastructure"
            decision = _rejected_planner_decision()
    planner_latency_ms = (perf_counter() - planner_started) * 1000
    shortlist_tool_names = tuple(tool.name for tool in tools)
    shortlist_violation = planner_output_failure == "tool_outside_shortlist" or bool(
        (routing is not None or retrieval and not retrieval.low_confidence)
        and decision.tool_name
        and decision.tool_name not in shortlist_tool_names
    )
    if planner_output_failure is None:
        try:
            actual = normalize_agent_planner_decision(
                decision,
                replace(job, tools=tools),
                prompt=case.prompt,
                current_date=current_date,
                timezone=timezone,
                planning_context=case.planning_context,
                strict_tool_selection=(routing is not None or retrieval is not None),
                completion_tool_names=completion_tool_names,
                routed_capability_ids=(routing.capability_ids if routing is not None else ()),
            )
        except AgentPlannerOutputError as error:
            planner_output_failure = _planner_output_failure(error)
            shortlist_violation = (
                shortlist_violation or planner_output_failure == "tool_outside_shortlist"
            )
            actual = _rejected_normalized_decision(planner_output_failure)
    else:
        actual = _rejected_normalized_decision(planner_output_failure)
    failures = (
        ["runtime_failure"]
        if runtime_failure is not None
        else (
            ["planner_output"]
            if planner_output_failure is not None
            else _compare(case.expectation, actual)
        )
    )
    if shortlist_violation:
        for failure in ("tool", "shortlist_tool"):
            if failure not in failures:
                failures.append(failure)
    descriptor_by_tool_name = (
        {descriptor.tool_name: descriptor for descriptor in job.tool_capability_catalog.descriptors}
        if job.tool_capability_catalog
        else {}
    )
    expected_descriptor = (
        descriptor_by_tool_name.get(case.expectation.tool_name)
        if case.expectation.tool_name
        else None
    )
    expected_domain = case.expectation.domain or (
        expected_descriptor.domain if expected_descriptor else None
    )
    expected_domains = case.expectation.domains or ((expected_domain,) if expected_domain else ())
    expected_capability_ids = case.expectation.capability_ids or (
        (case.expectation.capability_id,) if case.expectation.capability_id else ()
    )
    required_tool_names = case.expectation.required_tool_names or (
        (case.expectation.tool_name,) if case.expectation.tool_name else ()
    )
    retrieved_descriptors = [
        descriptor_by_tool_name[tool_name]
        for tool_name in (retrieval.tool_names if retrieval else ())
        if tool_name in descriptor_by_tool_name
    ]
    return CaseEvaluationResult(
        case_id=case.case_id,
        attempt=attempt,
        prompt=case.prompt,
        kind=case.kind,
        passed=not failures,
        failure_reasons=tuple(failures),
        runtime_failure=runtime_failure,
        expected=case.expectation,
        actual=actual,
        retrieval=retrieval,
        routing_status=(routing.status if routing else "failed" if use_llm_routing else None),
        routing_confidence=routing.confidence if routing else None,
        shortlist_tool_names=shortlist_tool_names,
        shortlist_schema_bytes=_tool_schema_bytes(tools),
        retrieval_latency_ms=retrieval_latency_ms,
        planner_latency_ms=planner_latency_ms,
        shortlist_violation=shortlist_violation,
        expected_domain=expected_domain,
        expected_capability_id=case.expectation.capability_id,
        expected_domains=expected_domains,
        expected_capability_ids=expected_capability_ids,
        required_tool_names=required_tool_names,
        expected_supported=(
            case.expectation.supported
            if case.expectation.supported is not None
            else case.expectation.status != "unsupported"
        ),
        retrieved_domains=(
            routing.domains
            if routing is not None
            else tuple(sorted({descriptor.domain for descriptor in retrieved_descriptors}))
        ),
        retrieved_capability_ids=(
            routing.capability_ids
            if routing is not None
            else tuple(
                sorted(
                    {
                        capability_id
                        for descriptor in retrieved_descriptors
                        for capability_id in descriptor.capability_ids
                    }
                )
            )
        ),
        model_version=model_version,
        suite_version=suite_version,
        catalog_version=(
            job.tool_capability_catalog.version if job.tool_capability_catalog else None
        ),
        catalog_sha256=(
            job.tool_capability_catalog.sha256 if job.tool_capability_catalog else None
        ),
        retriever_version=(
            "agent-tool-llm-router:v1"
            if use_llm_routing
            else TOOL_RETRIEVER_VERSION if retrieval else None
        ),
        current_date=current_date,
        timezone=timezone,
        evaluation_seed=evaluation_seed,
        provider_input_tokens=_sum_optional_tokens(
            decision.provider_input_tokens,
            routing.provider_input_tokens if routing else None,
        ),
        provider_output_tokens=_sum_optional_tokens(
            decision.provider_output_tokens,
            routing.provider_output_tokens if routing else None,
        ),
        provider_total_tokens=_sum_optional_tokens(
            decision.provider_total_tokens,
            routing.provider_total_tokens if routing else None,
        ),
        workflow_id=case.workflow_id,
        workflow_stage=case.workflow_stage,
        workflow_stage_count=case.workflow_stage_count,
    )


def _routing_completion_tool_names(
    job: AgentRunJob,
    capability_ids: tuple[str, ...],
) -> tuple[str, ...]:
    catalog = job.tool_capability_catalog
    if catalog is None:
        return ()
    capability_by_id = {capability.capability_id: capability for capability in catalog.capabilities}
    names: list[str] = []
    for capability_id in capability_ids:
        capability = capability_by_id.get(capability_id)
        if capability is not None and capability.tool_names:
            names.append(capability.tool_names[-1])
    return tuple(dict.fromkeys(names))


def _completed_tool_names(planning_context: str) -> set[str]:
    names: set[str] = set()
    for line in planning_context.splitlines():
        if not line.startswith("tool ") or ": " not in line:
            continue
        tool_name, _, output = line[5:].partition(": ")
        try:
            parsed = json.loads(output)
        except (TypeError, ValueError):
            continue
        if tool_name and isinstance(parsed, dict):
            names.add(tool_name)
    return names


def _sum_optional_tokens(*values: int | None) -> int | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def select_shadow_planner_tools(
    job: AgentRunJob,
    prompt: str,
    top_k: int = 8,
    schema_token_budget: int = DEFAULT_TOOL_SHORTLIST_SCHEMA_TOKEN_BUDGET,
) -> tuple[tuple[AgentToolSchema, ...], ToolRetrievalResult | None]:
    catalog = job.tool_capability_catalog
    if catalog is None:
        return job.tools, None

    selection = select_read_only_tool_shortlist(
        prompt,
        catalog,
        {tool.name: tool.input_schema for tool in job.tools},
        top_k=top_k,
        schema_token_budget=schema_token_budget,
    )
    selected_names = set(selection.tool_names)
    return tuple(tool for tool in job.tools if tool.name in selected_names), selection.retrieval


def build_evaluation_report(results: tuple[CaseEvaluationResult, ...]) -> dict[str, object]:
    tool_cases = [result for result in results if result.expected.tool_name]
    input_cases = [result for result in results if result.expected.input_contains]
    confirmation_cases = [
        result for result in results if result.expected.requires_confirmation is not None
    ]
    clarification_cases = [result for result in results if result.expected.missing_fields]
    cases_by_id: dict[str, list[CaseEvaluationResult]] = {}
    for result in results:
        cases_by_id.setdefault(result.case_id, []).append(result)

    case_summaries = [
        _case_summary(case_id, case_results)
        for case_id, case_results in sorted(cases_by_id.items())
    ]
    retrieval_results = [result for result in results if result.retriever_version is not None]
    retrieval_tool_cases = [result for result in retrieval_results if result.expected.tool_name]
    adjacent_negative_results = [
        result for result in retrieval_tool_cases if result.kind == "counterexample"
    ]
    retrieval_by_kind = {
        kind: _retrieval_metric_summary(
            [result for result in retrieval_results if result.kind == kind]
        )
        for kind in sorted({result.kind for result in retrieval_results})
    }
    return {
        "totalCases": len(case_summaries),
        "totalAttempts": len(results),
        "passedCases": sum(summary["exactRate"] == 1.0 for summary in case_summaries),
        "passedAttempts": sum(result.passed for result in results),
        "exactAttemptRate": _exact_rate(results),
        "statusAccuracy": _accuracy(results, "status"),
        "toolSelectionAccuracy": _accuracy(tool_cases, "tool"),
        "requiredInputAccuracy": _accuracy(input_cases, "input"),
        "confirmationAccuracy": _accuracy(confirmation_cases, "confirmation"),
        "clarificationAccuracy": _accuracy(clarification_cases, "missing_fields"),
        "routingFunnel": _routing_funnel(results),
        "multiToolWorkflows": _multi_tool_workflow_summary(results),
        "planner": {
            "latencyMs": _latency_summary([result.planner_latency_ms for result in results]),
            "averageEstimatedToolSchemaTokens": _average(
                [(result.shortlist_schema_bytes + 3) // 4 for result in results]
            ),
            "providerTokenUsage": {
                "input": _optional_int_summary(
                    [result.provider_input_tokens for result in results]
                ),
                "output": _optional_int_summary(
                    [result.provider_output_tokens for result in results]
                ),
                "total": _optional_int_summary(
                    [result.provider_total_tokens for result in results]
                ),
            },
        },
        "retrieval": {
            "attempts": len(retrieval_results),
            "toolRecall": _retrieval_recall(retrieval_tool_cases),
            "domainRecallAtK": _domain_recall(retrieval_results),
            "capabilityRecallAtK": _capability_recall(retrieval_results),
            "requiredToolRecallAtK": _required_tool_recall(retrieval_results),
            "adjacentNegativeRoutingAccuracy": _retrieval_recall(adjacent_negative_results),
            "adjacentIntentMisselectionRate": _inverse_rate(
                _required_tool_recall(adjacent_negative_results)
            ),
            "supportedToUnsupportedMisjudgments": _supported_to_unsupported_count(
                retrieval_results
            ),
            "supportedToUnsupportedRate": _supported_to_unsupported_rate(retrieval_results),
            "averageShortlistSize": _average(
                [len(result.shortlist_tool_names) for result in retrieval_results]
            ),
            "averageEstimatedToolSchemaTokens": _average(
                [(result.shortlist_schema_bytes + 3) // 4 for result in retrieval_results]
            ),
            "fallbackTaxonomy": _fallback_taxonomy(retrieval_results),
            "shortlistViolations": sum(result.shortlist_violation for result in retrieval_results),
            "retrievalLatencyMs": _latency_summary(
                [result.retrieval_latency_ms for result in retrieval_results]
            ),
            "plannerLatencyMs": _latency_summary(
                [result.planner_latency_ms for result in retrieval_results]
            ),
            "byKind": retrieval_by_kind,
        },
        "retrievalEvents": [_privacy_safe_retrieval_event(result) for result in retrieval_results],
        "flakyCaseIds": [
            summary["id"] for summary in case_summaries if 0.0 < summary["exactRate"] < 1.0
        ],
        "caseSummaries": case_summaries,
        "results": [
            {
                "id": result.case_id,
                "attempt": result.attempt,
                "kind": result.kind,
                "workflowId": result.workflow_id,
                "workflowStage": result.workflow_stage,
                "workflowStageCount": result.workflow_stage_count,
                "expected": _privacy_safe_expected(result.expected),
                "passed": result.passed,
                "classification": _classification(result),
                "failureReasons": list(result.failure_reasons),
                "runtimeFailure": result.runtime_failure,
                "failureCategoryCandidates": _failure_category_candidates(result),
                "actual": _privacy_safe_actual(result.actual),
                "retrieval": _retrieval_output(result),
            }
            for result in results
        ],
    }


def _routing_funnel(results: tuple[CaseEvaluationResult, ...]) -> dict[str, object]:
    tool_results = [
        result
        for result in results
        if result.routing_status is not None and result.expected.tool_name is not None
    ]
    total = len(tool_results)
    previous_count = total
    cumulative = list(tool_results)
    stages: dict[str, object] = {}

    predicates = (
        ("routerRouted", lambda result: result.routing_status == "routed"),
        (
            "domainExact",
            lambda result: not result.expected_domains
            or set(result.retrieved_domains) == set(result.expected_domains),
        ),
        (
            "capabilityExact",
            lambda result: not result.expected_capability_ids
            or set(result.retrieved_capability_ids) == set(result.expected_capability_ids),
        ),
        ("toolExact", lambda result: "tool" not in result.failure_reasons),
        ("requiredInputExact", lambda result: "input" not in result.failure_reasons),
        (
            "executionPolicyExact",
            lambda result: not {
                "status",
                "confirmation",
                "missing_fields",
            }.intersection(result.failure_reasons),
        ),
        ("endToEndExact", lambda result: result.passed),
    )
    for name, predicate in predicates:
        cumulative = [result for result in cumulative if predicate(result)]
        count = len(cumulative)
        stages[name] = {
            "count": count,
            "conditionalRate": _fraction(count, previous_count),
            "overallRate": _fraction(count, total),
        }
        previous_count = count

    return {
        "toolSelectionAttempts": total,
        "stages": stages,
    }


def _multi_tool_workflow_summary(
    results: tuple[CaseEvaluationResult, ...],
) -> dict[str, object] | None:
    multi_tool_results = [result for result in results if result.workflow_id is not None]
    if not multi_tool_results:
        return None
    grouped: dict[tuple[str, int], list[CaseEvaluationResult]] = {}
    for result in multi_tool_results:
        grouped.setdefault((str(result.workflow_id), result.attempt), []).append(result)
    exact_attempts = 0
    for workflow_results in grouped.values():
        expected_stage_count = workflow_results[0].workflow_stage_count
        stages = {result.workflow_stage for result in workflow_results}
        if (
            isinstance(expected_stage_count, int)
            and stages == set(range(1, expected_stage_count + 1))
            and all(result.passed for result in workflow_results)
            and all(result.routing_status == "routed" for result in workflow_results)
            and all(
                set(result.retrieved_domains) == set(result.expected_domains)
                for result in workflow_results
            )
            and all(
                set(result.retrieved_capability_ids) == set(result.expected_capability_ids)
                for result in workflow_results
            )
        ):
            exact_attempts += 1
    return {
        "workflowCount": len({result.workflow_id for result in multi_tool_results}),
        "workflowAttempts": len(grouped),
        "exactWorkflowAttempts": exact_attempts,
        "exactWorkflowRate": _fraction(exact_attempts, len(grouped)),
        "stageAttempts": len(multi_tool_results),
    }


def build_legacy_shadow_comparison(
    legacy_results: tuple[CaseEvaluationResult, ...],
    shadow_results: tuple[CaseEvaluationResult, ...],
) -> dict[str, object]:
    legacy_keys = [_comparison_input_signature(result) for result in legacy_results]
    shadow_keys = [_comparison_input_signature(result) for result in shadow_results]
    if legacy_keys != shadow_keys:
        raise ValueError("Legacy and shadow evaluation inputs must match")

    legacy = build_evaluation_report(legacy_results)
    shadow = build_evaluation_report(shadow_results)
    return {
        "legacy": legacy,
        "shadow": shadow,
        "comparison": {
            "pairedAttempts": len(legacy_keys),
            "sameFixedInputs": True,
            "shadowMinusLegacy": {
                "exactAttemptRate": _numeric_delta(
                    shadow.get("exactAttemptRate"), legacy.get("exactAttemptRate")
                ),
                "toolSelectionAccuracy": _numeric_delta(
                    shadow.get("toolSelectionAccuracy"),
                    legacy.get("toolSelectionAccuracy"),
                ),
                "averagePlannerLatencyMs": _numeric_delta(
                    _nested_metric(shadow, "planner", "latencyMs", "average"),
                    _nested_metric(legacy, "planner", "latencyMs", "average"),
                ),
                "averageEstimatedToolSchemaTokens": _numeric_delta(
                    _nested_metric(shadow, "planner", "averageEstimatedToolSchemaTokens"),
                    _nested_metric(legacy, "planner", "averageEstimatedToolSchemaTokens"),
                ),
            },
        },
    }


def _nested_metric(value: object, *keys: str) -> object:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _comparison_input_signature(result: CaseEvaluationResult) -> tuple[object, ...]:
    return (
        result.case_id,
        result.attempt,
        result.model_version,
        result.suite_version,
        result.current_date,
        result.timezone,
        result.evaluation_seed,
        result.catalog_version,
        result.catalog_sha256,
    )


def _numeric_delta(right: object, left: object) -> float | None:
    if not isinstance(right, int | float) or not isinstance(left, int | float):
        return None
    return round(float(right) - float(left), 4)


def _parse_case(value: object) -> EvaluationCase:
    if not isinstance(value, dict):
        raise ValueError("Evaluation case must be an object")
    expected = value.get("expected")
    if not isinstance(expected, dict):
        raise ValueError("Evaluation case must include expected")
    input_contains = expected.get("inputContains", {})
    if not isinstance(input_contains, dict):
        raise ValueError("Evaluation expected inputContains must be an object")
    missing_fields = expected.get("missingFields", [])
    if not isinstance(missing_fields, list) or not all(
        isinstance(field, str) and field for field in missing_fields
    ):
        raise ValueError("Evaluation expected missingFields must be a string array")
    requires_confirmation = expected.get("requiresConfirmation")
    if requires_confirmation is not None and not isinstance(requires_confirmation, bool):
        raise ValueError("Evaluation expected requiresConfirmation must be a boolean")

    tool_name = expected.get("toolName")
    if tool_name is not None and (not isinstance(tool_name, str) or not tool_name):
        raise ValueError("Evaluation expected toolName must be a string")
    domain = expected.get("domain")
    if domain is not None and (not isinstance(domain, str) or not domain.strip()):
        raise ValueError("Evaluation expected domain must be a string")
    capability_id = expected.get("capabilityId")
    if capability_id is not None and (
        not isinstance(capability_id, str) or not capability_id.strip()
    ):
        raise ValueError("Evaluation expected capabilityId must be a string")
    domains = _optional_string_tuple(expected, "domains")
    capability_ids = _optional_string_tuple(expected, "capabilityIds")
    required_tool_names = expected.get("requiredToolNames", [])
    if not isinstance(required_tool_names, list) or not all(
        isinstance(name, str) and name for name in required_tool_names
    ):
        raise ValueError("Evaluation expected requiredToolNames must be a string array")
    supported = expected.get("supported")
    if supported is not None and not isinstance(supported, bool):
        raise ValueError("Evaluation expected supported must be a boolean")

    return EvaluationCase(
        case_id=_require_string(value, "id"),
        prompt=_require_string(value, "prompt"),
        kind=_optional_kind(value),
        expectation=EvaluationExpectation(
            status=_require_string(expected, "status"),
            tool_name=tool_name,
            input_contains=dict(input_contains),
            requires_confirmation=requires_confirmation,
            missing_fields=tuple(missing_fields),
            domain=domain.strip() if isinstance(domain, str) else None,
            capability_id=(capability_id.strip() if isinstance(capability_id, str) else None),
            domains=domains,
            capability_ids=capability_ids,
            required_tool_names=tuple(required_tool_names),
            supported=supported,
        ),
    )


def _compare(
    expected: EvaluationExpectation,
    actual: NormalizedPlannerDecision,
) -> list[str]:
    failures: list[str] = []
    summary = actual.output_summary
    if actual.status != expected.status:
        failures.append("status")
    if expected.tool_name and summary.get("toolName") != expected.tool_name:
        failures.append("tool")
    if expected.requires_confirmation is not None and (
        summary.get("requiresConfirmation") is not expected.requires_confirmation
    ):
        failures.append("confirmation")
    actual_input = summary.get("input", {})
    if not isinstance(actual_input, dict) or not _contains(actual_input, expected.input_contains):
        failures.append("input")
    actual_missing = summary.get("missingFields", [])
    if expected.missing_fields and not set(expected.missing_fields).issubset(actual_missing):
        failures.append("missing_fields")
    return failures


def _contains(actual: dict[str, object], expected: dict[str, object]) -> bool:
    for key, expected_value in expected.items():
        actual_value = actual.get(key)
        if isinstance(expected_value, dict):
            if not isinstance(actual_value, dict) or not _contains(actual_value, expected_value):
                return False
        elif actual_value != expected_value:
            return False
    return True


def _accuracy(results: list[CaseEvaluationResult], category: str) -> float | None:
    if not results:
        return None
    return round(
        sum(category not in result.failure_reasons for result in results) / len(results), 4
    )


def _exact_rate(results: list[CaseEvaluationResult]) -> float | None:
    if not results:
        return None
    return round(sum(result.passed for result in results) / len(results), 4)


def _case_summary(
    case_id: str,
    results: list[CaseEvaluationResult],
) -> dict[str, object]:
    return {
        "id": case_id,
        "kind": results[0].kind,
        "expected": _privacy_safe_expected(results[0].expected),
        "attempts": len(results),
        "exactCount": sum(result.passed for result in results),
        "exactRate": _exact_rate(results),
        "requiresManualReview": not all(result.passed for result in results),
        "failureCategoryCandidates": sorted(
            {category for result in results for category in _failure_category_candidates(result)}
        ),
    }


def _tool_schema_bytes(tools: tuple[AgentToolSchema, ...]) -> int:
    payload = [
        {
            "name": tool.name,
            "description": tool.description,
            "riskLevel": tool.risk_level,
            "executionMode": tool.execution_mode,
            "inputSchema": tool.input_schema,
        }
        for tool in tools
    ]
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _retrieval_recall(results: list[CaseEvaluationResult]) -> float | None:
    if not results:
        return None
    return round(
        sum(bool(result.expected.tool_name in _retrieved_tool_names(result)) for result in results)
        / len(results),
        4,
    )


def _domain_recall(results: list[CaseEvaluationResult]) -> float | None:
    eligible = [result for result in results if result.expected_domains]
    return _rate(
        [bool(set(result.expected_domains) <= set(result.retrieved_domains)) for result in eligible]
    )


def _capability_recall(results: list[CaseEvaluationResult]) -> float | None:
    eligible = [result for result in results if result.expected_capability_ids]
    return _rate(
        [
            bool(set(result.expected_capability_ids) <= set(result.retrieved_capability_ids))
            for result in eligible
        ]
    )


def _required_tool_recall(results: list[CaseEvaluationResult]) -> float | None:
    eligible = [result for result in results if result.required_tool_names]
    return _rate(
        [
            bool(set(result.required_tool_names) <= set(_retrieved_tool_names(result)))
            for result in eligible
        ]
    )


def _supported_to_unsupported_count(results: list[CaseEvaluationResult]) -> int:
    return sum(
        result.expected_supported and _routing_or_retrieval_unsupported(result)
        for result in results
    )


def _supported_to_unsupported_rate(
    results: list[CaseEvaluationResult],
) -> float | None:
    supported = [result for result in results if result.expected_supported]
    return _rate([_routing_or_retrieval_unsupported(result) for result in supported])


def _retrieved_tool_names(result: CaseEvaluationResult) -> tuple[str, ...]:
    if result.routing_status is not None:
        return result.shortlist_tool_names if result.routing_status == "routed" else ()
    return result.retrieval.tool_names if result.retrieval else ()


def _routing_or_retrieval_unsupported(result: CaseEvaluationResult) -> bool:
    if result.routing_status is not None:
        return result.routing_status == "unsupported"
    return bool(result.retrieval and result.retrieval.fallback_reason == "unsupported_capability")


def _retrieval_metric_summary(
    results: list[CaseEvaluationResult],
) -> dict[str, object]:
    return {
        "attempts": len(results),
        "domainRecallAtK": _domain_recall(results),
        "capabilityRecallAtK": _capability_recall(results),
        "requiredToolRecallAtK": _required_tool_recall(results),
        "supportedToUnsupportedRate": _supported_to_unsupported_rate(results),
        "averageShortlistSize": _average([len(result.shortlist_tool_names) for result in results]),
        "retrievalLatencyMs": _latency_summary([result.retrieval_latency_ms for result in results]),
    }


def _rate(values: list[bool]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def _fraction(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 4)


def _inverse_rate(value: float | None) -> float | None:
    return round(1.0 - value, 4) if value is not None else None


def _average(values: list[int]) -> float | None:
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def _optional_int_summary(values: list[int | None]) -> dict[str, float | int] | None:
    available = [value for value in values if value is not None]
    if not available:
        return None
    ordered = sorted(available)
    p50_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.5))
    p95_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.95))
    return {
        "samples": len(ordered),
        "average": round(sum(ordered) / len(ordered), 4),
        "p50": ordered[p50_index],
        "p95": ordered[p95_index],
    }


def _fallback_taxonomy(results: list[CaseEvaluationResult]) -> dict[str, int]:
    taxonomy: dict[str, int] = {}
    for result in results:
        reason = result.retrieval.fallback_reason if result.retrieval else None
        if result.routing_status == "needs_clarification":
            reason = "router_needs_clarification"
        elif result.routing_status == "unsupported":
            reason = "router_unsupported"
        if reason:
            taxonomy[reason] = taxonomy.get(reason, 0) + 1
    return dict(sorted(taxonomy.items()))


def _latency_summary(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    p50_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.5))
    p95_index = min(len(ordered) - 1, int((len(ordered) - 1) * 0.95))
    return {
        "average": round(sum(ordered) / len(ordered), 4),
        "p50": round(ordered[p50_index], 4),
        "p95": round(ordered[p95_index], 4),
    }


def _privacy_safe_expected(expected: EvaluationExpectation) -> dict[str, object]:
    output: dict[str, object] = {"status": expected.status}
    if expected.tool_name:
        output["toolName"] = expected.tool_name
    if expected.input_contains:
        output["inputFields"] = sorted(expected.input_contains)
    if expected.requires_confirmation is not None:
        output["requiresConfirmation"] = expected.requires_confirmation
    if expected.missing_fields:
        output["missingFields"] = list(expected.missing_fields)
    if expected.domain:
        output["domain"] = expected.domain
    if expected.capability_id:
        output["capabilityId"] = expected.capability_id
    if expected.domains:
        output["domains"] = list(expected.domains)
    if expected.capability_ids:
        output["capabilityIds"] = list(expected.capability_ids)
    if expected.required_tool_names:
        output["requiredToolNames"] = list(expected.required_tool_names)
    if expected.supported is not None:
        output["supported"] = expected.supported
    return output


def _privacy_safe_actual(actual: NormalizedPlannerDecision) -> dict[str, object]:
    summary = actual.output_summary
    output: dict[str, object] = {"status": actual.status}
    for key in ("toolName", "requiresConfirmation", "missingFields"):
        if key in summary:
            output[key] = summary[key]
    input_value = summary.get("input")
    if isinstance(input_value, dict) and input_value:
        output["inputFields"] = sorted(input_value)
    return output


def _retrieval_output(result: CaseEvaluationResult) -> dict[str, object] | None:
    retrieval = result.retrieval
    if retrieval is None and result.routing_status is None:
        return None
    retrieved_tool_names = _retrieved_tool_names(result)
    return {
        "shortlistToolNames": list(result.shortlist_tool_names),
        "shortlistSize": len(result.shortlist_tool_names),
        "expectedToolIncluded": (
            result.expected.tool_name in retrieved_tool_names if result.expected.tool_name else None
        ),
        "routingStatus": result.routing_status,
        "lowConfidence": (
            retrieval.low_confidence if retrieval else result.routing_confidence == "low"
        ),
        "candidateCount": (
            retrieval.candidate_count if retrieval else len(result.retrieved_capability_ids)
        ),
        "confidenceBucket": (
            retrieval.confidence_bucket if retrieval else result.routing_confidence
        ),
        "fallbackReason": (
            retrieval.fallback_reason
            if retrieval
            else (
                f"router_{result.routing_status}"
                if result.routing_status in {"needs_clarification", "unsupported"}
                else None
            )
        ),
        "unsupportedCapabilityId": retrieval.unsupported_capability_id if retrieval else None,
        "shortlistViolation": result.shortlist_violation,
        "retrievalLatencyMs": round(result.retrieval_latency_ms, 4),
        "plannerLatencyMs": round(result.planner_latency_ms, 4),
        "toolSchemaBytes": result.shortlist_schema_bytes,
        "estimatedToolSchemaTokens": (result.shortlist_schema_bytes + 3) // 4,
    }


def _privacy_safe_retrieval_event(
    result: CaseEvaluationResult,
) -> dict[str, object]:
    retrieval = result.retrieval
    if retrieval is None and result.routing_status is None:
        raise ValueError("Routing event requires a routing result")
    return {
        "eventVersion": "agent-tool-retrieval-observation:v1",
        "mode": "llm_router" if result.routing_status is not None else "shadow",
        "caseKind": _bounded_case_kind(result.kind),
        "catalogVersion": result.catalog_version,
        "catalogSha256": result.catalog_sha256,
        "modelVersion": result.model_version,
        "suiteVersion": result.suite_version,
        "retrieverVersion": result.retriever_version,
        "candidateCount": min(
            max(
                retrieval.candidate_count if retrieval else len(result.retrieved_capability_ids),
                0,
            ),
            100,
        ),
        "confidenceBucket": (
            retrieval.confidence_bucket if retrieval else result.routing_confidence
        ),
        "lowConfidence": (
            retrieval.low_confidence if retrieval else result.routing_confidence == "low"
        ),
        "fallbackReason": (
            retrieval.fallback_reason
            if retrieval
            else (
                f"router_{result.routing_status}"
                if result.routing_status in {"needs_clarification", "unsupported"}
                else None
            )
        ),
        "shortlistSize": min(max(len(result.shortlist_tool_names), 0), 100),
        "supportedToUnsupportedMisjudgment": bool(
            result.expected_supported and _routing_or_retrieval_unsupported(result)
        ),
        "latencyMs": {
            "retrieval": _bounded_latency(result.retrieval_latency_ms),
            "planner": _bounded_latency(result.planner_latency_ms),
        },
        "tokenUsage": {
            "estimatedToolSchemaTokens": min(
                max((result.shortlist_schema_bytes + 3) // 4, 0), 1_000_000
            ),
            "providerInputTokens": _bounded_optional_token_count(result.provider_input_tokens),
            "providerOutputTokens": _bounded_optional_token_count(result.provider_output_tokens),
            "providerTotalTokens": _bounded_optional_token_count(result.provider_total_tokens),
        },
    }


def _bounded_latency(value: float) -> float:
    return min(max(round(value, 4), 0.0), 600_000.0)


def _bounded_optional_token_count(value: int | None) -> int | None:
    return min(max(value, 0), 10_000_000) if value is not None else None


def _bounded_case_kind(value: str) -> str:
    return (
        value
        if value in {"canonical", "held_out", "counterexample", "multi_tool", "positive"}
        else "other"
    )


def _optional_kind(value: dict[object, object]) -> str:
    kind = value.get("kind", "positive")
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError("Evaluation case kind must be a string")
    return kind.strip()


def _failure_category_candidates(result: CaseEvaluationResult) -> list[str]:
    categories: list[str] = []
    expected = result.expected
    if result.runtime_failure is not None:
        categories.append("runtime_failure")
    if expected.status == "unsupported" and result.actual.status != "unsupported":
        categories.append("unsafe_candidate")
    if "tool" in result.failure_reasons:
        categories.append("wrong_tool")
    if "shortlist_tool" in result.failure_reasons:
        categories.append("shortlist_violation")
    if "planner_output" in result.failure_reasons:
        categories.append("planner_output_error")
    if "status" in result.failure_reasons:
        categories.append("wrong_status")
    if "input" in result.failure_reasons:
        input_keys = set(expected.input_contains)
        if input_keys & {"start", "end", "startDate", "endDate", "startTime", "endTime"}:
            categories.append("date_time_normalization")
        else:
            categories.append("required_input")
    if "missing_fields" in result.failure_reasons:
        categories.append("missing_field_handling")
    if "confirmation" in result.failure_reasons:
        categories.append("confirmation_policy")
    return categories


def _planner_output_failure(error: AgentPlannerOutputError) -> str:
    if "outside the shortlist" in str(error):
        return "tool_outside_shortlist"
    return "invalid_planner_output"


def _rejected_planner_decision() -> AgentPlannerDecision:
    return AgentPlannerDecision(
        status="unsupported",
        message="Evaluator rejected invalid planner output.",
        final_answer_draft="Evaluator rejected invalid planner output.",
        tool_name=None,
        tool_input={},
        requires_confirmation=False,
        missing_fields=(),
        unsupported_reason="invalid_planner_output",
    )


def _rejected_normalized_decision(reason: str) -> NormalizedPlannerDecision:
    message = "Evaluator rejected invalid planner output."
    return NormalizedPlannerDecision(
        status="unsupported",
        message=message,
        final_answer=message,
        output_summary={
            "status": "unsupported",
            "unsupportedReason": reason,
        },
        risk_level=None,
    )


def _classification(result: CaseEvaluationResult) -> str:
    if result.passed:
        return "exact"
    if (
        "status" in result.failure_reasons
        or "tool" in result.failure_reasons
        or "shortlist_tool" in result.failure_reasons
    ):
        return "misrecognized"
    return "partial"


def _require_string(value: dict[object, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Evaluation suite field is invalid: {key}")
    return item.strip()


def _string_tuple(value: dict[object, object], key: str) -> tuple[str, ...]:
    items = value.get(key)
    if (
        not isinstance(items, list)
        or not items
        or not all(isinstance(item, str) and item.strip() for item in items)
    ):
        raise ValueError(f"Evaluation suite field is invalid: {key}")
    normalized = tuple(item.strip() for item in items)
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"Evaluation suite field contains duplicates: {key}")
    return normalized


def _optional_string_tuple(value: dict[object, object], key: str) -> tuple[str, ...]:
    if key not in value:
        return ()
    return _string_tuple(value, key)
