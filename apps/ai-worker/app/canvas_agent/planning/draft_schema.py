from __future__ import annotations

GENERATION_RULES: dict[str, object] = {
    "onlyUseAvailableCanvasTools": True,
    "doNotReturnRawTldrawShape": True,
    "maxNodes": 16,
    "maxConnections": 24,
    "allowedColors": ["default", "black", "blue", "violet", "green", "yellow", "red"],
    "toolSourceRule": "All tools except code are tldraw_builtin. code is pilo_custom.",
    "recommendedColors": {
        "requiredWhenUsingCreateDraft": True,
        "maxItems": 5,
        "schema": [
            {
                "name": "one allowed color name",
                "label": "Korean label",
                "usage": "why this color is recommended in this draft",
            }
        ],
    },
    "coordinateSystem": (
        "Canvas page coordinates. If parentId references a frame, child x/y are "
        "frame-local coordinates."
    ),
    "preferFrameForGeneratedDraft": True,
    "requiredCreateDraftInput": {
        "kind": "diagram|code",
        "title": "short Korean title",
        "summary": "short Korean summary",
        "recommendedColors": [
            {
                "name": "blue",
                "label": "파랑",
                "usage": "Use this color to express the main flow or primary screen.",
            }
        ],
        "nodes": [
            {
                "id": "stable local id",
                "kind": "frame|note|text|rectangle|circle|triangle|code",
                "x": 100,
                "y": 100,
                "width": 720,
                "height": 360,
                "title": "visible title",
                "text": "optional visible text",
                "color": "blue",
                "parentId": "optional frame id",
            }
        ],
        "connections": [
            {
                "id": "stable connection id",
                "kind": "arrow|line",
                "from": "source node id",
                "to": "target node id",
                "text": "optional label",
                "color": "black",
            }
        ],
    },
}

DRAFT_KIND_RULES: dict[str, object] = {
    "chooseExactlyOne": True,
    "priority": ["code", "diagram", "chat"],
    "diagram": (
        "Choose create_draft kind=diagram for design drafts, flowcharts, wireframes, "
        "user journeys, structure diagrams, screen layouts, process maps, and visual explanations."
    ),
    "code": (
        "Choose create_draft kind=code for code generation, multi-file examples, "
        "components, hooks, APIs, types, snippets, implementation examples, or any "
        "request that asks to include code."
    ),
    "chat": (
        "Choose finish when the user is asking a conversational question, discussing "
        "direction, or not asking Canvas AI to find, connect, or create Canvas content."
    ),
    "tieBreakers": [
        (
            "If the prompt asks for code or files, choose code even when notes, "
            "labels, or connectors are also useful."
        ),
        "If the prompt asks for a visual draft without code, choose diagram.",
        (
            "If the prompt only asks what is possible or asks for an explanation, "
            "choose chat and answer with finish."
        ),
    ],
}

DRAFT_TEMPLATES: dict[str, object] = {
    "diagram": {
        "kind": "diagram",
        "purpose": "Design drafts, flows, wireframes, user journeys, and structure diagrams.",
        "layout": (
            "Create one frame as the container, add a clear title, then place tldraw "
            "built-in text/note/rectangle/circle/triangle nodes inside it."
        ),
        "expectedNodes": [
            "frame: one container frame sized to fit the whole draft",
            "text: short title or section labels",
            "rectangle: screens, cards, states, and process steps",
            "circle: start/end/status/emphasis",
            "triangle: branches, warnings, or decision markers",
            "note: short ideas, annotations, or supporting context",
        ],
        "expectedConnections": (
            "Use arrow for directed flow and line for undirected relationships when "
            "relationships matter."
        ),
        "styleGuidance": [
            "Prefer a clean left-to-right or top-to-bottom layout.",
            "Keep text short enough to fit inside each shape.",
            "Use recommendedColors to explain the chosen palette.",
        ],
        "exampleRequests": [
            "로그인 흐름 다이어그램 만들어줘",
            "온보딩 화면을 모던하게 초안으로 만들어줘",
            "사용자 여정을 캔버스에 정리해줘",
        ],
    },
    "code": {
        "kind": "code",
        "purpose": (
            "Single or multi-file code blocks, short explanation notes, and file " "relationships."
        ),
        "layout": (
            "Create one frame as the container, then create one PILO code block per "
            "file or snippet. Add optional tldraw built-in note/text nodes for short explanations."
        ),
        "expectedNodes": [
            "frame: one container frame sized to fit all files and notes",
            "code: one pilo_custom code block for each generated file or snippet",
            "note: short explanation, setup note, or caveat when useful",
            "text: section title or file group label when useful",
        ],
        "expectedConnections": (
            "Use arrow or line between related code files, for example component -> hook "
            "-> api client, or explanation note -> code block."
        ),
        "fileSplitting": [
            (
                "If the user asks for multiple files or the implementation naturally "
                "has separate responsibilities, split into multiple code nodes."
            ),
            (
                "If the request is small or explicitly asks for one snippet, use one "
                "code node inside the frame."
            ),
            (
                "Each code node should include title as a file name when possible "
                "and language when known."
            ),
        ],
        "styleGuidance": [
            "Keep each code block concise enough to be readable on Canvas.",
            "Prefer practical, copyable examples over long prose.",
            "Use recommendedColors to separate main code, helper code, and notes when useful.",
        ],
        "exampleRequests": [
            "JWT 인증 예시 코드 만들어줘",
            "로그인 컴포넌트를 파일로 나눠서 만들어줘",
            "API 호출 코드를 캔버스에 생성해줘",
        ],
    },
}
