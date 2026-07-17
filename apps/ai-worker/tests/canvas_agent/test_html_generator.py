from __future__ import annotations

import json

import pytest

from app.canvas_agent.planning.html_generator import (
    CanvasAgentHtmlGeneratorError,
    parse_canvas_agent_html_artifact,
)


def scene() -> dict[str, object]:
    return {
        "shapes": [
            {"id": "shape:frame", "shapeType": "frame"},
            {"id": "shape:title", "shapeType": "text"},
        ]
    }


def test_parse_html_artifact_accepts_static_document() -> None:
    result = parse_canvas_agent_html_artifact(
        json.dumps(
            {
                "title": "대시보드",
                "html": (
                    "<!doctype html><html><head><style>body{margin:0}</style></head>"
                    "<body><main>대시보드</main></body></html>"
                ),
            }
        ),
        scene(),
    )

    assert result["kind"] == "html"
    assert result["sourceShapeIds"] == ["shape:frame", "shape:title"]


@pytest.mark.parametrize(
    "html",
    [
        "<!doctype html><html><script>alert(1)</script></html>",
        "<!doctype html><html><body onload='alert(1)'></body></html>",
        "<!doctype html><html><a href='javascript:alert(1)'>x</a></html>",
        "<!doctype html><html><link rel='stylesheet' href='https://example.com/a.css'></html>",
    ],
)
def test_parse_html_artifact_rejects_active_content(html: str) -> None:
    with pytest.raises(CanvasAgentHtmlGeneratorError):
        parse_canvas_agent_html_artifact(
            json.dumps({"title": "위험한 문서", "html": html}),
            scene(),
        )
