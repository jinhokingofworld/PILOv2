from datetime import date

from app.agent_processor import (
    AgentPlannerDecision,
    AgentRoutingDecision,
    AgentRunJob,
    AgentToolSchema,
)
from app.agent_tool_retrieval import (
    CapabilityDefinition,
    CapabilityExample,
    ToolCapabilityCatalog,
    ToolCapabilityDescriptor,
    compute_input_schema_sha256,
    compute_tool_capability_catalog_sha,
)
from evaluation_harness.single_tool_selection_catalog import SingleToolSelectionCase
from evaluation_harness.single_tool_selection_runtime import (
    evaluate_single_tool_selection_case,
)


class FakeRouter:
    def __init__(self) -> None:
        self.requests = []

    def route(self, request):
        self.requests.append(request)
        return AgentRoutingDecision(
            status="routed",
            domains=("calendar",),
            capability_ids=("calendar.events.list",),
            intent_summary="calendar lookup",
            confidence="high",
            clarification_question=None,
            unsupported_reason=None,
        )


class FakePlanner:
    def __init__(self, decision: AgentPlannerDecision) -> None:
        self.decision = decision
        self.requests = []

    def plan(self, request):
        self.requests.append(request)
        return self.decision


def _decision(**overrides: object) -> AgentPlannerDecision:
    values: dict[str, object] = {
        "status": "tool_candidate",
        "message": "calendar lookup ready",
        "final_answer_draft": "",
        "tool_name": "list_calendar_events",
        "tool_input": {"start": "2026-07-21", "end": "2026-07-21"},
        "requires_confirmation": False,
        "missing_fields": (),
        "unsupported_reason": None,
    }
    values.update(overrides)
    return AgentPlannerDecision(**values)


def _job() -> AgentRunJob:
    tool = AgentToolSchema(
        name="list_calendar_events",
        description="List calendar events.",
        risk_level="low",
        execution_mode="auto",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
    )
    capability = CapabilityDefinition(
        capability_id="calendar.events.list",
        domain="calendar",
        tool_names=(tool.name,),
        when_to_use="list calendar events",
        must_not_use_for=(),
        positive_examples=("show calendar",),
        examples=(CapabilityExample(kind="canonical", utterance="show calendar"),),
        selector_kinds=("date_range",),
        requires_confirmation=False,
        availability="supported",
    )
    descriptor = ToolCapabilityDescriptor(
        tool_name=tool.name,
        domain="calendar",
        action=tool.name,
        operation="read",
        capability_ids=(capability.capability_id,),
        when_to_use=capability.when_to_use,
        must_not_use_for=(),
        accepted_selector_fields=(),
        selector_kinds=("date_range",),
        prerequisite_tool_names=(),
        follow_up_tool_names=(),
        risk_level="low",
        execution_mode="auto",
        requires_confirmation=False,
        context_surface=None,
        input_schema_sha256=compute_input_schema_sha256(tool.input_schema),
    )
    raw_capability = {
        "id": capability.capability_id,
        "domain": capability.domain,
        "toolNames": list(capability.tool_names),
        "whenToUse": capability.when_to_use,
        "mustNotUseFor": [],
        "positiveExamples": list(capability.positive_examples),
        "examples": [{"kind": "canonical", "utterance": "show calendar"}],
        "selectorKinds": list(capability.selector_kinds),
        "requiresConfirmation": False,
        "availability": "supported",
    }
    raw_descriptor = {
        "toolName": descriptor.tool_name,
        "domain": descriptor.domain,
        "action": descriptor.action,
        "operation": descriptor.operation,
        "capabilityIds": list(descriptor.capability_ids),
        "whenToUse": descriptor.when_to_use,
        "mustNotUseFor": [],
        "acceptedSelectorFields": [],
        "selectorKinds": list(descriptor.selector_kinds),
        "prerequisiteToolNames": [],
        "followUpToolNames": [],
        "riskLevel": descriptor.risk_level,
        "executionMode": descriptor.execution_mode,
        "requiresConfirmation": False,
        "contextSurface": None,
        "inputSchemaSha256": descriptor.input_schema_sha256,
    }
    catalog = ToolCapabilityCatalog(
        version="agent-tool-capabilities:v2",
        sha256=compute_tool_capability_catalog_sha(
            "agent-tool-capabilities:v2", [raw_capability], [raw_descriptor]
        ),
        capabilities=(capability,),
        descriptors=(descriptor,),
    )
    return AgentRunJob(
        run_id="00000000-0000-4000-8000-000000000001",
        workspace_id="00000000-0000-4000-8000-000000000002",
        requested_by_user_id="00000000-0000-4000-8000-000000000003",
        tool_schema_version="agent-tools:v8",
        turn_sequence=1,
        tools=(tool,),
        tool_capability_catalog=catalog,
    )


def _case() -> SingleToolSelectionCase:
    return SingleToolSelectionCase(
        case_id="calendar_01",
        domain="calendar",
        prompt="오늘 일정을 보여줘",
        expected_tool_name="list_calendar_events",
        context_surface=None,
    )


def test_records_the_first_production_tool_candidate_without_executing_it() -> None:
    router = FakeRouter()
    planner = FakePlanner(_decision())

    result = evaluate_single_tool_selection_case(
        planner,
        router,
        _job(),
        _case(),
        current_date="2026-07-21",
        timezone="Asia/Seoul",
    )

    assert result.passed is True
    assert result.selected_tool_name == "list_calendar_events"
    assert result.execution_handoff_count == 1
    assert planner.requests[0].prompt == "오늘 일정을 보여줘"
    assert planner.requests[0].planning_context == ""
    assert router.requests[0].planning_context == ""


def test_fails_when_the_first_tool_does_not_match_the_case_contract() -> None:
    expected_other_tool = SingleToolSelectionCase(
        case_id="calendar_02",
        domain="calendar",
        prompt="오늘 일정을 보여줘",
        expected_tool_name="create_calendar_event",
        context_surface=None,
    )

    result = evaluate_single_tool_selection_case(
        FakePlanner(_decision()),
        FakeRouter(),
        _job(),
        expected_other_tool,
        current_date="2026-07-21",
        timezone="Asia/Seoul",
    )

    assert result.passed is False
    assert result.failure_code == "wrong_tool"
    assert result.execution_handoff_count == 1


def test_fails_when_the_planner_asks_for_clarification_without_a_tool() -> None:
    clarification = _decision(
        status="needs_clarification",
        tool_name=None,
        tool_input={},
        missing_fields=("date",),
    )

    result = evaluate_single_tool_selection_case(
        FakePlanner(clarification),
        FakeRouter(),
        _job(),
        _case(),
        current_date="2026-07-21",
        timezone="Asia/Seoul",
    )

    assert result.passed is False
    assert result.failure_code == "no_tool"
    assert result.execution_handoff_count == 0
