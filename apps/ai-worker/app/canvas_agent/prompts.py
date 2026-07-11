from __future__ import annotations

import json

from app.canvas_agent.types import CanvasAgentRunContext


def system_prompt() -> str:
    return (
        "You are the PILO Canvas AI planner. Return only JSON matching the schema. "
        "Choose exactly one allowed Canvas action. You never create raw tldraw shapes, "
        "never apply or discard drafts, and never access Calendar, Issue, PR, Meeting, or any external-domain resource. "
        "For generation, you are not drawing freely: compose the Canvas only with the listed availableCanvasTools. "
        "When using create_draft, prefer returning exact nodes and connections with x, y, width, height, text, color, and parentId. "
        "Also return recommendedColors that explain the small palette you chose for the draft. "
        "Use find_canvas_tool when the user asks where a built-in Canvas toolbar button or tool is. "
        "Use find_shapes for semantic search. Use focus_viewport or select_shapes only with shapeIds "
        "provided by the previous action result or request selection. "
        "Use connect_shapes only when two existing Canvas shape ids are known and the user explicitly asks to connect them. "
        "Before choosing a generation action, classify the request as diagram, code, or chat. "
        "Prefer create_draft with kind=diagram for visual drafts, flowcharts, wireframes, user journeys, and structure diagrams. "
        "Prefer create_draft with kind=code when the user asks for code, files, components, hooks, APIs, types, snippets, or asks to include code. "
        "Use finish for chat when the request is not Canvas generation, shape search, shape connection, or toolbar help. "
        "All code generation, including a single code block, must use create_draft with kind=code. "
        "Use finish when the previous action already completed the requested outcome. "
        "Never include raw provider data, full Canvas snapshots, tokens, credentials, secrets, or lengthy text."
    )


def user_prompt(context: CanvasAgentRunContext) -> str:
    return json.dumps(
        {
            "runId": context.run_id,
            "prompt": context.prompt,
            "requestContext": context.request_context,
            "previousAction": context.previous_action,
            "availableCanvasTools": [
                {
                    "tool": "frame",
                    "source": "tldraw_builtin",
                    "nodeKind": "frame",
                    "shapeType": "frame",
                    "description": "Use the tldraw built-in frame tool to group generated content into one visual area.",
                    "supportsText": True,
                    "supportsParenting": False,
                },
                {
                    "tool": "note",
                    "source": "tldraw_builtin",
                    "nodeKind": "note",
                    "shapeType": "note",
                    "description": "Use the tldraw built-in note tool for short ideas, steps, and labels.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "text",
                    "source": "tldraw_builtin",
                    "nodeKind": "text",
                    "shapeType": "text",
                    "description": "Use the tldraw built-in text tool for plain titles and annotations.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "rectangle",
                    "source": "tldraw_builtin",
                    "nodeKind": "rectangle",
                    "shapeType": "geo",
                    "geo": "rectangle",
                    "description": "Use the tldraw built-in rectangle tool for screens, cards, states, and process steps.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "circle",
                    "source": "tldraw_builtin",
                    "nodeKind": "circle",
                    "shapeType": "geo",
                    "geo": "ellipse",
                    "description": "Use the tldraw built-in ellipse tool for start/end states, status, or emphasis.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "triangle",
                    "source": "tldraw_builtin",
                    "nodeKind": "triangle",
                    "shapeType": "geo",
                    "geo": "triangle",
                    "description": "Use the tldraw built-in triangle geo tool for branches, warnings, or decision markers.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "arrow",
                    "source": "tldraw_builtin",
                    "connectionKind": "arrow",
                    "shapeType": "arrow",
                    "description": "Use the tldraw built-in arrow tool for directed relationships between nodes.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "line",
                    "source": "tldraw_builtin",
                    "connectionKind": "line",
                    "shapeType": "arrow",
                    "description": "Use the tldraw built-in line-style connector for undirected visual connections.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
                {
                    "tool": "code",
                    "source": "pilo_custom",
                    "nodeKind": "code",
                    "shapeType": "pilo-code-block",
                    "description": "Use PILO custom code block shape for concise implementation examples.",
                    "supportsText": True,
                    "supportsParenting": True,
                },
            ],
            "availableCanvasColors": [
                {
                    "name": "default",
                    "label": "기본",
                    "hex": "#111827",
                    "bestFor": "기본 텍스트, 중립 요소, 강조가 필요 없는 연결",
                },
                {
                    "name": "black",
                    "label": "검정",
                    "hex": "#111827",
                    "bestFor": "강한 제목, 중요한 연결선, 대비가 필요한 요소",
                },
                {
                    "name": "blue",
                    "label": "파랑",
                    "hex": "#3858f6",
                    "bestFor": "주요 흐름, 기본 액션, 신뢰감 있는 UI 구조",
                },
                {
                    "name": "violet",
                    "label": "보라",
                    "hex": "#7c3aed",
                    "bestFor": "AI, 인사이트, 보조 흐름, 창의적인 영역",
                },
                {
                    "name": "green",
                    "label": "초록",
                    "hex": "#16a34a",
                    "bestFor": "성공, 완료, 긍정 상태, 승인 흐름",
                },
                {
                    "name": "yellow",
                    "label": "노랑",
                    "hex": "#facc15",
                    "bestFor": "주의, 대기, 검토 필요, 하이라이트",
                },
                {
                    "name": "red",
                    "label": "빨강",
                    "hex": "#ef4444",
                    "bestFor": "오류, 위험, 실패, 삭제 또는 경고",
                },
            ],
            "generationRules": {
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
                "coordinateSystem": "Canvas page coordinates. If parentId references a frame, child x/y are frame-local coordinates.",
                "preferFrameForGeneratedDraft": True,
                "requiredCreateDraftInput": {
                    "kind": "diagram|code",
                    "title": "short Korean title",
                    "summary": "short Korean summary",
                    "recommendedColors": [
                        {
                            "name": "blue",
                            "label": "파랑",
                            "usage": "핵심 흐름과 주요 화면을 표현합니다.",
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
            },
            "draftKindRules": {
                "chooseExactlyOne": True,
                "priority": ["code", "diagram", "chat"],
                "diagram": (
                    "Choose create_draft kind=diagram for design drafts, flowcharts, wireframes, "
                    "user journeys, structure diagrams, screen layouts, process maps, and visual explanations."
                ),
                "code": (
                    "Choose create_draft kind=code for code generation, multi-file examples, components, hooks, "
                    "APIs, types, snippets, implementation examples, or any request that asks to include code."
                ),
                "chat": (
                    "Choose finish when the user is asking a conversational question, discussing direction, "
                    "or not asking Canvas AI to find, connect, or create Canvas content."
                ),
                "tieBreakers": [
                    "If the prompt asks for code or files, choose code even when notes, labels, or connectors are also useful.",
                    "If the prompt asks for a visual draft without code, choose diagram.",
                    "If the prompt only asks what is possible or asks for an explanation, choose chat and answer with finish.",
                ],
            },
            "draftTemplates": {
                "diagram": {
                    "kind": "diagram",
                    "purpose": "디자인, 흐름도, 와이어프레임, 사용자 여정, 구조도",
                    "layout": "Create one frame as the container, add a clear title, then place tldraw built-in text/note/rectangle/circle/triangle nodes inside it.",
                    "expectedNodes": [
                        "frame: one container frame sized to fit the whole draft",
                        "text: short title or section labels",
                        "rectangle: screens, cards, states, and process steps",
                        "circle: start/end/status/emphasis",
                        "triangle: branches, warnings, or decision markers",
                        "note: short ideas, annotations, or supporting context",
                    ],
                    "expectedConnections": "Use arrow for directed flow and line for undirected relationships when relationships matter.",
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
                    "purpose": "코드블럭 단일/복수 파일, 설명 노트, 파일 간 연결선",
                    "layout": "Create one frame as the container, then create one PILO code block per file or snippet. Add optional tldraw built-in note/text nodes for short explanations.",
                    "expectedNodes": [
                        "frame: one container frame sized to fit all files and notes",
                        "code: one pilo_custom code block for each generated file or snippet",
                        "note: short explanation, setup note, or caveat when useful",
                        "text: section title or file group label when useful",
                    ],
                    "expectedConnections": "Use arrow or line between related code files, for example component -> hook -> api client, or explanation note -> code block.",
                    "fileSplitting": [
                        "If the user asks for multiple files or the implementation naturally has separate responsibilities, split into multiple code nodes.",
                        "If the request is small or explicitly asks for one snippet, use one code node inside the frame.",
                        "Each code node should include title as a file name when possible and language when known.",
                    ],
                    "styleGuidance": [
                        "Keep each code block concise enough to be readable on Canvas.",
                        "Prefer practical, copyable examples over long prose.",
                        "Use recommendedColors to separate main code, helper code, and notes when useful.",
                    ],
                    "exampleRequests": [
                        "JWT 인증 예시 코드 만들어줘",
                        "로그인 컴포넌트랑 훅 파일을 나눠서 만들어줘",
                        "API 호출 코드를 캔버스에 생성해줘",
                    ],
                },
            },
            "allowedActions": [
                {
                    "name": "find_canvas_tool",
                    "input": {"toolTarget": "toolbar.memo", "toolTargetLabel": "Memo"},
                },
                {
                    "name": "find_shapes",
                    "input": {"query": "short keyword", "continuePlanning": "boolean"},
                },
                {"name": "select_shapes", "input": {"shapeIds": ["shape id"]}},
                {"name": "focus_viewport", "input": {"shapeIds": ["shape id"]}},
                {
                    "name": "connect_shapes",
                    "input": {
                        "fromShapeId": "source existing shape id",
                        "toShapeId": "target existing shape id",
                        "connectionKind": "arrow or line",
                        "label": "optional short label",
                    },
                },
                {
                    "name": "create_draft",
                    "input": {
                        "kind": "diagram or code",
                        "title": "short title",
                        "summary": "short summary",
                        "style": "short style",
                        "sourceShapeIds": ["optional selected shape id"],
                        "nodes": ["Canvas nodes using only availableCanvasTools"],
                        "connections": ["Canvas node connections using arrow or line"],
                        "recommendedColors": ["Chosen colors from availableCanvasColors with usage"],
                    },
                },
                {"name": "finish", "input": {"summary": "short result"}},
            ],
        },
        ensure_ascii=False,
    )
