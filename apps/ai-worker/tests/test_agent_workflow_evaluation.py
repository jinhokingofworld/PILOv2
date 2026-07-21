from __future__ import annotations

import json
from collections import Counter
from dataclasses import replace
from pathlib import Path

from app.agent_outcome_judge import OutcomeJudgeEvidence
from app.agent_planner_evaluation import load_evaluation_suite
from app.agent_processor import AgentPlannerDecision, AgentRoutingDecision
from app.agent_tool_retrieval import (
    CapabilityDefinition,
    ToolCapabilityCatalog,
    ToolCapabilityDescriptor,
)
from app.agent_workflow_evaluation import (
    OutcomeInputAssertion,
    WorkflowOutcomeAssertions,
    WorkflowScenario,
    WorkflowToolFixture,
    build_workflow_evaluation_report,
    evaluate_workflow_suite,
    load_workflow_catalog,
    load_workflow_scenarios,
)


class ScriptedPlanner:
    def __init__(self, decisions: list[AgentPlannerDecision]) -> None:
        self.decisions = decisions
        self.requests = []

    def plan(self, request):
        self.requests.append(request)
        return self.decisions.pop(0)


class ScriptedRouter:
    def __init__(self) -> None:
        self.requests = []

    def route(self, request):
        self.requests.append(request)
        return AgentRoutingDecision(
            status="routed",
            domains=("meeting", "calendar"),
            capability_ids=("meeting.reports.list", "calendar.events.list"),
            intent_summary="회의록과 일정을 순서대로 조회",
            confidence="high",
            clarification_question=None,
            unsupported_reason=None,
            provider_input_tokens=10,
            provider_output_tokens=5,
            provider_total_tokens=15,
        )


class StaticRouter:
    def __init__(self, decision: AgentRoutingDecision) -> None:
        self.decision = decision
        self.requests = []

    def route(self, request):
        self.requests.append(request)
        return self.decision


def test_workflow_uses_actual_tool_output_in_next_planning_context() -> None:
    planner = ScriptedPlanner(_successful_decisions())

    result = evaluate_workflow_suite(
        planner,
        ScriptedRouter(),
        _job(),
        (_scenario(),),
        current_date="2026-07-21",
    )[0]

    assert (
        'tool list_meeting_reports: {"reports":[{"title":"주간 회의록"}]}'
        in planner.requests[1].planning_context
    )
    assert result.task_success is True
    assert result.executed_tool_names == (
        "list_meeting_reports",
        "list_calendar_events",
    )


def test_workflow_rejects_wrong_tool_output_or_terminal_state() -> None:
    planner = ScriptedPlanner(_successful_decisions(final_answer="조회가 완료됐습니다."))
    scenario = replace(_scenario(), expected_answer_contains=("주간 회의록", "제품 회의"))

    result = evaluate_workflow_suite(
        planner,
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is False
    assert result.failure_reasons == ("final_answer_grounding",)


def test_workflow_hides_fixture_result_when_task_critical_input_is_wrong() -> None:
    scenario = replace(
        _scenario(),
        fixtures=(
            replace(
                _scenario().fixtures[0],
                outcome_input_assertions=(
                    OutcomeInputAssertion(path=("limit",), contains_all=("1",)),
                ),
            ),
            _scenario().fixtures[1],
        ),
        outcome_assertions=WorkflowOutcomeAssertions(
            response_evidence=(("주간", "회의록"), ("제품", "회의")),
            require_response=True,
        ),
    )
    mismatched_decisions = _successful_decisions()
    mismatched_decisions[0] = replace(mismatched_decisions[0], tool_input={"limit": 2})

    matched = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions()),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]
    mismatched = evaluate_workflow_suite(
        ScriptedPlanner(mismatched_decisions),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert matched.task_success is True
    assert "task_critical_input" in mismatched.failure_reasons


def test_workflow_uses_judge_verdict_for_task_outcome_success() -> None:
    class PassingJudge:
        def judge(self, _evidence: OutcomeJudgeEvidence) -> str:
            return (
                '{"taskFulfilled":true,"groundedInToolEvidence":true,'
                '"containsMaterialError":false,"verdict":"pass","failureCodes":[]}'
            )

    scenario = replace(
        _scenario(),
        outcome_assertions=WorkflowOutcomeAssertions(require_response=True),
    )

    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions()),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
        outcome_judge=PassingJudge(),
    )[0]

    assert result.task_success is True
    assert result.outcome_judge_verdict == "pass"


def test_workflow_separates_user_task_outcome_from_strict_execution_contract() -> None:
    scenario = replace(
        _scenario(),
        expected_answer_contains=("주간 회의록",),
        expected_planner_status="tool_candidate",
    )

    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions(final_answer="주간-회의록을 찾았습니다.")),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is True
    assert result.failure_reasons == ()
    assert result.execution_contract_passed is False
    assert result.execution_contract_failure_reasons == (
        "planner_status",
        "final_answer_grounding",
    )


def test_workflow_rejects_answer_that_negates_expected_evidence() -> None:
    scenario = replace(_scenario(), expected_answer_contains=("주간 회의록",))

    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions(final_answer="주간 회의록을 찾지 못했습니다.")),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is False
    assert result.failure_reasons == ("final_answer_grounding",)


def test_workflow_rejects_inverted_no_result_answer() -> None:
    scenario = replace(_scenario(), expected_answer_contains=("찾지 못",))

    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions(final_answer="관련 문서를 찾지 못한 것은 아닙니다.")),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is False
    assert result.failure_reasons == ("final_answer_grounding",)


def test_workflow_accepts_expected_unsupported_router_outcome_without_tool() -> None:
    router = StaticRouter(
        AgentRoutingDecision(
            status="unsupported",
            domains=(),
            capability_ids=(),
            intent_summary="일정 삭제 요청",
            confidence="high",
            clarification_question=None,
            unsupported_reason="calendar.events.delete",
            provider_total_tokens=15,
        )
    )
    scenario = WorkflowScenario(
        scenario_id="calendar_delete_unsupported",
        prompt="내일 일정을 삭제해줘",
        fixtures=(),
        evaluation_domains=("calendar",),
        expected_router_status="unsupported",
        expected_planner_status="unsupported",
    )

    result = evaluate_workflow_suite(
        ScriptedPlanner([]), router, _job(), (scenario,), current_date="2026-07-21"
    )[0]

    assert result.task_success is True
    assert result.executed_tool_names == ()


def test_workflow_accepts_confirmation_waiting_state_without_executing_tool() -> None:
    decision = AgentPlannerDecision(
        status="tool_candidate",
        message="일정 조회를 확인해주세요.",
        final_answer_draft="",
        tool_name="list_calendar_events",
        tool_input={"start": "2026-07-22", "end": "2026-07-22"},
        requires_confirmation=True,
        missing_fields=(),
        unsupported_reason=None,
        provider_total_tokens=20,
    )
    scenario = WorkflowScenario(
        scenario_id="calendar_confirmation",
        prompt="내일 일정을 확인해줘",
        fixtures=(
            WorkflowToolFixture(
                tool_name="list_calendar_events",
                input_contains={"start": "2026-07-22", "end": "2026-07-22"},
                output={},
                requires_confirmation=True,
            ),
        ),
        category="confirmation",
        expected_domains=("meeting", "calendar"),
        expected_capability_ids=("meeting.reports.list", "calendar.events.list"),
        evaluation_domains=("calendar",),
        expected_terminal_status="waiting_user_input",
        expected_planner_status="tool_candidate",
    )

    result = evaluate_workflow_suite(
        ScriptedPlanner([decision]),
        ScriptedRouter(),
        _confirmation_job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is True
    assert result.executed_tool_names == ("list_calendar_events",)
    assert build_workflow_evaluation_report((result,))["results"][0]["kind"] == "confirmation"


def test_workflow_rejects_unexpected_router_outcome() -> None:
    scenario = replace(_scenario(), expected_router_status="unsupported")

    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions()),
        ScriptedRouter(),
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )[0]

    assert result.task_success is False
    assert "router_status" in result.failure_reasons


def test_meeting_workflow_catalog_contains_real_tool_outputs() -> None:
    scenarios = load_workflow_scenarios(Path("evals/meeting_agent_capability_catalog_v1.json"))

    assert len(scenarios) == 6
    assert scenarios[0].fixtures[0].output
    assert scenarios[0].expected_answer_contains


def test_agent_workflow_catalog_covers_supported_domains_except_canvas() -> None:
    catalog = load_workflow_catalog(Path("evals/agent_workflow_catalog_v1.json"))

    represented_domains = {
        domain for scenario in catalog.scenarios for domain in scenario.evaluation_domains
    }
    product_domains = represented_domains - {"routing_boundary"}
    domain_counts = Counter(
        domain
        for scenario in catalog.scenarios
        for domain in scenario.evaluation_domains
        if domain != "routing_boundary"
    )

    assert catalog.version == "agent-workflow-regression:v3"
    assert product_domains == {
        "board",
        "calendar",
        "drive",
        "meeting",
        "pr_review",
        "sql_erd",
    }
    assert "routing_boundary" in represented_domains
    assert len(catalog.scenarios) >= 30
    assert min(domain_counts.values()) >= 5
    assert all("canvas" not in scenario.evaluation_domains for scenario in catalog.scenarios)
    assert all(
        fixture.tool_name != "delegate_canvas_agent"
        for scenario in catalog.scenarios
        for fixture in scenario.fixtures
    )


def test_agent_workflow_catalog_covers_required_task_categories() -> None:
    raw = json.loads(Path("evals/agent_workflow_catalog_v1.json").read_text(encoding="utf-8"))
    categories = {case["category"] for case in raw["workflowCases"]}

    assert {
        "single_tool",
        "multi_tool",
        "clarification",
        "unsupported",
        "confirmation",
        "grounded_answer",
    } <= categories


def test_every_workflow_case_declares_outcome_assertions() -> None:
    raw = json.loads(Path("evals/agent_workflow_catalog_v1.json").read_text(encoding="utf-8"))

    for case in raw["workflowCases"]:
        assert "outcome" in case, case["id"]
        assert "requireResponse" in case["outcome"], case["id"]


def test_agent_workflow_catalog_includes_terminal_tools_for_routed_capabilities() -> None:
    catalog = load_workflow_catalog(Path("evals/agent_workflow_catalog_v1.json"))
    snapshot = json.loads(
        Path("evals/tool_retrieval_quality_gate_v1.json").read_text(encoding="utf-8")
    )
    capabilities = {
        capability["id"]: capability
        for capability in snapshot["toolCapabilityCatalog"]["capabilities"]
    }

    for scenario in catalog.scenarios:
        if scenario.expected_planner_status not in {"completed", "tool_candidate"}:
            continue
        actual_tools = tuple(fixture.tool_name for fixture in scenario.fixtures)
        for capability_id in scenario.expected_capability_ids:
            expected_tools = tuple(capabilities[capability_id]["toolNames"])
            assert _is_subsequence(expected_tools, actual_tools), scenario.scenario_id


def test_workflow_passes_scenario_context_surface_to_router() -> None:
    router = ScriptedRouter()
    planner = ScriptedPlanner(_successful_decisions())
    scenario = replace(_scenario(), context_surface="workspace")

    evaluate_workflow_suite(
        planner,
        router,
        _job(),
        (scenario,),
        current_date="2026-07-21",
    )

    assert router.requests
    assert {request.context_surface for request in router.requests} == {"workspace"}
    assert {request.context_surface for request in planner.requests} == {"workspace"}


def test_workflow_report_contains_metrics_without_prompt_or_answer() -> None:
    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions()),
        ScriptedRouter(),
        _job(),
        (_scenario(),),
        current_date="2026-07-21",
    )

    report = build_workflow_evaluation_report(result)

    assert report["workflowEvaluation"]["taskSuccessRate"] == 1.0
    assert report["results"][0]["workflow"]["providerTotalTokens"] == 105
    assert "최근 회의록" not in str(report)
    assert "주간 회의록과 제품 회의" not in str(report)


def test_workflow_report_does_not_label_single_tool_task_as_multi_tool() -> None:
    result = evaluate_workflow_suite(
        ScriptedPlanner(_successful_decisions()),
        ScriptedRouter(),
        _job(),
        (_scenario(),),
        current_date="2026-07-21",
    )
    single_capability_result = (
        replace(
            result[0],
            expected_capability_ids=("sql_erd.generate",),
            expected_tool_count=1,
        ),
    )

    report = build_workflow_evaluation_report(single_capability_result)

    assert report["results"][0]["kind"] == "workflow"
    assert report["multiToolWorkflows"]["workflowCount"] == 0


def _successful_decisions(final_answer: str = "주간 회의록과 제품 회의를 찾았습니다."):
    return [
        AgentPlannerDecision(
            status="tool_candidate",
            message="회의록을 조회합니다.",
            final_answer_draft="",
            tool_name="list_meeting_reports",
            tool_input={"limit": 1},
            requires_confirmation=False,
            missing_fields=(),
            unsupported_reason=None,
            provider_total_tokens=20,
        ),
        AgentPlannerDecision(
            status="tool_candidate",
            message="일정을 조회합니다.",
            final_answer_draft="",
            tool_name="list_calendar_events",
            tool_input={"start": "2026-07-21", "end": "2026-07-21"},
            requires_confirmation=False,
            missing_fields=(),
            unsupported_reason=None,
            provider_total_tokens=20,
        ),
        AgentPlannerDecision(
            status="completed",
            message=final_answer,
            final_answer_draft=final_answer,
            tool_name=None,
            tool_input={},
            requires_confirmation=False,
            missing_fields=(),
            unsupported_reason=None,
            provider_total_tokens=20,
        ),
    ]


def _scenario() -> WorkflowScenario:
    return WorkflowScenario(
        scenario_id="meeting_reports_then_calendar",
        prompt="최근 회의록과 오늘 일정을 알려줘",
        fixtures=(
            WorkflowToolFixture(
                tool_name="list_meeting_reports",
                input_contains={"limit": 1},
                output={"reports": [{"title": "주간 회의록"}]},
            ),
            WorkflowToolFixture(
                tool_name="list_calendar_events",
                input_contains={"start": "2026-07-21", "end": "2026-07-21"},
                output={"events": [{"title": "제품 회의"}]},
            ),
        ),
        expected_answer_contains=("주간 회의록", "제품 회의"),
    )


def _job():
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))
    tools = tuple(
        tool
        for tool in suite.job.tools
        if tool.name in {"list_meeting_reports", "list_calendar_events"}
    )
    descriptors = tuple(
        ToolCapabilityDescriptor(
            tool_name=tool.name,
            domain="meeting" if tool.name == "list_meeting_reports" else "calendar",
            action="list",
            operation="read",
            capability_ids=(
                (
                    "meeting.reports.list"
                    if tool.name == "list_meeting_reports"
                    else "calendar.events.list"
                ),
            ),
            when_to_use="목록 조회",
            must_not_use_for=(),
            accepted_selector_fields=(),
            selector_kinds=(),
            prerequisite_tool_names=(),
            follow_up_tool_names=(),
            risk_level=tool.risk_level,
            execution_mode=tool.execution_mode,
            requires_confirmation=False,
            context_surface=None,
            input_schema_sha256="0" * 64,
        )
        for tool in tools
    )
    capabilities = (
        CapabilityDefinition(
            capability_id="meeting.reports.list",
            domain="meeting",
            tool_names=("list_meeting_reports",),
            when_to_use="회의록 목록 조회",
            must_not_use_for=(),
            positive_examples=(),
            examples=(),
            selector_kinds=(),
            requires_confirmation=False,
            availability="supported",
        ),
        CapabilityDefinition(
            capability_id="calendar.events.list",
            domain="calendar",
            tool_names=("list_calendar_events",),
            when_to_use="일정 목록 조회",
            must_not_use_for=(),
            positive_examples=(),
            examples=(),
            selector_kinds=(),
            requires_confirmation=False,
            availability="supported",
        ),
    )
    return replace(
        suite.job,
        tools=tools,
        tool_capability_catalog=ToolCapabilityCatalog(
            version="agent-tool-capability-catalog:v1",
            sha256="1" * 64,
            capabilities=capabilities,
            descriptors=descriptors,
        ),
    )


def _confirmation_job():
    job = _job()
    tools = tuple(
        (
            replace(tool, execution_mode="confirmation_required")
            if tool.name == "list_calendar_events"
            else tool
        )
        for tool in job.tools
    )
    catalog = job.tool_capability_catalog
    assert catalog is not None
    descriptors = tuple(
        (
            replace(
                descriptor,
                execution_mode="confirmation_required",
                requires_confirmation=True,
            )
            if descriptor.tool_name == "list_calendar_events"
            else descriptor
        )
        for descriptor in catalog.descriptors
    )
    return replace(
        job,
        tools=tools,
        tool_capability_catalog=replace(catalog, descriptors=descriptors),
    )


def _is_subsequence(expected: tuple[str, ...], actual: tuple[str, ...]) -> bool:
    iterator = iter(actual)
    return all(any(item == expected_item for item in iterator) for expected_item in expected)
