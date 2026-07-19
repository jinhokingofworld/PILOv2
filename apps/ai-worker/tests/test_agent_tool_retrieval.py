import json
from pathlib import Path

import pytest

from app.agent_tool_retrieval import (
    _is_compound_request,
    compute_input_schema_sha256,
    compute_tool_capability_catalog_sha,
    parse_tool_capability_catalog,
    retrieve_tool_shortlist,
    select_tool_shortlist,
)

TOOL_SCHEMAS = {
    "list_calendar_events": {"type": "object", "required": ["start", "end"]},
    "list_meeting_reports": {"type": "object", "properties": {"status": {"type": "string"}}},
}
QUALITY_FIXTURE_PATH = (
    Path(__file__).resolve().parents[1] / "evals" / "tool_retrieval_quality_gate_v1.json"
)


def examples(utterance: str) -> list[dict[str, str]]:
    return [
        {"kind": "canonical", "utterance": utterance},
        {"kind": "paraphrase", "utterance": f"{utterance} 알려줘"},
        {"kind": "typo", "utterance": utterance.replace(" ", "")},
        {"kind": "honorific", "utterance": f"{utterance} 부탁드려요"},
        {"kind": "abbreviation", "utterance": f"{utterance} 요청"},
    ]


def catalog_payload() -> dict[str, object]:
    payload: dict[str, object] = {
        "version": "agent-tool-capabilities:v2",
        "capabilities": [
            {
                "id": "calendar.list",
                "domain": "calendar",
                "toolNames": ["list_calendar_events"],
                "whenToUse": "일정을 조회할 때",
                "mustNotUseFor": ["회의록 요청"],
                "positiveExamples": [example["utterance"] for example in examples("이번 주 일정")],
                "examples": examples("이번 주 일정"),
                "selectorKinds": ["date_range"],
                "requiresConfirmation": False,
                "availability": "supported",
            },
            {
                "id": "meeting.reports.list",
                "domain": "meeting",
                "toolNames": ["list_meeting_reports"],
                "whenToUse": "회의록을 조회할 때",
                "mustNotUseFor": ["일정 요청"],
                "positiveExamples": [example["utterance"] for example in examples("최근 회의록")],
                "examples": examples("최근 회의록"),
                "selectorKinds": ["meeting_report"],
                "requiresConfirmation": False,
                "availability": "supported",
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
                "selectorKinds": ["date_range"],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "requiresConfirmation": False,
                "contextSurface": None,
                "inputSchemaSha256": compute_input_schema_sha256(
                    TOOL_SCHEMAS["list_calendar_events"]
                ),
            },
            {
                "toolName": "list_meeting_reports",
                "domain": "meeting",
                "action": "list_meeting_reports",
                "operation": "read",
                "capabilityIds": ["meeting.reports.list"],
                "whenToUse": "회의록과 미팅 report 목록을 조회합니다.",
                "mustNotUseFor": ["일정 요청"],
                "acceptedSelectorFields": ["status", "limit"],
                "selectorKinds": ["meeting_report"],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "requiresConfirmation": False,
                "contextSurface": None,
                "inputSchemaSha256": compute_input_schema_sha256(
                    TOOL_SCHEMAS["list_meeting_reports"]
                ),
            },
        ],
    }
    payload["sha256"] = compute_tool_capability_catalog_sha(
        payload["version"], payload["capabilities"], payload["descriptors"]
    )
    return payload


def legacy_catalog_payload(version: str = "agent-tool-capabilities:v1") -> dict[str, object]:
    payload = catalog_payload()
    payload["version"] = version
    for capability in payload["capabilities"]:
        capability.pop("examples")
        capability.pop("selectorKinds")
        capability.pop("requiresConfirmation")
        capability.pop("availability")
    for descriptor in payload["descriptors"]:
        descriptor.pop("selectorKinds")
        descriptor.pop("requiresConfirmation")
    payload["sha256"] = compute_tool_capability_catalog_sha(
        payload["version"], payload["capabilities"], payload["descriptors"]
    )
    return payload


def test_catalog_requires_exactly_the_hard_eligible_tools() -> None:
    catalog = parse_tool_capability_catalog(catalog_payload(), TOOL_SCHEMAS)

    assert catalog is not None
    assert catalog.version == "agent-tool-capabilities:v2"

    invalid = catalog_payload()
    invalid["descriptors"] = invalid["descriptors"][:1]
    with pytest.raises(ValueError, match="toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)


def test_catalog_accepts_v1_compatibility_payload_and_rejects_unknown_version() -> None:
    legacy = parse_tool_capability_catalog(legacy_catalog_payload(), TOOL_SCHEMAS)
    assert legacy is not None
    assert legacy.version == "agent-tool-capabilities:v1"

    unknown = legacy_catalog_payload("agent-tool-capabilities:v3")
    with pytest.raises(ValueError, match="Unsupported toolCapabilityCatalog version"):
        parse_tool_capability_catalog(unknown, TOOL_SCHEMAS)


def test_catalog_rejects_a_sha_that_does_not_match_the_canonical_content() -> None:
    invalid = catalog_payload()
    invalid["descriptors"][0]["whenToUse"] = "변조된 설명"

    with pytest.raises(ValueError, match="toolCapabilityCatalog SHA"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)


def test_metadata_retrieval_prefers_matching_domain_and_returns_low_confidence_fallback() -> None:
    catalog = parse_tool_capability_catalog(catalog_payload(), TOOL_SCHEMAS)
    assert catalog is not None

    calendar = retrieve_tool_shortlist("이번 주 일정 알려줘", catalog, top_k=1)
    assert calendar.tool_names == ("list_calendar_events",)
    assert not calendar.low_confidence
    assert calendar.candidate_count > 0
    assert calendar.confidence_bucket in {"low", "medium", "high"}

    meeting = retrieve_tool_shortlist("최근 회의록 보여줘", catalog, top_k=1)
    assert meeting.tool_names == ("list_meeting_reports",)

    unknown = retrieve_tool_shortlist("점심 메뉴 추천해줘", catalog)
    assert unknown.tool_names == ()
    assert unknown.low_confidence
    assert unknown.fallback_reason == "no_metadata_match"
    assert unknown.candidate_count == 0
    assert unknown.confidence_bucket == "none"


def test_full_catalog_shortlists_current_meeting_leave_without_adjacent_actions() -> None:
    fixture = json.loads(QUALITY_FIXTURE_PATH.read_text(encoding="utf-8"))
    schemas = fixture["eligibleToolSchemas"]
    catalog = parse_tool_capability_catalog(fixture["toolCapabilityCatalog"], schemas)
    assert catalog is not None

    leave = select_tool_shortlist("회의 나가줘", catalog, schemas)
    reports = select_tool_shortlist("최근 3건 회의록", catalog, schemas)

    assert leave.used_shortlist is True
    assert leave.retrieval.selected_capability_ids == ("meeting.control.leave",)
    assert leave.tool_names == ("get_active_meeting", "leave_meeting")
    assert reports.retrieval.selected_capability_ids == ("meeting.reports.list",)
    assert reports.tool_names == ("list_meeting_reports",)


@pytest.mark.parametrize(
    "prompt",
    (
        "오늘 일정 보여줘",
        "이번 주 일정 알려줘",
    ),
)
def test_full_catalog_shortlists_calendar_list_for_common_date_queries(prompt: str) -> None:
    fixture = json.loads(QUALITY_FIXTURE_PATH.read_text(encoding="utf-8"))
    schemas = fixture["eligibleToolSchemas"]
    catalog = parse_tool_capability_catalog(fixture["toolCapabilityCatalog"], schemas)
    assert catalog is not None

    calendar = select_tool_shortlist(prompt, catalog, schemas)

    assert calendar.used_shortlist is True
    assert calendar.retrieval.selected_capability_ids == ("calendar.events.list",)
    assert calendar.tool_names == ("list_calendar_events",)


@pytest.mark.parametrize(
    ("prompt", "capability_id", "tool_names"),
    (
        (
            "오늘 오후 3시 일정 만들어줘",
            "calendar.events.create",
            {"create_calendar_event"},
        ),
        (
            "오늘 일정 시간 바꿔줘",
            "calendar.events.update",
            {"list_calendar_events", "update_calendar_event"},
        ),
        (
            "첫 번째 후속 작업 승인해줘",
            "meeting.action_items.approve",
            {"find_action_items", "approve_meeting_report_action_item"},
        ),
        (
            "두 번째 후속 작업 반려해줘",
            "meeting.action_items.dismiss",
            {"find_action_items", "dismiss_meeting_report_action_item"},
        ),
        (
            "로그인 버그 이슈 찾아줘",
            "board.issues.search",
            {"search_board_issues", "get_board_issue_context"},
        ),
        ("새 보드 이슈 만들어줘", "board.issues.create", {"create_board_issue"}),
        (
            "첫 번째 이슈 상태를 진행 중으로 바꿔줘",
            "board.issues.move",
            {"search_board_issues", "move_board_issue_status"},
        ),
        (
            "현재 ERD 테이블 보여줘",
            "sql_erd.inspect",
            {"inspect_sql_erd_schema", "focus_sql_erd_tables"},
        ),
        (
            "PR 리뷰 우선순위 보여줘",
            "pr_review.focus",
            {"recommend_pr_review_focus"},
        ),
        ("캔버스 작업 해줘", "canvas.delegate", {"delegate_canvas_agent"}),
    ),
)
def test_full_catalog_uses_korean_intent_cues_across_domains(
    prompt: str,
    capability_id: str,
    tool_names: set[str],
) -> None:
    fixture = json.loads(QUALITY_FIXTURE_PATH.read_text(encoding="utf-8"))
    schemas = fixture["eligibleToolSchemas"]
    catalog = parse_tool_capability_catalog(fixture["toolCapabilityCatalog"], schemas)
    assert catalog is not None

    retrieval = retrieve_tool_shortlist(prompt, catalog)

    assert retrieval.selected_capability_ids == (capability_id,)
    assert set(retrieval.tool_names) == tool_names
    assert retrieval.fallback_reason is None


def test_full_catalog_routes_korean_delete_request_to_unsupported_capability() -> None:
    fixture = json.loads(QUALITY_FIXTURE_PATH.read_text(encoding="utf-8"))
    schemas = fixture["eligibleToolSchemas"]
    catalog = parse_tool_capability_catalog(fixture["toolCapabilityCatalog"], schemas)
    assert catalog is not None

    retrieval = retrieve_tool_shortlist("내일 일정 삭제해줘", catalog)

    assert retrieval.tool_names == ()
    assert retrieval.selected_capability_ids == ()
    assert retrieval.fallback_reason == "unsupported_capability"
    assert retrieval.unsupported_capability_id == "calendar.events.delete"


def test_compound_request_detection_requires_a_conjunction_token() -> None:
    assert _is_compound_request("일정과 회의록을 보여줘") is True
    assert _is_compound_request("회의록 보여주고, 일정에 추가해줘") is True
    assert _is_compound_request("회의에서 나와줘") is False
    assert _is_compound_request("대화 내용 보여줘") is False


def test_full_catalog_keeps_meeting_decision_to_calendar_handoff_out_of_unsupported_fallback() -> (
    None
):
    fixture = json.loads(QUALITY_FIXTURE_PATH.read_text(encoding="utf-8"))
    schemas = fixture["eligibleToolSchemas"]
    catalog = parse_tool_capability_catalog(fixture["toolCapabilityCatalog"], schemas)
    assert catalog is not None

    selection = select_tool_shortlist(
        "최근 회의록에서, 결정사항 알려주고, 그거 일정에 추가해줘",
        catalog,
        schemas,
    )

    assert selection.used_shortlist is True
    assert selection.retrieval.fallback_reason is None
    assert selection.retrieval.selected_capability_ids == (
        "meeting.report.summary",
        "calendar.events.create",
    )
    assert set(selection.tool_names) == {
        "list_meeting_reports",
        "summarize_meeting_report",
        "create_calendar_event",
    }


def test_catalog_rejects_descriptor_digest_that_does_not_match_the_tool_schema() -> None:
    invalid = catalog_payload()
    invalid["descriptors"][0]["inputSchemaSha256"] = "0" * 64
    invalid["sha256"] = compute_tool_capability_catalog_sha(
        invalid["version"], invalid["capabilities"], invalid["descriptors"]
    )

    with pytest.raises(ValueError, match="Invalid toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)


def test_retrieval_expands_required_chain_within_the_schema_budget() -> None:
    payload = catalog_payload()
    payload["capabilities"][0]["toolNames"] = [
        "list_calendar_events",
        "list_meeting_reports",
    ]
    payload["descriptors"][1]["capabilityIds"].append("calendar.list")
    payload["descriptors"][1]["selectorKinds"].append("date_range")
    payload["sha256"] = compute_tool_capability_catalog_sha(
        payload["version"], payload["capabilities"], payload["descriptors"]
    )
    catalog = parse_tool_capability_catalog(payload, TOOL_SCHEMAS)
    assert catalog is not None

    shortlist = retrieve_tool_shortlist(
        "이번 주 일정 알려줘",
        catalog,
        top_k=1,
        tool_schema_bytes={"list_calendar_events": 100, "list_meeting_reports": 100},
        schema_token_budget=50,
    )
    assert shortlist.tool_names == ("list_calendar_events", "list_meeting_reports")
    assert shortlist.selected_capability_ids == ("calendar.list",)
    assert shortlist.low_confidence is False

    too_small = retrieve_tool_shortlist(
        "이번 주 일정 알려줘",
        catalog,
        top_k=1,
        tool_schema_bytes={"list_calendar_events": 100, "list_meeting_reports": 100},
        schema_token_budget=49,
    )
    assert too_small.tool_names == ()
    assert too_small.low_confidence is True
    assert too_small.fallback_reason == "tool_schema_budget_exceeded"


def test_catalog_keeps_unsupported_capabilities_out_of_the_executable_tool_set() -> None:
    payload = catalog_payload()
    payload["capabilities"].append(
        {
            "id": "calendar.delete",
            "domain": "calendar",
            "toolNames": [],
            "whenToUse": "기존 일정을 삭제할 때",
            "mustNotUseFor": ["현재 registry에 실행 tool이 없는 요청"],
            "positiveExamples": [example["utterance"] for example in examples("내일 일정 삭제")],
            "examples": examples("내일 일정 삭제"),
            "selectorKinds": ["calendar_event"],
            "requiresConfirmation": False,
            "availability": "unsupported",
        }
    )
    payload["sha256"] = compute_tool_capability_catalog_sha(
        payload["version"], payload["capabilities"], payload["descriptors"]
    )

    catalog = parse_tool_capability_catalog(payload, TOOL_SCHEMAS)

    assert catalog is not None
    unsupported = next(
        capability
        for capability in catalog.capabilities
        if capability.capability_id == "calendar.delete"
    )
    assert unsupported.availability == "unsupported"
    assert unsupported.tool_names == ()

    retrieval = retrieve_tool_shortlist("내일 일정 삭제해줘", catalog)
    assert retrieval.tool_names == ()
    assert not retrieval.low_confidence
    assert retrieval.fallback_reason == "unsupported_capability"
    assert retrieval.unsupported_capability_id == "calendar.delete"

    supported = retrieve_tool_shortlist("이번 주 일정 알려줘", catalog, top_k=1)
    assert supported.tool_names == ("list_calendar_events",)
    assert supported.unsupported_capability_id is None


@pytest.mark.parametrize(
    "field",
    ["selectorKinds", "requiresConfirmation", "examples"],
)
def test_v2_catalog_requires_capability_contract_fields(field: str) -> None:
    invalid = catalog_payload()
    invalid["capabilities"][0].pop(field)
    invalid["sha256"] = compute_tool_capability_catalog_sha(
        invalid["version"], invalid["capabilities"], invalid["descriptors"]
    )

    with pytest.raises(ValueError, match="Invalid tool capability descriptor"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)


def test_v2_catalog_rejects_invalid_examples_and_confirmation_invariants() -> None:
    invalid_examples = catalog_payload()
    invalid_examples["capabilities"][0]["examples"][4]["kind"] = "canonical"
    invalid_examples["sha256"] = compute_tool_capability_catalog_sha(
        invalid_examples["version"],
        invalid_examples["capabilities"],
        invalid_examples["descriptors"],
    )
    with pytest.raises(ValueError, match="Invalid toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid_examples, TOOL_SCHEMAS)

    invalid_confirmation = catalog_payload()
    invalid_confirmation["capabilities"][0]["requiresConfirmation"] = True
    invalid_confirmation["sha256"] = compute_tool_capability_catalog_sha(
        invalid_confirmation["version"],
        invalid_confirmation["capabilities"],
        invalid_confirmation["descriptors"],
    )
    with pytest.raises(ValueError, match="Invalid toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid_confirmation, TOOL_SCHEMAS)


def test_v2_catalog_rejects_selector_kind_drift() -> None:
    invalid = catalog_payload()
    invalid["descriptors"][0]["selectorKinds"] = ["calendar_event"]
    invalid["sha256"] = compute_tool_capability_catalog_sha(
        invalid["version"], invalid["capabilities"], invalid["descriptors"]
    )

    with pytest.raises(ValueError, match="Invalid toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)
