from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest

from app.canvas_agent.planning.html_generator import (
    CANVAS_HTML_MAX_OUTPUT_TOKENS,
    CanvasAgentHtmlGeneratorError,
    CanvasAgentHtmlGeneratorTimeoutError,
    OpenAiCanvasAgentHtmlGenerator,
    _system_prompt,
    parse_canvas_agent_html_artifact,
)
from app.canvas_agent.types import CanvasAgentRunContext


def scene() -> dict[str, object]:
    return {
        "shapes": [
            {"id": "shape:frame", "shapeType": "frame"},
            {"id": "shape:title", "shapeType": "text"},
        ]
    }


def context() -> CanvasAgentRunContext:
    return CanvasAgentRunContext(
        run_id="run-1",
        workspace_id="workspace-1",
        canvas_id="canvas-1",
        requested_by_user_id="user-1",
        status="planning",
        prompt="선택한 화면을 HTML로 만들어줘",
        request_context={"selectedScene": scene()},
        previous_action=None,
    )


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


def test_system_prompt_preserves_structure_and_applies_requested_or_default_style() -> None:
    prompt = _system_prompt()

    assert "structural wireframe" in prompt
    assert "relative proportions" in prompt
    assert "If the prompt explicitly asks for a style" in prompt
    assert "Toss-inspired Korean fintech product style" in prompt
    assert "Add concise, plausible example labels" in prompt
    assert "min-height: 100vh" in prompt
    assert "CSS grid and flexbox" in prompt
    assert "Do not preserve tiny Canvas pixel dimensions" in prompt


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


def test_html_generator_uses_dedicated_timeout_and_output_limit(monkeypatch) -> None:
    client_options: dict[str, object] = {}
    request_options: dict[str, object] = {}

    class FakeResponses:
        def create(self, **kwargs):
            request_options.update(kwargs)
            return SimpleNamespace(
                output_text=json.dumps(
                    {
                        "title": "대시보드",
                        "html": "<!doctype html><html><body>대시보드</body></html>",
                    }
                )
            )

    class FakeOpenAI:
        def __init__(self, **kwargs):
            client_options.update(kwargs)
            self.responses = FakeResponses()

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(OpenAI=FakeOpenAI))

    generator = OpenAiCanvasAgentHtmlGenerator("test-key", "test-model", 180.0)
    result = generator.generate(context())

    assert client_options == {"api_key": "test-key", "timeout": 180.0, "max_retries": 0}
    assert request_options["max_output_tokens"] == CANVAS_HTML_MAX_OUTPUT_TOKENS
    assert result["kind"] == "html"


def test_html_generator_turns_provider_timeout_into_terminal_error(monkeypatch) -> None:
    class FakeTimeoutError(Exception):
        pass

    class FakeResponses:
        def create(self, **_kwargs):
            raise FakeTimeoutError("timed out")

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

    monkeypatch.setitem(
        sys.modules,
        "openai",
        SimpleNamespace(
            OpenAI=FakeOpenAI,
            APIConnectionError=RuntimeError,
            APITimeoutError=FakeTimeoutError,
            InternalServerError=RuntimeError,
            RateLimitError=RuntimeError,
        ),
    )

    generator = OpenAiCanvasAgentHtmlGenerator("test-key", "test-model", 180.0)

    with pytest.raises(CanvasAgentHtmlGeneratorTimeoutError):
        generator.generate(context())
