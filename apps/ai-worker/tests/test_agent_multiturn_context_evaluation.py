from collections import Counter
from pathlib import Path

import pytest

from app.agent_multiturn_context_evaluation import load_multiturn_catalog


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
