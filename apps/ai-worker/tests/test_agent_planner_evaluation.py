import json
from pathlib import Path

from app.agent_planner_evaluation import (
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
    assert len(suite.cases) == 33
    assert {tool.name for tool in suite.job.tools} == {
        "list_calendar_events",
        "create_calendar_event",
        "update_calendar_event",
        "list_meeting_reports",
        "get_meeting_report",
        "summarize_meeting_report",
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
