from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from app.agent_planner_evaluation import load_evaluation_suite
from app.agent_processor import AgentPlannerDecision, AgentRoutingDecision
from app.agent_tool_retrieval import (
    CapabilityDefinition,
    ToolCapabilityCatalog,
    ToolCapabilityDescriptor,
)
from app.agent_workflow_evaluation import (
    WorkflowScenario,
    WorkflowToolFixture,
    build_workflow_evaluation_report,
    evaluate_workflow_suite,
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


def test_meeting_workflow_catalog_contains_real_tool_outputs() -> None:
    scenarios = load_workflow_scenarios(
        Path("evals/meeting_agent_capability_catalog_v1.json")
    )

    assert len(scenarios) == 6
    assert scenarios[0].fixtures[0].output
    assert scenarios[0].expected_answer_contains


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
                "meeting.reports.list"
                if tool.name == "list_meeting_reports"
                else "calendar.events.list",
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
