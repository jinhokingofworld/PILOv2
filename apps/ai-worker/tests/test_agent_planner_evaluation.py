import hashlib
import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.agent_planner_evaluation import (
    attach_tool_capability_catalog,
    build_evaluation_input_hashes,
    build_evaluation_report,
    build_legacy_shadow_comparison,
    evaluate_suite,
    load_evaluation_suite,
    load_meeting_regression_suite,
    select_shadow_planner_tools,
)
from app.agent_processor import (
    AgentPlannerDecision,
    AgentPlannerOutputError,
    AgentRoutingDecision,
)
from app.agent_tool_retrieval import (
    compute_input_schema_sha256,
    compute_tool_capability_catalog_sha,
    parse_tool_capability_catalog,
)


class FakePlanner:
    def __init__(self, decisions):
        self.decisions = iter(decisions)
        self.requests = []

    def plan(self, request):
        self.requests.append(request)
        return next(self.decisions)


class FakeRouter:
    def __init__(self, decisions):
        self.decisions = iter(decisions)
        self.requests = []

    def route(self, request):
        self.requests.append(request)
        return next(self.decisions)


class RejectingPlanner:
    def plan(self, request):
        raise AgentPlannerOutputError("Agent planner selected a tool outside the shortlist")


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


def test_context_regression_case_forwards_safe_planning_context() -> None:
    root = Path(__file__).parents[1]
    suite = load_meeting_regression_suite(
        root / "evals" / "meeting_agent_capability_catalog_v1.json",
        root / "evals" / "agent_planner_korean_v1.json",
        variant="context",
    )
    case = suite.cases[0]
    planner = FakePlanner([decision()])

    evaluate_suite(
        planner,
        replace(suite, cases=(case,)),
        current_date="2026-07-18",
    )

    assert planner.requests[0].planning_context == case.planning_context
    assert "previous resource:" in planner.requests[0].planning_context
    assert "00000000-0000-4000-8000-000000000001" not in planner.requests[0].planning_context


def test_shadow_retrieval_uses_only_matched_tool_schema_and_falls_back_for_unknown_prompt(
    tmp_path,
) -> None:
    path = write_suite(
        tmp_path,
        [
            {
                "id": "calendar",
                "prompt": "이번 주 일정 보여줘",
                "expected": {
                    "status": "tool_candidate",
                    "toolName": "list_calendar_events",
                    "domain": "calendar",
                    "capabilityId": "calendar.list",
                    "requiredToolNames": ["list_calendar_events"],
                    "supported": True,
                },
            },
            {
                "id": "unknown",
                "prompt": "점심 메뉴 추천",
                "expected": {"status": "unsupported"},
            },
        ],
    )
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["tools"].append(
        {
            "name": "list_meeting_reports",
            "description": "회의록 목록을 조회합니다.",
            "riskLevel": "low",
            "executionMode": "auto",
            "inputSchema": {"type": "object"},
        }
    )
    raw["toolCapabilityCatalog"] = {
        "version": "agent-tool-capabilities:v1",
        "capabilities": [
            {
                "id": "calendar.list",
                "domain": "calendar",
                "toolNames": ["list_calendar_events"],
                "whenToUse": "일정을 조회할 때",
                "mustNotUseFor": ["회의록 요청"],
                "positiveExamples": ["이번 주 일정"],
            },
            {
                "id": "meeting.reports.list",
                "domain": "meeting",
                "toolNames": ["list_meeting_reports"],
                "whenToUse": "회의록을 조회할 때",
                "mustNotUseFor": ["일정 요청"],
                "positiveExamples": ["최근 회의록"],
            },
        ],
        "descriptors": [
            {
                "toolName": "list_calendar_events",
                "domain": "calendar",
                "action": "list_calendar_events",
                "operation": "read",
                "capabilityIds": ["calendar.list"],
                "whenToUse": "이번 주 일정과 Calendar event를 조회합니다.",
                "mustNotUseFor": ["회의록 요청"],
                "acceptedSelectorFields": ["start", "end"],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "contextSurface": None,
                "inputSchemaSha256": "b" * 64,
            },
            {
                "toolName": "list_meeting_reports",
                "domain": "meeting",
                "action": "list_meeting_reports",
                "operation": "read",
                "capabilityIds": ["meeting.reports.list"],
                "whenToUse": "회의록 목록을 조회합니다.",
                "mustNotUseFor": ["일정 요청"],
                "acceptedSelectorFields": [],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "contextSurface": None,
                "inputSchemaSha256": "c" * 64,
            },
        ],
    }
    tool_catalog = raw["toolCapabilityCatalog"]
    schemas_by_tool_name = {tool["name"]: tool["inputSchema"] for tool in raw["tools"]}
    for descriptor in tool_catalog["descriptors"]:
        descriptor["inputSchemaSha256"] = compute_input_schema_sha256(
            schemas_by_tool_name[descriptor["toolName"]]
        )
    tool_catalog["sha256"] = compute_tool_capability_catalog_sha(
        tool_catalog["version"],
        tool_catalog["capabilities"],
        tool_catalog["descriptors"],
    )
    path.write_text(json.dumps(raw), encoding="utf-8")
    suite = load_evaluation_suite(path)
    catalog_path = tmp_path / "tool-capability-catalog.json"
    catalog_path.write_text(json.dumps(raw["toolCapabilityCatalog"]), encoding="utf-8")
    suite_without_catalog_raw = dict(raw)
    suite_without_catalog_raw.pop("toolCapabilityCatalog")
    path.write_text(json.dumps(suite_without_catalog_raw), encoding="utf-8")
    attached_suite = attach_tool_capability_catalog(load_evaluation_suite(path), catalog_path)
    assert attached_suite.job.tool_capability_catalog == suite.job.tool_capability_catalog

    selected, retrieval = select_shadow_planner_tools(suite.job, "이번 주 일정 보여줘", top_k=1)
    assert [tool.name for tool in selected] == ["list_calendar_events"]
    assert retrieval is not None and not retrieval.low_confidence

    fallback, low_confidence = select_shadow_planner_tools(suite.job, "점심 메뉴 추천")
    assert [tool.name for tool in fallback] == [
        "list_calendar_events",
        "list_meeting_reports",
    ]
    assert low_confidence is not None and low_confidence.low_confidence

    results = evaluate_suite(
        FakePlanner(
            [
                decision(
                    tool_name="list_meeting_reports",
                    provider_input_tokens=120,
                    provider_output_tokens=30,
                    provider_total_tokens=150,
                ),
                decision(status="unsupported", tool_name=None, tool_input={}),
            ]
        ),
        suite,
        current_date="2026-07-11",
        use_shadow_retrieval=True,
        shadow_top_k=1,
    )
    result = results[0]
    report = build_evaluation_report(results)

    assert "shortlist_tool" in result.failure_reasons
    assert report["retrieval"]["toolRecall"] == 1.0
    assert report["retrieval"]["domainRecallAtK"] == 1.0
    assert report["retrieval"]["capabilityRecallAtK"] == 1.0
    assert report["retrieval"]["requiredToolRecallAtK"] == 1.0
    assert report["retrieval"]["supportedToUnsupportedRate"] == 0.0
    assert report["retrieval"]["averageShortlistSize"] == 1.5
    assert report["retrieval"]["shortlistViolations"] == 1
    assert report["retrieval"]["fallbackTaxonomy"] == {"no_metadata_match": 1}
    assert report["results"][0]["retrieval"]["fallbackReason"] is None
    assert report["results"][0]["retrieval"]["candidateCount"] > 0
    assert report["results"][0]["retrieval"]["confidenceBucket"] in {
        "low",
        "medium",
        "high",
    }
    observation = report["retrievalEvents"][0]
    assert observation["eventVersion"] == "agent-tool-retrieval-observation:v1"
    assert observation["catalogVersion"] == "agent-tool-capabilities:v1"
    assert observation["retrieverVersion"] == "agent-tool-metadata-overlap:v3"
    assert observation["tokenUsage"]["providerTotalTokens"] == 150
    assert "shortlistToolNames" not in observation
    assert "prompt" not in observation
    assert "이번 주 일정 보여줘" not in json.dumps(report, ensure_ascii=False)
    assert "prompt" not in report["results"][0]

    budget_fallback, budget_retrieval = select_shadow_planner_tools(
        suite.job,
        "이번 주 일정 보여줘",
        top_k=1,
        schema_token_budget=1,
    )
    assert [tool.name for tool in budget_fallback] == [
        "list_calendar_events",
        "list_meeting_reports",
    ]
    assert budget_retrieval is not None
    assert budget_retrieval.fallback_reason == "tool_schema_budget_exceeded"

    retriever_error_fallback, retriever_error = select_shadow_planner_tools(
        suite.job,
        "이번 주 일정 보여줘",
        top_k=1,
        schema_token_budget=0,
    )
    assert [tool.name for tool in retriever_error_fallback] == [
        "list_calendar_events",
        "list_meeting_reports",
    ]
    assert retriever_error is not None
    assert retriever_error.fallback_reason == "retriever_error"

    write_catalog_raw = json.loads(json.dumps(raw["toolCapabilityCatalog"]))
    write_catalog_raw["descriptors"][0]["operation"] = "write"
    write_catalog_raw["sha256"] = compute_tool_capability_catalog_sha(
        write_catalog_raw["version"],
        write_catalog_raw["capabilities"],
        write_catalog_raw["descriptors"],
    )
    write_catalog = parse_tool_capability_catalog(
        write_catalog_raw,
        {tool.name: tool.input_schema for tool in suite.job.tools},
    )
    assert write_catalog is not None
    write_job = replace(suite.job, tool_capability_catalog=write_catalog)
    write_fallback, write_retrieval = select_shadow_planner_tools(
        write_job,
        "이번 주 일정 보여줘",
        top_k=1,
    )
    assert [tool.name for tool in write_fallback] == [
        "list_calendar_events",
        "list_meeting_reports",
    ]
    assert write_retrieval is not None
    assert write_retrieval.fallback_reason == "write_capability"

    router = FakeRouter(
        [
            AgentRoutingDecision(
                status="routed",
                domains=("calendar",),
                capability_ids=("calendar.list",),
                intent_summary="이번 주 일정을 조회한다.",
                confidence="high",
                clarification_question=None,
                unsupported_reason=None,
                provider_input_tokens=50,
                provider_output_tokens=10,
                provider_total_tokens=60,
            )
        ]
    )
    planner = FakePlanner(
        [
            decision(
                provider_input_tokens=100,
                provider_output_tokens=20,
                provider_total_tokens=120,
            )
        ]
    )
    routed_results = evaluate_suite(
        planner,
        replace(suite, cases=(suite.cases[0],)),
        current_date="2026-07-11",
        router=router,
        use_llm_routing=True,
        shadow_top_k=1,
    )
    routed_report = build_evaluation_report(routed_results)

    assert [tool.name for tool in planner.requests[0].tools] == ["list_calendar_events"]
    assert planner.requests[0].routing is not None
    assert routed_report["retrieval"]["attempts"] == 1
    assert routed_report["retrieval"]["domainRecallAtK"] == 1.0
    assert routed_report["retrieval"]["capabilityRecallAtK"] == 1.0
    assert routed_report["retrieval"]["requiredToolRecallAtK"] == 1.0
    assert routed_report["planner"]["providerTokenUsage"]["total"]["average"] == 180
    assert routed_report["retrievalEvents"][0]["mode"] == "llm_router"
    assert routed_report["routingFunnel"] == {
        "toolSelectionAttempts": 1,
        "stages": {
            "routerRouted": {"count": 1, "conditionalRate": 1.0, "overallRate": 1.0},
            "domainExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 1.0},
            "capabilityExact": {
                "count": 1,
                "conditionalRate": 1.0,
                "overallRate": 1.0,
            },
            "toolExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 1.0},
            "requiredInputExact": {
                "count": 1,
                "conditionalRate": 1.0,
                "overallRate": 1.0,
            },
            "executionPolicyExact": {
                "count": 1,
                "conditionalRate": 1.0,
                "overallRate": 1.0,
            },
            "endToEndExact": {
                "count": 1,
                "conditionalRate": 1.0,
                "overallRate": 1.0,
            },
        },
    }

    rejected_router = FakeRouter(
        [
            AgentRoutingDecision(
                status="routed",
                domains=("calendar",),
                capability_ids=("calendar.list",),
                intent_summary="이번 주 일정을 조회한다.",
                confidence="high",
                clarification_question=None,
                unsupported_reason=None,
            )
        ]
    )
    rejected_report = build_evaluation_report(
        evaluate_suite(
            RejectingPlanner(),
            replace(suite, cases=(suite.cases[0],)),
            current_date="2026-07-11",
            router=rejected_router,
            use_llm_routing=True,
            shadow_top_k=1,
        )
    )

    assert rejected_report["totalAttempts"] == 1
    assert rejected_report["passedAttempts"] == 0
    assert rejected_report["retrieval"]["shortlistViolations"] == 1
    assert rejected_report["results"][0]["failureReasons"] == [
        "planner_output",
        "tool",
        "shortlist_tool",
    ]
    assert rejected_report["results"][0]["failureCategoryCandidates"] == [
        "wrong_tool",
        "shortlist_violation",
        "planner_output_error",
    ]


def test_llm_routing_funnel_attributes_domain_loss_before_tool_loss(tmp_path) -> None:
    path = write_suite(
        tmp_path,
        [
            {
                "id": "calendar",
                "prompt": "이번 주 일정 보여줘",
                "expected": {
                    "status": "tool_candidate",
                    "toolName": "list_calendar_events",
                    "domain": "calendar",
                    "capabilityId": "calendar.list",
                    "requiredToolNames": ["list_calendar_events"],
                    "supported": True,
                },
            }
        ],
    )
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["tools"].append(
        {
            "name": "list_meeting_reports",
            "description": "회의록 목록을 조회합니다.",
            "riskLevel": "low",
            "executionMode": "auto",
            "inputSchema": {"type": "object"},
        }
    )
    raw["toolCapabilityCatalog"] = {
        "version": "agent-tool-capabilities:v1",
        "capabilities": [
            {
                "id": "calendar.list",
                "domain": "calendar",
                "toolNames": ["list_calendar_events"],
                "whenToUse": "일정을 조회할 때",
                "mustNotUseFor": ["회의록 요청"],
                "positiveExamples": ["이번 주 일정"],
            },
            {
                "id": "meeting.reports.list",
                "domain": "meeting",
                "toolNames": ["list_meeting_reports"],
                "whenToUse": "회의록을 조회할 때",
                "mustNotUseFor": ["일정 요청"],
                "positiveExamples": ["최근 회의록"],
            },
        ],
        "descriptors": [],
    }
    schemas = {tool["name"]: tool["inputSchema"] for tool in raw["tools"]}
    for name, domain, capability_id in (
        ("list_calendar_events", "calendar", "calendar.list"),
        ("list_meeting_reports", "meeting", "meeting.reports.list"),
    ):
        raw["toolCapabilityCatalog"]["descriptors"].append(
            {
                "toolName": name,
                "domain": domain,
                "action": name,
                "operation": "read",
                "capabilityIds": [capability_id],
                "whenToUse": "평가용 도구입니다.",
                "mustNotUseFor": [],
                "acceptedSelectorFields": [],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "contextSurface": None,
                "inputSchemaSha256": compute_input_schema_sha256(schemas[name]),
            }
        )
    catalog = raw["toolCapabilityCatalog"]
    catalog["sha256"] = compute_tool_capability_catalog_sha(
        catalog["version"], catalog["capabilities"], catalog["descriptors"]
    )
    path.write_text(json.dumps(raw), encoding="utf-8")
    suite = load_evaluation_suite(path)
    router = FakeRouter(
        [
            AgentRoutingDecision(
                status="routed",
                domains=("calendar",),
                capability_ids=("calendar.list",),
                intent_summary="일정 조회",
                confidence="high",
                clarification_question=None,
                unsupported_reason=None,
            ),
            AgentRoutingDecision(
                status="routed",
                domains=("meeting",),
                capability_ids=("meeting.reports.list",),
                intent_summary="회의록 조회",
                confidence="high",
                clarification_question=None,
                unsupported_reason=None,
            ),
        ]
    )
    planner = FakePlanner(
        [
            decision(),
            decision(tool_name="list_meeting_reports", tool_input={}),
        ]
    )

    report = build_evaluation_report(
        evaluate_suite(
            planner,
            suite,
            current_date="2026-07-11",
            repetitions=2,
            router=router,
            use_llm_routing=True,
        )
    )

    assert report["routingFunnel"]["toolSelectionAttempts"] == 2
    assert report["routingFunnel"]["stages"] == {
        "routerRouted": {"count": 2, "conditionalRate": 1.0, "overallRate": 1.0},
        "domainExact": {"count": 1, "conditionalRate": 0.5, "overallRate": 0.5},
        "capabilityExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 0.5},
        "toolExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 0.5},
        "requiredInputExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 0.5},
        "executionPolicyExact": {
            "count": 1,
            "conditionalRate": 1.0,
            "overallRate": 0.5,
        },
        "endToEndExact": {"count": 1, "conditionalRate": 1.0, "overallRate": 0.5},
    }


def test_legacy_shadow_comparison_requires_paired_inputs_and_reports_deltas(tmp_path) -> None:
    suite = load_evaluation_suite(
        write_suite(
            tmp_path,
            [
                {
                    "id": "calendar",
                    "prompt": "오늘 일정",
                    "expected": {
                        "status": "tool_candidate",
                        "toolName": "list_calendar_events",
                    },
                }
            ],
        )
    )
    legacy = evaluate_suite(
        FakePlanner([decision()]),
        suite,
        current_date="2026-07-11",
        model_version="planner:test",
        evaluation_seed=17,
    )
    shadow = evaluate_suite(
        FakePlanner([decision()]),
        suite,
        current_date="2026-07-11",
        model_version="planner:test",
        evaluation_seed=17,
    )

    comparison = build_legacy_shadow_comparison(legacy, shadow)

    assert comparison["comparison"]["pairedAttempts"] == 1
    assert comparison["comparison"]["sameFixedInputs"] is True
    assert comparison["comparison"]["shadowMinusLegacy"]["exactAttemptRate"] == 0.0

    with pytest.raises(ValueError, match="inputs must match"):
        build_legacy_shadow_comparison(
            legacy,
            (replace(shadow[0], evaluation_seed=18),),
        )


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
    assert len(suite.cases) == 53
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
        "resolve_meeting_resource",
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
    assert expectations["meeting_summary_without_id"].input_contains == {"sections": ["summary"]}
    assert expectations["meeting_summary_discussion_and_decisions"].input_contains == {
        "sections": ["discussionPoints", "decisions"]
    }
    assert expectations["meeting_summary_action_items_only"].input_contains == {
        "sections": ["actionItems"]
    }
    assert expectations["meeting_summary_excludes_decisions"].input_contains == {
        "sections": ["summary", "discussionPoints", "actionItems"]
    }
    assert expectations["calendar_create_recurrence"].status == "unsupported"
    assert expectations["meeting_rooms"].tool_name == "list_meeting_rooms"
    assert expectations["meeting_active"].tool_name == "get_active_meeting"
    assert expectations["meeting_participants"].input_contains == {
        "current": True,
    }
    assert expectations["meeting_recording_missing_id"].tool_name == "start_meeting_recording"
    assert expectations["meeting_recording_missing_id"].requires_confirmation is True
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
