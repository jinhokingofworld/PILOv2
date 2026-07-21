import json
from collections import Counter
from pathlib import Path

import pytest

from evaluation_harness.single_tool_selection_catalog import (
    ALLOWED_DOMAINS,
    load_single_tool_selection_catalog,
    validate_single_tool_selection_catalog,
)


def _write_catalog(path: Path, cases: list[dict[str, object]]) -> None:
    path.write_text(
        json.dumps(
            {"version": "agent-single-tool-selection:v1", "cases": cases},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _case(case_id: str, domain: str = "meeting") -> dict[str, object]:
    return {
        "id": case_id,
        "domain": domain,
        "prompt": "최근 회의록을 보여줘",
        "expectedToolName": "list_meeting_reports",
    }


def test_loads_a_sufficient_single_tool_case(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    _write_catalog(catalog_path, [_case("meeting_01")])

    catalog = load_single_tool_selection_catalog(catalog_path)

    assert catalog.version == "agent-single-tool-selection:v1"
    assert catalog.cases[0].expected_tool_name == "list_meeting_reports"
    assert catalog.cases[0].context_surface is None


def test_rejects_catalog_with_duplicate_case_ids(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    _write_catalog(catalog_path, [_case("meeting_01"), _case("meeting_01")])

    with pytest.raises(ValueError, match="ids must be unique"):
        load_single_tool_selection_catalog(catalog_path)


def test_rejects_canvas_cases(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    canvas_case = _case("canvas_01", "canvas")
    _write_catalog(catalog_path, [canvas_case])

    with pytest.raises(ValueError, match="domain is invalid"):
        load_single_tool_selection_catalog(catalog_path)


def test_rejects_fields_outside_the_selection_contract(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    case = _case("meeting_01")
    case["fixture"] = {"answer": "must not be present"}
    _write_catalog(catalog_path, [case])

    with pytest.raises(ValueError, match="fields are invalid"):
        load_single_tool_selection_catalog(catalog_path)


def test_rejects_expected_tool_not_in_the_registry(tmp_path: Path) -> None:
    catalog_path = tmp_path / "catalog.json"
    _write_catalog(catalog_path, [_case("meeting_01")])
    catalog = load_single_tool_selection_catalog(catalog_path)

    with pytest.raises(ValueError, match="not present in the registry"):
        validate_single_tool_selection_catalog(catalog, {"search_meeting_transcript"})


def test_frozen_catalog_has_120_cases_with_twenty_per_non_canvas_domain() -> None:
    catalog_path = (
        Path(__file__).parents[1] / "evals" / "agent_single_tool_selection_v1.json"
    )

    catalog = load_single_tool_selection_catalog(catalog_path)

    assert len(catalog.cases) == 120
    assert Counter(case.domain for case in catalog.cases) == {
        domain: 20 for domain in ALLOWED_DOMAINS
    }
    assert all(
        case.prompt and case.expected_tool_name not in case.prompt
        for case in catalog.cases
    )
