from __future__ import annotations

AVAILABLE_CANVAS_TOOLS: list[dict[str, object]] = [
    {
        "tool": "frame",
        "source": "tldraw_builtin",
        "nodeKind": "frame",
        "shapeType": "frame",
        "description": (
            "Use the tldraw built-in frame tool to group generated content into " "one visual area."
        ),
        "supportsText": True,
        "supportsParenting": False,
    },
    {
        "tool": "note",
        "source": "tldraw_builtin",
        "nodeKind": "note",
        "shapeType": "note",
        "description": (
            "Use the tldraw built-in note tool for short ideas, steps, labels, "
            "and quick annotations."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "text",
        "source": "tldraw_builtin",
        "nodeKind": "text",
        "shapeType": "text",
        "description": (
            "Use the tldraw built-in text tool for plain titles, captions, and " "annotations."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "rectangle",
        "source": "tldraw_builtin",
        "nodeKind": "rectangle",
        "shapeType": "geo",
        "geo": "rectangle",
        "description": (
            "Use the tldraw built-in rectangle tool for screens, cards, states, "
            "and process steps."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "circle",
        "source": "tldraw_builtin",
        "nodeKind": "circle",
        "shapeType": "geo",
        "geo": "ellipse",
        "description": (
            "Use the tldraw built-in ellipse tool for start/end states, status, " "or emphasis."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "triangle",
        "source": "tldraw_builtin",
        "nodeKind": "triangle",
        "shapeType": "geo",
        "geo": "triangle",
        "description": (
            "Use the tldraw built-in triangle geo tool for branches, warnings, "
            "or decision markers."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "arrow",
        "source": "tldraw_builtin",
        "connectionKind": "arrow",
        "shapeType": "arrow",
        "description": (
            "Use the tldraw built-in arrow tool for directed relationships " "between nodes."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "line",
        "source": "tldraw_builtin",
        "connectionKind": "line",
        "shapeType": "arrow",
        "description": (
            "Use the tldraw built-in line-style connector for undirected visual " "connections."
        ),
        "supportsText": True,
        "supportsParenting": True,
    },
    {
        "tool": "code",
        "source": "pilo_custom",
        "nodeKind": "code",
        "shapeType": "pilo-code-block",
        "description": "Use the PILO custom code block shape for concise implementation examples.",
        "supportsText": True,
        "supportsParenting": True,
    },
]

AVAILABLE_CANVAS_COLORS: list[dict[str, str]] = [
    {
        "name": "default",
        "label": "기본",
        "hex": "#111827",
        "bestFor": "Default text, neutral content, and connectors that do not need emphasis.",
    },
    {
        "name": "black",
        "label": "검정",
        "hex": "#111827",
        "bestFor": "Strong titles, important connectors, and high-contrast elements.",
    },
    {
        "name": "blue",
        "label": "파랑",
        "hex": "#3858f6",
        "bestFor": "Primary flows, main actions, screens, and reliable UI structure.",
    },
    {
        "name": "violet",
        "label": "보라",
        "hex": "#7c3aed",
        "bestFor": "AI, insights, support flows, and creative or secondary areas.",
    },
    {
        "name": "green",
        "label": "초록",
        "hex": "#16a34a",
        "bestFor": "Success, completion, positive states, and confirmed flows.",
    },
    {
        "name": "yellow",
        "label": "노랑",
        "hex": "#facc15",
        "bestFor": "Warnings, pending items, open questions, and highlights.",
    },
    {
        "name": "red",
        "label": "빨강",
        "hex": "#ef4444",
        "bestFor": "Errors, risk, failure, blockers, and warnings.",
    },
]

ALLOWED_ACTIONS: list[dict[str, object]] = [
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
]
