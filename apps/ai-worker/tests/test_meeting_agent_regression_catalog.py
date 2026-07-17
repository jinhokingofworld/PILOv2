import json
import re
from pathlib import Path

from app.agent_planner_evaluation import (
    load_evaluation_suite,
    load_meeting_regression_suite,
)

CATALOG_PATH = Path(__file__).parents[1] / "evals" / "meeting_agent_capability_catalog_v1.json"
PLANNER_SUITE_PATH = Path(__file__).parents[1] / "evals" / "agent_planner_korean_v1.json"
UUID_PATTERN = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b",
    re.IGNORECASE,
)
EXPECTED_MEETING_TOOLS = {
    "list_meeting_rooms",
    "get_active_meeting",
    "get_meeting_participants",
    "start_meeting_in_room",
    "join_meeting",
    "leave_meeting",
    "start_meeting_recording",
    "end_meeting_recording",
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
}


def load_catalog() -> dict[str, object]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def test_catalog_covers_every_registered_meeting_tool_with_minimum_variants() -> None:
    catalog = load_catalog()
    prefixes = catalog["canonicalPrefixes"]
    capabilities = catalog["capabilities"]

    assert catalog["version"] == "meeting-agent-regression:v1"
    assert isinstance(prefixes, list)
    assert len(prefixes) == 3
    assert isinstance(capabilities, list)

    capability_ids = {capability["id"] for capability in capabilities}
    tool_names = {capability["toolName"] for capability in capabilities}
    assert len(capability_ids) == len(capabilities)
    assert tool_names == EXPECTED_MEETING_TOOLS

    for capability in capabilities:
        assert isinstance(capability["requestSection"], str)
        assert capability["requestSection"]
        canonical = [
            f"{prefix}{seed}".strip()
            for prefix in prefixes
            for seed in capability["canonicalSeeds"]
        ]
        assert len(canonical) >= 12
        assert len(set(canonical)) == len(canonical)
        assert len(capability["contextFollowups"]) >= 3
        assert len(capability["counterexamples"]) >= 4
        assert len(capability["heldOutParaphrases"]) >= 3

        target = capability["target"]
        assert target["toolSequence"][-1] == capability["toolName"]
        assert target["intent"]
        assert target["selector"]
        assert capability["currentExpectation"]["status"] in {
            "tool_candidate",
            "needs_clarification",
            "unsupported",
        }

        for counterexample in capability["counterexamples"]:
            assert counterexample["expectedCapability"] in capability_ids
            assert counterexample["expectedCapability"] != capability["id"]


def test_catalog_prompts_are_uuid_free_and_held_out_from_canonical_prompts() -> None:
    catalog = load_catalog()
    prefixes = catalog["canonicalPrefixes"]

    for capability in catalog["capabilities"]:
        canonical = {
            f"{prefix}{seed}".strip()
            for prefix in prefixes
            for seed in capability["canonicalSeeds"]
        }
        held_out = set(capability["heldOutParaphrases"])
        user_prompts = (
            canonical
            | held_out
            | set(capability["contextFollowups"])
            | {item["prompt"] for item in capability["counterexamples"]}
        )

        assert canonical.isdisjoint(held_out)
        assert all(not UUID_PATTERN.search(prompt) for prompt in user_prompts)


def test_catalog_declares_zero_single_multiple_and_homonym_resolution_cases() -> None:
    catalog = load_catalog()
    fixtures = catalog["resolutionFixtures"]

    assert {fixture["cardinality"] for fixture in fixtures} == {
        "none",
        "single",
        "multiple",
        "homonym",
    }
    assert len({fixture["id"] for fixture in fixtures}) == 4
    allowed_statuses = {"tool_candidate", "needs_clarification"}
    assert all(fixture["expectedStatus"] in allowed_statuses for fixture in fixtures)
    assert all(
        not UUID_PATTERN.search(value)
        for fixture in fixtures
        for value in fixture["selector"].values()
        if isinstance(value, str)
    )


def test_catalog_tool_snapshot_stays_within_the_planner_registry_fixture() -> None:
    suite = load_evaluation_suite(PLANNER_SUITE_PATH)
    catalog = load_catalog()
    registered_tool_names = {tool.name for tool in suite.job.tools}
    catalog_tool_names = {capability["toolName"] for capability in catalog["capabilities"]}

    assert catalog_tool_names <= registered_tool_names


def test_catalog_builds_separate_canonical_and_held_out_planner_suites() -> None:
    canonical = load_meeting_regression_suite(
        CATALOG_PATH,
        PLANNER_SUITE_PATH,
        variant="canonical",
    )
    held_out = load_meeting_regression_suite(
        CATALOG_PATH,
        PLANNER_SUITE_PATH,
        variant="held_out",
    )

    assert canonical.version == "meeting-agent-regression:v1:canonical"
    assert held_out.version == "meeting-agent-regression:v1:held_out"
    assert len(canonical.cases) == 18 * 4 * 3
    assert len(held_out.cases) == 18 * 3
    assert {case.prompt for case in canonical.cases}.isdisjoint(
        {case.prompt for case in held_out.cases}
    )
    expected_tool_names = {
        case.expectation.tool_name for case in canonical.cases if case.expectation.tool_name
    }
    assert expected_tool_names <= EXPECTED_MEETING_TOOLS
