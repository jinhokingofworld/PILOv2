import hashlib
import json
from pathlib import Path

from app.agent_planner_evaluation import (
    build_evaluation_input_hashes,
    build_evaluation_report,
    evaluate_suite,
    load_evaluation_suite,
)
from app.agent_processor import AgentPlannerDecision


class FakePlanner:
    def __init__(self, decisions):
        self.decisions = iter(decisions)
        self.requests = []

    def plan(self, request):
        self.requests.append(request)
        return next(self.decisions)


def test_evaluation_input_hashes_include_meeting_catalog_when_provided(tmp_path) -> None:
    suite_path = tmp_path / "suite.json"
    catalog_path = tmp_path / "meeting-catalog.json"
    suite_path.write_bytes(b'{"version":"suite:v1"}')
    catalog_path.write_bytes(b'{"version":"meeting:v1"}')

    hashes = build_evaluation_input_hashes(suite_path, catalog_path)

    assert hashes == {
        "suiteSha256": hashlib.sha256(suite_path.read_bytes()).hexdigest(),
        "meetingCatalogSha256": hashlib.sha256(catalog_path.read_bytes()).hexdigest(),
    }


def decision(**overrides):
    values = {
        "status": "tool_candidate",
        "message": "일정 조회 후보입니다.",
        "final_answer_draft": "일정을 조회합니다.",
        "tool_name": "list_calendar_events",
        "tool_input": {"start": "2026-07-11", "end": "2026-07-11"},
        "requires_confirmation": False,
        "missing_fields": (),
        "unsupported_reason": None,
        **overrides,
    }
    return AgentPlannerDecision(**values)


def write_suite(tmp_path, cases):
    path = tmp_path / "suite.json"
    path.write_text(
        json.dumps(
            {
                "version": "test:v1",
                "toolSchemaVersion": "agent-tools:v1",
                "tools": [
                    {
                        "name": "list_calendar_events",
                        "description": "일정을 조회합니다.",
                        "riskLevel": "low",
                        "executionMode": "auto",
                        "inputSchema": {
                            "type": "object",
                            "required": ["start", "end"],
                        },
                    }
                ],
                "cases": cases,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_evaluate_suite_scores_normalized_planner_output(tmp_path) -> None:
    suite = load_evaluation_suite(
        write_suite(
            tmp_path,
            [
                {
                    "id": "today",
                    "prompt": "오늘 일정 보여줘",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                        "inputContains": {"start": "2026-07-11"},
                        "requiresConfirmation": False,
                    },
                },
                {
                    "id": "unsupported",
                    "prompt": "PR 리뷰해줘",
                    "expected": {"status": "unsupported"},
                },
            ],
        )
    )
    planner = FakePlanner(
        [
            decision(),
            decision(status="unsupported", tool_name=None, tool_input={}),
        ]
    )

    results = evaluate_suite(planner, suite, current_date="2026-07-11")
    report = build_evaluation_report(results)

    assert [result.passed for result in results] == [True, True]
    assert planner.requests[0].current_date == "2026-07-11"
    assert report["passedCases"] == 2
    assert report["totalAttempts"] == 2
    assert report["toolSelectionAccuracy"] == 1.0
    assert report["requiredInputAccuracy"] == 1.0
    assert report["results"][0]["classification"] == "exact"


def test_evaluate_suite_reports_input_and_confirmation_mismatches(tmp_path) -> None:
    suite = load_evaluation_suite(
        write_suite(
            tmp_path,
            [
                {
                    "id": "mismatch",
                    "prompt": "일정 생성",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                        "inputContains": {"start": "2026-07-12"},
                        "requiresConfirmation": True,
                    },
                }
            ],
        )
    )

    result = evaluate_suite(FakePlanner([decision()]), suite, current_date="2026-07-11")[0]

    assert result.passed is False
    assert result.failure_reasons == ("confirmation", "input")
    assert build_evaluation_report((result,))["results"][0]["classification"] == "partial"


def test_evaluate_suite_repetitions_reports_flaky_cases(tmp_path) -> None:
    suite = load_evaluation_suite(
        write_suite(
            tmp_path,
            [
                {
                    "id": "repeat",
                    "prompt": "오늘 일정 보여줘",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                    },
                }
            ],
        )
    )
    results = evaluate_suite(
        FakePlanner(
            [
                decision(),
                decision(status="unsupported", tool_name=None, tool_input={}),
            ]
        ),
        suite,
        current_date="2026-07-08",
        repetitions=2,
    )
    report = build_evaluation_report(results)

    assert [result.attempt for result in results] == [1, 2]
    assert report["totalCases"] == 1
    assert report["totalAttempts"] == 2
    assert report["passedCases"] == 0
    assert report["flakyCaseIds"] == ["repeat"]
    assert report["caseSummaries"][0]["exactRate"] == 0.5


def test_evaluate_suite_applies_relative_date_guard(tmp_path) -> None:
    suite = load_evaluation_suite(
        write_suite(
            tmp_path,
            [
                {
                    "id": "this_weekend",
                    "prompt": "이번 주말 일정 보여줘",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                        "inputContains": {"start": "2026-07-18", "end": "2026-07-19"},
                        "requiresConfirmation": False,
                    },
                },
                {
                    "id": "next_monday",
                    "prompt": "다음 주 월요일 오전 일정 보여줘",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                        "inputContains": {"start": "2026-07-13", "end": "2026-07-13"},
                        "requiresConfirmation": False,
                    },
                },
            ],
        )
    )
    planner = FakePlanner(
        [
            decision(
                status="needs_clarification",
                tool_name=None,
                tool_input={},
                missing_fields=("start", "end"),
            ),
            decision(tool_input={"start": "2026-07-20", "end": "2026-07-20"}),
        ]
    )

    results = evaluate_suite(planner, suite, current_date="2026-07-12")

    assert [result.passed for result in results] == [True, True]


def test_load_evaluation_suite_rejects_duplicate_case_ids(tmp_path) -> None:
    path = write_suite(
        tmp_path,
        [
            {"id": "same", "prompt": "하나", "expected": {"status": "unsupported"}},
            {"id": "same", "prompt": "둘", "expected": {"status": "unsupported"}},
        ],
    )

    try:
        load_evaluation_suite(path)
    except ValueError as error:
        assert "duplicate" in str(error)
    else:
        raise AssertionError("duplicate case IDs must be rejected")


def test_fixed_korean_suite_loads() -> None:
    suite_path = Path(__file__).parents[1] / "evals" / "agent_planner_korean_v1.json"

    suite = load_evaluation_suite(suite_path)

    assert suite.version == "agent-planner-korean:v1"
    assert len(suite.cases) == 50
    assert {tool.name for tool in suite.job.tools} == {
        "list_calendar_events",
        "create_calendar_event",
        "update_calendar_event",
        "start_meeting_in_room",
        "join_meeting",
        "leave_meeting",
        "start_meeting_recording",
        "end_meeting_recording",
        "list_meeting_rooms",
        "get_active_meeting",
        "get_meeting_participants",
        "list_meeting_reports",
        "get_meeting_report",
        "summarize_meeting_report",
        "search_meeting_transcript",
        "find_action_items",
        "get_meeting_decision_evidence",
        "update_meeting_report_action_item",
        "dismiss_meeting_report_action_item",
        "approve_meeting_report_action_item",
        "regenerate_meeting_report",
        "search_board_issues",
        "move_board_issue_status",
        "get_board_issue_context",
        "create_board_issue",
        "resolve_board_context",
        "get_board_briefing",
        "assign_board_issue_safely",
        "diagnose_board_freshness",
        "generate_sql_erd",
        "inspect_sql_erd_schema",
        "focus_sql_erd_tables",
        "search_workspace_documents",
    }
    expectations = {case.case_id: case.expectation for case in suite.cases}
    assert expectations["calendar_today"].input_contains == {
        "start": "2026-07-08",
        "end": "2026-07-08",
    }
    assert expectations["calendar_next_monday"].input_contains == {
        "start": "2026-07-13",
        "end": "2026-07-13",
    }
    assert expectations["calendar_this_weekend"].input_contains == {
        "start": "2026-07-11",
        "end": "2026-07-12",
    }
    assert expectations["calendar_week_after_next_tuesday"].input_contains == {
        "start": "2026-07-21",
        "end": "2026-07-21",
    }
    assert expectations["calendar_this_sunday"].input_contains == {
        "start": "2026-07-12",
        "end": "2026-07-12",
    }
    assert expectations["calendar_create_multi_day"].missing_fields == (
        "calendar_event_time_or_all_day",
    )
    assert expectations["calendar_create_recurrence"].status == "unsupported"
    assert expectations["meeting_rooms"].tool_name == "list_meeting_rooms"
    assert expectations["meeting_active"].tool_name == "get_active_meeting"
    assert expectations["meeting_participants"].input_contains == {
        "meetingId": "123e4567-e89b-12d3-a456-426614174000",
    }
    assert expectations["meeting_recording_missing_id"].missing_fields == ("meetingId",)
    assert expectations["sql_erd_generate"].tool_name == "generate_sql_erd"
    assert expectations["sql_erd_generate"].requires_confirmation is None
    assert expectations["sql_erd_focus_payment_tables"].tool_name == "inspect_sql_erd_schema"
    assert expectations["sql_erd_focus_payment_tables"].requires_confirmation is None
    assert expectations["sql_erd_focus_payment_tables"].input_contains == {
        "featureQuery": "결제 기능"
    }
    assert expectations["sql_erd_select_session_token"].tool_name == "inspect_sql_erd_schema"
    assert expectations["sql_erd_select_session_token"].requires_confirmation is None
    assert expectations["sql_erd_select_session_token"].input_contains == {
        "featureQuery": "결제 기능",
        "sessionSelectionToken": "88888888-8888-4888-8888-888888888888",
    }
    assert expectations["sql_erd_missing_entities"].status == "needs_clarification"
    assert expectations["sql_erd_database_execution"].status == "unsupported"
    assert expectations["workspace_document_search"].tool_name == "search_workspace_documents"
    assert expectations["workspace_document_search"].input_contains == {
        "query": "세인이 ERD 1차 MVP를 어디까지 구현한다고 했지?"
    }
