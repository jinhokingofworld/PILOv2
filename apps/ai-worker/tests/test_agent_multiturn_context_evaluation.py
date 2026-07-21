from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest

from app.agent_multiturn_context_evaluation import (
    ExpectedContext,
    ExpectedOutcome,
    MultiTurnConversation,
    MultiTurnEvaluationToolCall,
    MultiTurnToolFixture,
    MultiTurnTurn,
    evaluate_deterministic_continuation,
    evaluate_multiturn_conversation,
    load_multiturn_catalog,
)
from app.agent_outcome_judge import MultiTurnJudgeEvidence
from app.agent_planner_evaluation import load_evaluation_suite
from app.agent_processor import AgentPlannerDecision, AgentRoutingDecision
from app.agent_tool_retrieval import (
    CapabilityDefinition,
    ToolCapabilityCatalog,
    ToolCapabilityDescriptor,
)


def test_catalog_requires_context_reference_for_follow_up_turn(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        """
        {
          "version": "agent-multiturn-context:v1",
          "conversations": [{
            "id": "meeting_follow_up",
            "turns": [
              {
                "user": "Show the meeting report.",
                "expectedTools": ["list_meeting_reports"],
                "expectedContext": {"referenceKind": "none", "constraints": {}},
                "fixtures": [{"tool": "list_meeting_reports", "output": {"reports": []}}],
                "expectedOutcome": {"deliveryRequired": true, "expectedFacts": []}
              },
              {
                "user": "Does it contain action items?",
                "expectedTools": ["find_action_items"],
                "expectedContext": {"referenceKind": "prior_tool_result", "constraints": {}},
                "fixtures": [{"tool": "find_action_items", "output": {"items": []}}],
                "expectedOutcome": {"deliveryRequired": true, "expectedFacts": []}
              }
            ]
          }]
        }
        """,
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="contextRef"):
        load_multiturn_catalog(catalog_path)


def test_catalog_loads_immutable_fixture_outputs_for_a_follow_up_turn(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(
        """
        {
          "version": "agent-multiturn-context:v1",
          "conversations": [{
            "id": "meeting_follow_up",
            "turns": [
              {
                "user": "Show the July 16 meeting report.",
                "expectedTools": ["list_meeting_reports"],
                "expectedContext": {
                  "referenceKind": "none",
                  "constraints": {}
                },
                "fixtures": [{
                  "tool": "list_meeting_reports",
                  "output": {"reports": [{"id": "report-16"}]}
                }],
                "expectedOutcome": {
                  "deliveryRequired": true,
                  "expectedFacts": ["report-16"]
                }
              },
              {
                "user": "Does it contain follow-up actions?",
                "expectedTools": ["find_action_items"],
                "expectedContext": {
                  "referenceKind": "prior_tool_result",
                  "contextRef": "report-16",
                  "constraints": {"meetingReportId": "report-16"}
                },
                "fixtures": [{
                  "tool": "find_action_items",
                  "output": {"items": [{"title": "Write the proposal"}]}
                }],
                "expectedOutcome": {
                  "deliveryRequired": true,
                  "expectedFacts": ["Write the proposal"]
                }
              }
            ]
          }]
        }
        """,
        encoding="utf-8",
    )

    catalog = load_multiturn_catalog(catalog_path)

    first_fixture = catalog.conversations[0].turns[0].fixtures[0]
    assert first_fixture.output["reports"][0]["id"] == "report-16"
    with pytest.raises(TypeError):
        first_fixture.output["reports"] = ()


def test_frozen_catalog_covers_twelve_conversations_per_non_canvas_domain() -> None:
    catalog_path = Path(__file__).parents[1] / "evals" / "agent_multiturn_context_v1.json"

    catalog = load_multiturn_catalog(catalog_path)

    assert len(catalog.conversations) == 72
    domains = Counter(
        conversation.conversation_id.split("_", maxsplit=1)[0]
        for conversation in catalog.conversations
    )
    assert domains == {
        "meeting": 12,
        "calendar": 12,
        "board": 12,
        "drive": 12,
        "sqltoerd": 12,
        "prreview": 12,
    }


def test_continuation_fails_when_right_tool_uses_context_from_a_different_turn() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_context_reference",
        turns=(
            MultiTurnTurn(
                user="Show the meeting report.",
                expected_tools=("list_meeting_reports",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(
                    MultiTurnToolFixture("list_meeting_reports", {"contextRef": "report-16"}),
                ),
                expected_outcome=ExpectedOutcome(True, ("report-16",)),
            ),
            MultiTurnTurn(
                user="Does it contain action items?",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_tool_result", "report-16", {"contextRef": "report-16"}
                ),
                fixtures=(
                    MultiTurnToolFixture("find_action_items", {"items": []}),
                ),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )

    result = evaluate_deterministic_continuation(
        conversation,
        (
            MultiTurnEvaluationToolCall(0, "list_meeting_reports", {}),
            MultiTurnEvaluationToolCall(1, "find_action_items", {"contextRef": "other-report"}),
        ),
    )

    assert not result.deterministic_context_passed
    assert not result.deterministic_continuation_passed
    assert result.failure_reasons == ("context_reference",)


def test_replay_preserves_prior_tool_result_across_user_turns() -> None:
    class ScriptedPlanner:
        def __init__(self) -> None:
            self.requests = []
            self.decisions = [
                _planner_decision("list_meeting_reports", {"limit": 1}),
                _completed_decision(),
                _planner_decision(
                    "find_action_items",
                    {
                        "assigneeSelf": True,
                        "contextRef": "ctx_111111111111111111111111",
                    },
                ),
                _completed_decision(),
            ]

        def plan(self, request):
            self.requests.append(request)
            return self.decisions.pop(0)

    conversation = MultiTurnConversation(
        conversation_id="meeting_replay",
        turns=(
            MultiTurnTurn(
                user="Show the meeting report.",
                expected_tools=("list_meeting_reports",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(
                    MultiTurnToolFixture(
                        "list_meeting_reports",
                        {"contextRef": "ctx_111111111111111111111111"},
                    ),
                ),
                expected_outcome=ExpectedOutcome(True, ("ctx_111111111111111111111111",)),
            ),
            MultiTurnTurn(
                user="Does it contain action items?",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_tool_result",
                    "ctx_111111111111111111111111",
                    {"contextRef": "ctx_111111111111111111111111"},
                ),
                fixtures=(
                    MultiTurnToolFixture("find_action_items", {"items": []}),
                ),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))
    tools = tuple(
        tool
        for tool in suite.job.tools
        if tool.name in {"list_meeting_reports", "find_action_items"}
    )
    capability_ids = {
        "list_meeting_reports": "meeting.reports.list",
        "find_action_items": "meeting.action_items.list",
    }
    job = replace(
        suite.job,
        tools=tools,
        tool_capability_catalog=ToolCapabilityCatalog(
            version="agent-tool-capability-catalog:v1",
            sha256="1" * 64,
            capabilities=tuple(
                CapabilityDefinition(
                    capability_id=capability_ids[tool.name],
                    domain="meeting",
                    tool_names=(tool.name,),
                    when_to_use="Meeting follow-up",
                    must_not_use_for=(),
                    positive_examples=(),
                    examples=(),
                    selector_kinds=(),
                    requires_confirmation=False,
                    availability="supported",
                )
                for tool in tools
            ),
            descriptors=tuple(
                ToolCapabilityDescriptor(
                    tool_name=tool.name,
                    domain="meeting",
                    action="list",
                    operation="read",
                    capability_ids=(capability_ids[tool.name],),
                    when_to_use="Meeting follow-up",
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
            ),
        ),
    )
    planner = ScriptedPlanner()

    class MeetingRouter:
        def route(self, request):
            capability_id = (
                "meeting.action_items.list"
                if request.prompt == "Does it contain action items?"
                else "meeting.reports.list"
            )
            return AgentRoutingDecision(
                status="routed",
                domains=("meeting",),
                capability_ids=(capability_id,),
                intent_summary="meeting follow-up",
                confidence="high",
                clarification_question=None,
                unsupported_reason=None,
            )

    result = evaluate_multiturn_conversation(
        planner,
        job,
        conversation,
        current_date="2026-07-21",
        router=MeetingRouter(),
        judge=PassingJudge(),
    )

    assert result.deterministic_continuation_passed
    assert result.judge_verdict == "pass"
    assert "tool list_meeting_reports:" in planner.requests[2].planning_context
    assert "user: Does it contain action items?" in planner.requests[2].planning_context


class PassingJudge:
    def judge(self, _evidence: MultiTurnJudgeEvidence) -> str:
        return (
            '{"contextResolved":true,"followUpDelivered":true,'
            '"containsMaterialError":false,"verdict":"pass","failureCodes":[]}'
        )


def _planner_decision(tool_name: str, tool_input: dict[str, object]) -> AgentPlannerDecision:
    return AgentPlannerDecision(
        status="tool_candidate",
        message="Use the selected tool.",
        final_answer_draft="",
        tool_name=tool_name,
        tool_input=tool_input,
        requires_confirmation=False,
        missing_fields=(),
        unsupported_reason=None,
    )


def _completed_decision() -> AgentPlannerDecision:
    return AgentPlannerDecision(
        status="completed",
        message="Done.",
        final_answer_draft="Done.",
        tool_name=None,
        tool_input={},
        requires_confirmation=False,
        missing_fields=(),
        unsupported_reason=None,
    )
