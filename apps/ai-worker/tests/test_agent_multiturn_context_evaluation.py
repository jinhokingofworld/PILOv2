import json
from collections import Counter
from dataclasses import replace
from pathlib import Path

import pytest

from app.agent_multiturn_context_evaluation import (
    ExpectedContext,
    ExpectedOutcome,
    MultiTurnCatalog,
    MultiTurnConversation,
    MultiTurnEvaluationResult,
    MultiTurnEvaluationToolCall,
    MultiTurnToolFixture,
    MultiTurnTurn,
    build_multiturn_context_report,
    evaluate_deterministic_continuation,
    evaluate_multiturn_conversation,
    load_multiturn_catalog,
    validate_korean_multiturn_holdout_catalog,
    validate_multiturn_catalog_against_job,
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
                "expectedContext": {"referenceKind": "prior_context_ref", "constraints": {}},
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
                  "referenceKind": "prior_context_ref",
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
    for conversation in catalog.conversations:
        follow_up = conversation.turns[1]
        domain = conversation.conversation_id.split("_", maxsplit=1)[0]
        if domain == "meeting":
            if conversation.conversation_id == "meeting_07":
                assert follow_up.expected_context.reference_kind == "prior_result_selector"
                assert follow_up.expected_context.constraints == {"roomName": "Room A"}
            else:
                assert follow_up.expected_context.reference_kind == "prior_context_ref"
                assert follow_up.expected_context.context_ref is not None
                assert follow_up.expected_context.context_ref.startswith("ctx_")
                assert len(follow_up.expected_context.context_ref) == 28
        elif domain == "calendar":
            assert follow_up.expected_context.constraints.keys() == {"start", "end"}
        elif domain == "board":
            assert follow_up.expected_context.constraints.keys() == {"issueNumber"}
        elif domain == "drive":
            assert follow_up.expected_context.constraints.keys() == {"query"}
        elif domain == "sqltoerd":
            assert conversation.context_surface == "sql_erd"
            assert follow_up.expected_context.constraints.keys() == {"featureQuery"}
        else:
            assert conversation.context_surface == "pr_review"
            assert follow_up.expected_context.constraints.keys() == {"focus"}


def test_korean_dev_catalog_covers_all_non_canvas_domains_and_multi_turn_lengths() -> None:
    catalog_path = Path(__file__).parents[1] / "evals" / "agent_multiturn_context_ko_dev_v2.json"

    catalog = load_multiturn_catalog(catalog_path)

    assert catalog.language == "ko-KR"
    assert len(catalog.conversations) == 12
    assert Counter(item.domain for item in catalog.conversations) == {
        "meeting": 2,
        "calendar": 2,
        "board": 2,
        "drive": 2,
        "sqltoerd": 2,
        "pr_review": 2,
    }
    assert {len(item.turns) for item in catalog.conversations} == {2, 3}


def test_korean_holdout_contract_requires_two_cases_per_domain_and_family() -> None:
    setup_turn = MultiTurnTurn(
        user="문서를 찾아줘.",
        expected_tools=("search_workspace_documents",),
        expected_context=ExpectedContext("none", None, {}),
        fixtures=(MultiTurnToolFixture("search_workspace_documents", {"documents": ["문서"]}),),
        expected_outcome=ExpectedOutcome(True, ("문서",)),
    )
    follow_up_turn = MultiTurnTurn(
        user="그중 최근 것만 보여줘.",
        expected_tools=("search_workspace_documents",),
        expected_context=ExpectedContext(
            "prior_result_selector",
            None,
            {"query": "문서"},
            source_turn=0,
        ),
        fixtures=(
            MultiTurnToolFixture("search_workspace_documents", {"documents": ["최근 문서"]}),
        ),
        expected_outcome=ExpectedOutcome(True, ("최근 문서",)),
    )
    clarification_turn = MultiTurnTurn(
        user="그중 어느 문서인지 다시 물어봐 줘.",
        expected_tools=(),
        expected_context=ExpectedContext(
            "clarification",
            None,
            {},
            source_turn=0,
            required_clarification_fields=("document",),
        ),
        fixtures=(),
        expected_outcome=ExpectedOutcome(False, ()),
    )
    return_turn = MultiTurnTurn(
        user="다시 처음 문서 내용을 보여줘.",
        expected_tools=("search_workspace_documents",),
        expected_context=ExpectedContext(
            "prior_result_selector",
            None,
            {"query": "문서"},
            source_turn=0,
        ),
        fixtures=(MultiTurnToolFixture("search_workspace_documents", {"documents": ["문서"]}),),
        expected_outcome=ExpectedOutcome(True, ("문서",)),
    )
    domains = ("meeting", "calendar", "board", "drive", "sqltoerd", "pr_review")
    families = (
        "anaphora",
        "ellipsis",
        "constraint_accumulation",
        "correction",
        "topic_switch_return",
        "domain_collision",
        "clarification",
        "negation",
        "relative_date",
        "speech_variation",
    )
    surfaces = {"sqltoerd": "sql_erd", "pr_review": "pr_review"}
    conversations = tuple(
        MultiTurnConversation(
            conversation_id=f"{domain}_{family}_{index}",
            turns=(
                (setup_turn, clarification_turn)
                if family == "clarification"
                else (
                    (setup_turn, follow_up_turn, return_turn)
                    if family == "topic_switch_return"
                    else (setup_turn, follow_up_turn)
                )
            ),
            context_surface=surfaces.get(domain),
            domain=domain,
            scenario_family=family,
        )
        for domain in domains
        for family in families
        for index in range(2)
    )

    validate_korean_multiturn_holdout_catalog(
        MultiTurnCatalog(
            "agent-korean-multiturn-holdout:v2",
            conversations,
            "ko-KR",
        )
    )


def test_catalog_follow_up_constraints_use_registered_tool_fields() -> None:
    root = Path(__file__).parents[1]
    catalog = load_multiturn_catalog(root / "evals" / "agent_multiturn_context_v1.json")
    registry = json.loads(
        (root / "evals" / "tool_retrieval_quality_gate_v1.json").read_text(encoding="utf-8")
    )
    schemas = registry["eligibleToolSchemas"]

    for conversation in catalog.conversations:
        for turn in conversation.turns[1:]:
            for tool_name in turn.expected_tools:
                schema = schemas[tool_name]
                assert set(turn.expected_context.constraints).issubset(schema["properties"]), (
                    conversation.conversation_id,
                    tool_name,
                    turn.expected_context.constraints,
                )


def test_multiturn_report_emits_only_primary_rates_and_non_raw_diagnostics() -> None:
    report = build_multiturn_context_report(
        (
            MultiTurnEvaluationResult(
                "meeting_01",
                1,
                True,
                True,
                (),
                "pass",
                (),
                True,
                True,
                True,
                ("list_meeting_reports",),
                ("list_meeting_reports",),
            ),
            MultiTurnEvaluationResult(
                "drive_01",
                1,
                True,
                False,
                ("tool_sequence",),
                "inconclusive",
                ("judge_vote_split",),
                True,
                False,
                False,
                ("search_drive_files",),
                (),
            ),
        )
    )

    summary = report["multiTurnContextEvaluation"]
    assert summary["multiTurnContextResolutionRate"] == 0.5
    assert summary["multiTurnToolSelectionAccuracy"] == 0.5
    assert summary["inconclusiveRate"] == 0.5
    assert "conversationHistory" not in str(report)
    assert "toolInput" not in str(report)


def test_report_counts_missing_tool_as_tool_selection_failure() -> None:
    report = build_multiturn_context_report(
        (
            MultiTurnEvaluationResult(
                "drive_missing_tool",
                1,
                False,
                False,
                ("tool_sequence", "runtime_failure"),
                tool_selection_passed=False,
                expected_tool_sequence=("search_drive_files",),
                executed_tool_sequence=(),
            ),
        )
    )

    result = report["results"][0]
    assert report["multiTurnContextEvaluation"]["multiTurnToolSelectionAccuracy"] == 0.0
    assert result["toolSelectionPassed"] is False
    assert result["expectedToolSequence"] == ["search_drive_files"]
    assert result["executedToolSequence"] == []


def test_context_report_requires_a_passing_judge_verdict() -> None:
    report = build_multiturn_context_report(
        (
            MultiTurnEvaluationResult(
                "meeting_partial_judge",
                1,
                True,
                True,
                (),
                "partial",
                (),
                True,
                True,
                True,
                ("list_meeting_reports", "find_action_items"),
                ("list_meeting_reports", "find_action_items"),
            ),
        )
    )

    assert report["multiTurnContextEvaluation"]["multiTurnContextResolutionRate"] == 0.0


def test_missing_tool_call_is_not_a_tool_selection_success() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_missing_tool",
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
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show its action items.",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_context_ref", "ctx_111111111111111111111111", {}
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )

    result = evaluate_deterministic_continuation(conversation, ())

    assert result.tool_selection_passed is False
    assert result.executed_tool_sequence == ()


def test_tool_selection_fails_when_the_right_tools_are_called_in_the_wrong_turn() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_wrong_turn",
        turns=(
            MultiTurnTurn(
                user="Show the meeting report.",
                expected_tools=("list_meeting_reports",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(MultiTurnToolFixture("list_meeting_reports", {"reports": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show its action items.",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_context_ref", "ctx_111111111111111111111111", {}
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )

    result = evaluate_deterministic_continuation(
        conversation,
        (
            MultiTurnEvaluationToolCall(0, "list_meeting_reports", {}),
            MultiTurnEvaluationToolCall(0, "find_action_items", {}),
        ),
    )

    assert result.expected_tool_sequence == result.executed_tool_sequence
    assert result.tool_selection_passed is False


def test_preflight_rejects_a_selector_not_in_the_registered_tool_schema() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_invalid_selector",
        turns=(
            MultiTurnTurn(
                user="Show the meeting report.",
                expected_tools=("list_meeting_reports",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(MultiTurnToolFixture("list_meeting_reports", {"reports": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show its action items.",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_context_ref",
                    "ctx_111111111111111111111111",
                    {"unknownSelector": "value"},
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))

    with pytest.raises(ValueError, match="selector"):
        validate_multiturn_catalog_against_job((conversation,), suite.job)


def test_preflight_rejects_a_context_surface_without_a_registry_catalog() -> None:
    conversation = MultiTurnConversation(
        conversation_id="sqltoerd_missing_context_surface",
        context_surface="sql_erd",
        turns=(
            MultiTurnTurn(
                user="Create an ERD.",
                expected_tools=("generate_sql_erd",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(MultiTurnToolFixture("generate_sql_erd", {"tables": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show the payment tables.",
                expected_tools=("focus_sql_erd_tables",),
                expected_context=ExpectedContext(
                    "prior_result_selector", "sql_erd_1", {"featureQuery": "payment"}
                ),
                fixtures=(MultiTurnToolFixture("focus_sql_erd_tables", {"tables": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))

    with pytest.raises(ValueError, match="context surface"):
        validate_multiturn_catalog_against_job((conversation,), suite.job)


def test_preflight_rejects_a_prior_context_reference_missing_from_fixture() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_missing_fixture_context",
        turns=(
            MultiTurnTurn(
                user="Show the meeting report.",
                expected_tools=("list_meeting_reports",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(MultiTurnToolFixture("list_meeting_reports", {"reports": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show its action items.",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_context_ref",
                    "ctx_111111111111111111111111",
                    {"contextRef": "ctx_111111111111111111111111"},
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
                expected_outcome=ExpectedOutcome(True, ()),
            ),
        ),
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))

    with pytest.raises(ValueError, match="context reference"):
        validate_multiturn_catalog_against_job((conversation,), suite.job)


def test_preflight_rejects_a_final_expected_fact_missing_from_fixture() -> None:
    conversation = MultiTurnConversation(
        conversation_id="meeting_missing_fixture_fact",
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
                expected_outcome=ExpectedOutcome(True, ()),
            ),
            MultiTurnTurn(
                user="Show its action items.",
                expected_tools=("find_action_items",),
                expected_context=ExpectedContext(
                    "prior_context_ref", "ctx_111111111111111111111111", {}
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
                expected_outcome=ExpectedOutcome(True, ("unavailable expected fact",)),
            ),
        ),
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))

    with pytest.raises(ValueError, match="expected fact"):
        validate_multiturn_catalog_against_job((conversation,), suite.job)


def test_preflight_accepts_a_selector_embedded_in_a_fixture_timestamp() -> None:
    catalog = load_multiturn_catalog(Path("evals/agent_multiturn_context_v1.json"))
    calendar_conversation = next(
        conversation
        for conversation in catalog.conversations
        if conversation.conversation_id == "calendar_01"
    )
    suite = load_evaluation_suite(Path("evals/agent_planner_korean_v1.json"))

    validate_multiturn_catalog_against_job((calendar_conversation,), suite.job)


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
                    "prior_context_ref", "report-16", {"contextRef": "report-16"}
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
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


def test_continuation_accepts_schema_valid_selector_derived_from_prior_result() -> None:
    conversation = MultiTurnConversation(
        conversation_id="board_context_selector",
        turns=(
            MultiTurnTurn(
                user="Find the login issue.",
                expected_tools=("search_board_issues",),
                expected_context=ExpectedContext("none", None, {}),
                fixtures=(
                    MultiTurnToolFixture(
                        "search_board_issues",
                        {"issues": [{"issueNumber": "#1001", "title": "login issue"}]},
                    ),
                ),
                expected_outcome=ExpectedOutcome(True, ("login issue",)),
            ),
            MultiTurnTurn(
                user="Show its details.",
                expected_tools=("get_board_issue_context",),
                expected_context=ExpectedContext(
                    "prior_result_selector", "board_1", {"issueNumber": "#1001"}
                ),
                fixtures=(
                    MultiTurnToolFixture("get_board_issue_context", {"title": "login issue"}),
                ),
                expected_outcome=ExpectedOutcome(True, ("login issue",)),
            ),
        ),
    )

    result = evaluate_deterministic_continuation(
        conversation,
        (
            MultiTurnEvaluationToolCall(0, "search_board_issues", {"query": "login"}),
            MultiTurnEvaluationToolCall(1, "get_board_issue_context", {"issueNumber": "#1001"}),
        ),
    )

    assert result.deterministic_context_passed
    assert result.deterministic_continuation_passed


def test_replay_preserves_prior_tool_result_across_user_turns() -> None:
    class ScriptedPlanner:
        def __init__(self) -> None:
            self.requests = []
            self.decisions = [
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
                    "prior_context_ref",
                    "ctx_111111111111111111111111",
                    {"contextRef": "ctx_111111111111111111111111"},
                ),
                fixtures=(MultiTurnToolFixture("find_action_items", {"items": []}),),
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
    assert len(planner.requests) == 2
    assert "tool list_meeting_reports:" in planner.requests[0].planning_context
    assert "assistant: ctx_111111111111111111111111" in planner.requests[0].planning_context
    assert "user: Does it contain action items?" in planner.requests[0].planning_context


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
