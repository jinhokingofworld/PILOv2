import pytest

from app.agent_tool_retrieval import (
    compute_input_schema_sha256,
    compute_tool_capability_catalog_sha,
    parse_tool_capability_catalog,
    retrieve_tool_shortlist,
)

TOOL_SCHEMAS = {
    "list_calendar_events": {"type": "object", "required": ["start", "end"]},
    "list_meeting_reports": {"type": "object", "properties": {"status": {"type": "string"}}},
}


def catalog_payload() -> dict[str, object]:
    payload: dict[str, object] = {
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
                "capabilityIds": ["calendar.list"],
                "whenToUse": "이번 주 일정과 Calendar event를 조회합니다.",
                "mustNotUseFor": ["회의록 요청"],
                "acceptedSelectorFields": ["start", "end"],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
                "contextSurface": None,
                "inputSchemaSha256": compute_input_schema_sha256(
                    TOOL_SCHEMAS["list_calendar_events"]
                ),
            },
            {
                "toolName": "list_meeting_reports",
                "domain": "meeting",
                "action": "list_meeting_reports",
                "capabilityIds": ["meeting.reports.list"],
                "whenToUse": "회의록과 미팅 report 목록을 조회합니다.",
                "mustNotUseFor": ["일정 요청"],
                "acceptedSelectorFields": ["status", "limit"],
                "prerequisiteToolNames": [],
                "followUpToolNames": [],
                "riskLevel": "low",
                "executionMode": "auto",
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


def test_catalog_requires_exactly_the_hard_eligible_tools() -> None:
    catalog = parse_tool_capability_catalog(catalog_payload(), TOOL_SCHEMAS)

    assert catalog is not None
    assert catalog.version == "agent-tool-capabilities:v1"

    invalid = catalog_payload()
    invalid["descriptors"] = invalid["descriptors"][:1]
    with pytest.raises(ValueError, match="toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)


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

    meeting = retrieve_tool_shortlist("최근 회의록 보여줘", catalog, top_k=1)
    assert meeting.tool_names == ("list_meeting_reports",)

    unknown = retrieve_tool_shortlist("점심 메뉴 추천해줘", catalog)
    assert unknown.tool_names == ()
    assert unknown.low_confidence
    assert unknown.fallback_reason == "no_metadata_match"


def test_catalog_rejects_descriptor_digest_that_does_not_match_the_tool_schema() -> None:
    invalid = catalog_payload()
    invalid["descriptors"][0]["inputSchemaSha256"] = "0" * 64
    invalid["sha256"] = compute_tool_capability_catalog_sha(
        invalid["version"], invalid["capabilities"], invalid["descriptors"]
    )

    with pytest.raises(ValueError, match="Invalid toolCapabilityCatalog"):
        parse_tool_capability_catalog(invalid, TOOL_SCHEMAS)
