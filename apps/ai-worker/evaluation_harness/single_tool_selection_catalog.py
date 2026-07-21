from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ALLOWED_DOMAINS = ("meeting", "calendar", "board", "drive", "sqltoerd", "prreview")
_ALLOWED_CONTEXT_SURFACES = {"sql_erd", "pr_review"}
_CASE_FIELDS = {"id", "domain", "prompt", "expectedToolName", "contextSurface"}


@dataclass(frozen=True)
class SingleToolSelectionCase:
    case_id: str
    domain: str
    prompt: str
    expected_tool_name: str
    context_surface: str | None


@dataclass(frozen=True)
class SingleToolSelectionCatalog:
    version: str
    cases: tuple[SingleToolSelectionCase, ...]


def load_single_tool_selection_catalog(
    catalog_path: Path,
) -> SingleToolSelectionCatalog:
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        raise ValueError(
            "Single-tool selection catalog must contain valid JSON"
        ) from error
    if (
        not isinstance(payload, dict)
        or payload.get("version") != "agent-single-tool-selection:v1"
    ):
        raise ValueError("Single-tool selection catalog version is invalid")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("Single-tool selection catalog cases are required")

    cases = tuple(_load_case(raw_case) for raw_case in raw_cases)
    if len({case.case_id for case in cases}) != len(cases):
        raise ValueError("Single-tool selection catalog ids must be unique")
    return SingleToolSelectionCatalog(version=payload["version"], cases=cases)


def validate_single_tool_selection_catalog(
    catalog: SingleToolSelectionCatalog, tool_names: set[str]
) -> None:
    missing = sorted(
        {
            case.expected_tool_name
            for case in catalog.cases
            if case.expected_tool_name not in tool_names
        }
    )
    if missing:
        raise ValueError(
            f"Expected Tool is not present in the registry: {', '.join(missing)}"
        )


def _load_case(raw_case: object) -> SingleToolSelectionCase:
    if not isinstance(raw_case, dict) or set(raw_case) - _CASE_FIELDS:
        raise ValueError("Single-tool selection case fields are invalid")
    case_id = _required_string(raw_case, "id")
    domain = _required_string(raw_case, "domain")
    prompt = _required_string(raw_case, "prompt")
    expected_tool_name = _required_string(raw_case, "expectedToolName")
    context_surface = raw_case.get("contextSurface")
    if domain not in ALLOWED_DOMAINS:
        raise ValueError("Single-tool selection case domain is invalid")
    if context_surface is not None and context_surface not in _ALLOWED_CONTEXT_SURFACES:
        raise ValueError("Single-tool selection case contextSurface is invalid")
    if domain == "sqltoerd" and context_surface != "sql_erd":
        raise ValueError("SQLtoERD cases require the sql_erd contextSurface")
    if domain == "prreview" and context_surface != "pr_review":
        raise ValueError("PR Review cases require the pr_review contextSurface")
    if domain not in {"sqltoerd", "prreview"} and context_surface is not None:
        raise ValueError("Only SQLtoERD and PR Review cases may set contextSurface")
    return SingleToolSelectionCase(
        case_id, domain, prompt, expected_tool_name, context_surface
    )


def _required_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Single-tool selection case {key} is required")
    return value.strip()
