# Canvas Agent API

## Scope

Canvas Agent API creates and tracks asynchronous read-only AI work that is
limited to one Workspace Canvas. It explains Canvas functionality, finds
existing Canvas shapes, selects matching shapes, and moves the current user's
viewport. New runs do not create, connect, update, delete, or duplicate shapes.

Canvas Agent is restricted to Canvas actions. Calendar, Issue, PR, Meeting,
and every other external-domain resource are excluded from this API: it does
not read, create, update, delete, or represent them as Canvas shapes.

## Ownership and boundaries

- Canvas domain owns this API and `canvas_agent_*` tables.
- App Server validates Workspace and Canvas access and validates each read-only
  action. Canvas Agent does not perform persisted Canvas mutations.
- AI Worker only chooses the next bounded Canvas action. It must not directly
  mutate Canvas tables or call Canvas domain services.
- The schema reserves `parentAgentRunId` for a future general-Agent-to-Canvas
  delegation path. That integration is not exposed by this API yet, and it must
  remain Canvas-only when added.
- The requester alone can read or cancel their Canvas Agent runs. Legacy draft
  apply/discard endpoints remain available only for previews created before the
  read-only action restriction.
- AI Worker provider payloads, full raw shapes, tokens, secrets, and credentials
  are never returned or stored in these API payloads.

## Common rules

- Base URL: `/api/v1`
- Authentication: `Authorization: Bearer <pilo_access_token>`
- All endpoints are scoped below `/workspaces/{workspaceId}/canvases/{canvasId}`.
- `workspaceId`, `canvasId`, and requester identity are taken from the path and
  authenticated session, never from the request body.
- A Canvas Agent request is asynchronous. The create endpoint returns without
  waiting for AI Worker planning to finish.
- A run is retained for 7 days. New runs do not create preview drafts.

## Processing model

```text
Frontend -> App Server Canvas Agent API -> Canvas Agent run + SQS job
  -> AI Worker: one next-action decision
  -> App Server: validate and execute Canvas action
  -> result saved to run/step, optionally enqueue next bounded step
  -> completed explanation/search/navigation result
```

For a shape-finding request, Canvas Agent uses this bounded cost-saving route:

```text
Canvas-local text search over current shape title/text/type
  -> local shape-search prototype embedding classifier
  -> Canvas-only pgvector shape search when the prompt is clearly looking for an existing shape
  -> GPT Planner when the prompt is not a shape search, retrieval is absent, or the result is ambiguous
```

- The embedding Worker indexes only `shape_type`, `title`, and `text_content`.
  It never embeds full `raw_shape`, layout, bindings, styles, or provider data.
- Search remains DB/checkpoint based. Disabling Canvas mutations removes the AI
  apply synchronization problem, but it does not make the embedding index a
  Realtime roomState index; a pre-checkpoint edit can become searchable only
  after the normal checkpoint and embedding refresh flow.
- Before embedding, explicit find requests may use bounded DB text
  search against the current canvas' non-deleted shapes. This lets newly
  created or not-yet-embedded shapes be found without waiting for the embedding
  worker, and avoids an LLM/embedding call when the current canvas text is
  already an exact enough match.
- The configured local model is `intfloat/multilingual-e5-small` (384
  dimensions). Queries use `query: ` and indexed Canvas text uses `passage: `.
- The first-pass shape-search classifier uses fixed local prototype examples.
  The default pgvector shape-result thresholds are shape similarity `0.78` and
  winner margin `0.08`. A missing or ambiguous local match falls through to
  GPT Planner.
- Direct shape-search matches are returned as `find_shapes` with
  `focusResult: true`, so the client can move the requester-only Canvas AI
  pointer, zoom to the matching shape area, and highlight the result. Separate
  local `select_shapes` or `focus_viewport` intent classification is not used
  for first-pass routing.
- Each AI Worker decision can choose exactly one action.
- App Server limits a run to its configured maximum number of steps.
- Deterministic toolbar-help actions can skip AI Worker planning only when the
  request explicitly uses tool-help mode.
- Generation or mutation requests finish with a bounded explanation of the
  currently supported read-only feature set.

## Disabled legacy generation contract

`create_draft` is not available to new Canvas Agent runs. The legacy draft
schema below is retained only so existing stored run/draft records and the
legacy apply/discard endpoints remain readable during compatibility cleanup.
AI Worker does not receive this schema or its Canvas generation tool catalog.

Historically, generation requests received the bounded list of Canvas tools
below. This list is no longer included in AI Worker prompts:

| Tool | Source | Draft node/connection kind | Persisted shape |
| --- | --- | --- | --- |
| Frame | `tldraw_builtin` | `frame` | `frame` |
| Memo/card | `tldraw_builtin` | `note` | `note` |
| Text | `tldraw_builtin` | `text` | `text` |
| Rectangle | `tldraw_builtin` | `rectangle` | `geo` with `geo=rectangle` |
| Circle | `tldraw_builtin` | `circle` | `geo` with `geo=ellipse` |
| Triangle | `tldraw_builtin` | `triangle` | `geo` with `geo=triangle` |
| Arrow | `tldraw_builtin` | `arrow` connection | `arrow` |
| Line | `tldraw_builtin` | `line` connection | `arrow` with no arrow head |
| Code block | `pilo_custom` | `code` | `pilo-code-block` |

Before returning a generation action, AI Worker classifies the user request as
exactly one of:

| Draft decision | Result | Use when |
| --- | --- | --- |
| `diagram` | `create_draft.inputJson.kind = "diagram"` | the user asks for a design draft, flowchart, wireframe, user journey, structure diagram, screen layout, process map, or visual explanation |
| `code` | `create_draft.inputJson.kind = "code"` | the user asks for code, files, components, hooks, APIs, types, snippets, implementation examples, or asks to include code |
| `chat` | `finish` | the user is only asking a conversational question or discussing direction, not asking Canvas AI to find, connect, or create Canvas content |

Tie-breaker: code/file requests win over diagram requests, even if the draft
also benefits from notes, labels, and connectors. Visual draft requests without
code use `diagram`. Questions about what is possible or how the feature works
use `finish`.

### Draft templates

`create_draft` has two generation templates.

```text
create_draft
├─ kind: "diagram"
│  └─ design drafts, flowcharts, wireframes, user journeys, structure diagrams
└─ kind: "code"
   └─ single or multi-file code blocks, explanation notes, file-to-file connectors
```

For `kind = "diagram"`, AI Worker should:

- create one `frame` that contains the generated draft;
- use only tldraw built-in nodes: `text`, `note`, `rectangle`, `circle`,
  and `triangle`;
- use `arrow` for directed flow and `line` for non-directional relationships;
- keep visible text short enough to fit the generated shape;
- return `recommendedColors` explaining the small palette used by the draft.

For `kind = "code"`, AI Worker should:

- create one `frame` that contains all generated code and notes;
- create one `pilo-code-block` node per generated file or snippet;
- split into multiple code nodes when the request asks for files or naturally
  separates into responsibilities such as component, hook, API client, type, or
  utility;
- add short tldraw built-in `note` or `text` nodes only when they help explain
  the code;
- connect related files or explanation nodes with `arrow` or `line`;
- return `title` as a file name and `language` when those are known.

AI Worker also receives the bounded Canvas color palette:

| Color name | Label | Intended use |
| --- | --- | --- |
| `default` | 기본 | neutral/default text and ordinary elements |
| `black` | 검정 | strong titles and high-contrast connectors |
| `blue` | 파랑 | primary flow, default action, trustworthy UI structure |
| `violet` | 보라 | AI, insight, or supporting flow |
| `green` | 초록 | success, completion, approved state |
| `yellow` | 노랑 | warning, waiting, review, highlight |
| `red` | 빨강 | error, danger, failure, deletion warning |

`create_draft.inputJson` may include a generated layout plan:

```json
{
  "kind": "diagram",
  "title": "로그인 흐름",
  "summary": "로그인 과정을 Canvas 도구로 배치했습니다.",
  "recommendedColors": [
    {
      "name": "blue",
      "label": "파랑",
      "usage": "핵심 화면과 주요 흐름을 표현합니다."
    },
    {
      "name": "green",
      "label": "초록",
      "usage": "성공 상태를 표현합니다."
    }
  ],
  "nodes": [
    {
      "id": "frame-1",
      "kind": "frame",
      "x": 100,
      "y": 100,
      "width": 720,
      "height": 360,
      "title": "로그인 흐름",
      "color": "blue"
    },
    {
      "id": "step-1",
      "kind": "rectangle",
      "x": 48,
      "y": 120,
      "width": 180,
      "height": 88,
      "title": "로그인 페이지",
      "parentId": "frame-1",
      "color": "blue"
    }
  ],
  "connections": [
    { "id": "arrow-1", "kind": "arrow", "from": "step-1", "to": "step-2" }
  ]
}
```

App Server validates this plan before storing it as `CanvasDraftSpec`:

- maximum 16 nodes and 24 connections;
- only the listed node/connection kinds are accepted;
- `x`, `y`, `width`, and `height` are bounded numbers;
- `parentId` can only reference a generated frame;
- connections must reference generated node ids;
- colors are normalized to the allowed PILO/Tldraw palette;
- `availableColors` is attached to the stored `CanvasDraftSpec`;
- `recommendedColors` is accepted only when each item references an allowed
  color name, otherwise App Server falls back to colors used by the generated
  nodes;
- raw Tldraw shape JSON from AI Worker is ignored and never persisted.

After validation, App Server may translate the whole draft to a nearby empty
Canvas area. It checks existing Canvas shape bounding boxes around the current
viewport and tries candidate positions in this order: visible viewport area,
right/bottom outside the viewport, then nearby grid positions. If no empty
candidate is found, it falls back to the stable viewport-relative default
position instead of changing zoom or sending the draft far away.

App Server converts the validated draft plan into `CanvasService.syncShapesBatch`
operations when the requester applies the draft. The AI Worker decides layout
intent and bounded coordinates; App Server owns raw shape creation and Canvas
validation. `toolSteps` are derived from the validated draft so the frontend can
show the requester-only Canvas AI pointer moving through the corresponding
Canvas tools and placement targets.

The client consumes `toolSteps` in order:

```text
tool step    -> move the private pointer to the toolbar tool
place step   -> move the private pointer to the generated Canvas position
connect step -> move the private pointer to the generated relationship area
```

This animation is local preview/progress only. The actual Canvas mutation still
happens only when the requester applies the draft.

When `presentationMode` is `background`, the server may still store the same
draft and derived `toolSteps` for traceability, but clients must not play the
private Canvas pointer/tool animation. This mode is intended for delegated PILO
AI requests from outside the Canvas surface where the user should receive the
Canvas AI final answer without seeing Canvas-local pointer movement.

## Disabled legacy connection contract

`connect_shapes` is not available to new Canvas Agent runs. It is treated as a
shape-creation action because it inserts a new arrow/line shape. App Server
rejects any queued or externally supplied legacy `connect_shapes` step before
it reaches the Canvas batch mutation path. The historical contract below is
retained only as migration context.

Historically, `connect_shapes` connected two shapes that already existed on the Canvas.
Embedding is used only to identify the two shape ids. The App Server owns the
write operation, endpoint authorization, coordinate calculation, raw Tldraw
arrow payload, and `CanvasService.syncShapesBatch` call.

```json
{
  "actionName": "connect_shapes",
  "inputJson": {
    "fromShapeId": "shape:login",
    "toShapeId": "shape:auth",
    "connectionKind": "arrow",
    "label": null
  }
}
```

- `connectionKind` is `arrow` by default and `line` when the user asks for a
  plain line.
- When exactly two shapes are selected and the prompt says to connect them,
  App Server can create this action without AI Worker planning.
- The action creates one new connection shape. It does not modify or delete the
  two existing target shapes.
- If the target shapes are not found, are the same shape, or semantic matching
  is ambiguous, the action is not executed automatically.

## Deterministic toolbar-help route

Before AI Worker planning, App Server may route built-in Canvas toolbar/help
requests by keyword. Tool location/explanation matching only runs when
`toolHelpMode` is `true`, but broad capability prompts such as `기능`,
`기능 목록`, or `뭐 할 수 있어?` may return the Canvas tool overview directly
without AI Worker planning. Normal Canvas AI chat does not use App Server
keyword matching for shape search or selection. Mutation and generation
requests are deterministically finished with the read-only capability notice.

| Intent | Keywords and examples | Action |
| --- | --- | --- |
| Find a Canvas toolbar tool | `도구`, `툴`, `툴바`, `기능`, `버튼`, `아이콘`, `어디`, `위치`, `찾아줘`, `보여줘`, `알려줘`, `사용법`, `어떻게` plus a known tool name<br>`메모 도구 어디 있어?`, `색상 변경 기능 알려줘`, `프레임은 어떻게 써?` | `find_canvas_tool` with `progress.toolTarget` |

External-domain words can still appear as ordinary Canvas text search terms.
For example, `이슈 메모 찾아줘` may search Canvas shape text through the
AI Worker shape-search classifier. App Server does not reject external-domain
phrases by keyword before planning; requests outside the Canvas action schema
fall through the normal AI Worker route and must still resolve to bounded
Canvas-only actions or a `finish` response.

Basic Canvas tool discovery uses `progress.toolTarget` so the client can move
the requester-only Canvas AI pointer to the matching toolbar button and draw a
temporary highlight ring. The pointer should animate from the previous pointer
position or the Canvas AI button toward the target; it should not appear as an
instant jump. If the target is inside a toolbar submenu, the client opens the
parent menu first and then moves the pointer to the detailed tool button. In
local/mock mode the frontend can run the same hard-coded tool lookup without
App Server.

Basic Canvas tool targets:

| Tool target | Aliases and example prompts |
| --- | --- |
| `toolbar.select` | `선택`, `셀렉트`, `포인터`, `커서`<br>`선택 도구 어디 있어?`, `선택 기능 보여줘` |
| `toolbar.memo` | `메모`, `노트`, `포스트잇`, `sticky note`<br>`메모 도구 어디 있어?`, `노트 추가 기능 찾아줘` |
| `toolbar.frame` | `프레임`, `frame`, `영역`, `묶기`<br>`프레임 기능 보여줘`, `프레임 도구 위치 알려줘` |
| `toolbar.code` | `코드블럭`, `코드 블록`, `code block`<br>`코드 블록 도구 어디 있어?` |
| `toolbar.text` | `텍스트`, `text`, `글자`<br>`텍스트 도구 알려줘` |
| `toolbar.line` | `연결선`, `커넥터`, `화살표/선`, `선 도구`<br>`연결선 기능 찾아줘` |
| `toolbar.line.arrow` | `화살표`, `arrow`<br>`화살표 도구 어디 있어?` |
| `toolbar.line.line` | `직선`, `line`, `선`<br>`직선 도구 보여줘` |
| `toolbar.draw` | `그리기`, `드로잉`, `draw`, `도형`, `shape`, `마름모`<br>`도형 기능 보여줘` |
| `toolbar.draw.pen` | `펜`, `pen`, `자유선`<br>`펜 기능 어디 있어?` |
| `toolbar.draw.highlight` | `형광펜`, `하이라이터`, `highlighter`, `강조펜`<br>`형광펜 도구 찾아줘` |
| `toolbar.draw.eraser` | `지우개`, `eraser`<br>`지우개 어디 있어?` |
| `toolbar.draw.rectangle` | `사각형`, `네모`, `rectangle`<br>`사각형 도구 어디 있어?` |
| `toolbar.draw.circle` | `원`, `동그라미`, `circle`<br>`원 도형 보여줘` |
| `toolbar.draw.triangle` | `삼각형`, `triangle`<br>`삼각형 도구 찾아줘` |
| `toolbar.color` | `색상`, `컬러`, `색`, `팔레트`, `스와치`<br>`색상 변경 어디 있어?`, `컬러 선택 기능 보여줘` |
| `toolbar.more` | `더보기`, `추가 기능`, `플러스`, `메뉴`<br>`더보기 도구 보여줘`, `추가 기능 어디 있어?` |
| `toolbar.more.image` | `이미지`, `image`, `사진`<br>`이미지 기능 어디 있어?` |
| `toolbar.more.video` | `비디오`, `video`, `영상`<br>`비디오 기능 보여줘` |
| `toolbar.more.bookmark` | `북마크`, `bookmark`, `링크 카드`<br>`북마크 기능 어디 있어?` |
| `toolbar.more.embed` | `임베드`, `embed`, `iframe`, `아이프레임`<br>`임베드 도구 찾아줘` |
| `toolbar.more.group` | `그룹`, `group`, `그룹화`<br>`그룹 기능 어디 있어?` |
| `toolbar.fit` | `화면 맞춤`, `전체 보기`, `줌 맞춤`<br>`화면 맞춤 어디 있어?` |
| `toolbar.canvas_ai` | `AI`, `Canvas AI`, `캔버스 AI`, `채팅`, `도움`, `C`<br>`캔버스 AI 버튼 어디 있어?` |

## Status values

### CanvasAgentRun status

| Value | Meaning |
| --- | --- |
| `queued` | Run was created and is waiting for an App Server or AI Worker step. |
| `planning` | AI Worker is selecting the next Canvas action. |
| `executing` | App Server is validating or executing the selected action. |
| `draft_ready` | Legacy status for a requester-only preview created before generation was disabled. |
| `completed` | The requested work finished. |
| `failed` | The run cannot continue because of an unrecoverable error. |
| `cancelled` | The requester cancelled the run. |
| `expired` | The retention period elapsed. |

### Legacy CanvasAgentDraft status

| Value | Meaning |
| --- | --- |
| `preview` | Draft is visible only to its requester and has not changed the Canvas. |
| `applied` | The requester applied the draft through `CanvasService`. |
| `discarded` | The requester discarded the draft. |
| `expired` | The preview retention period elapsed. |

## API list

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs` | Create an asynchronous Canvas Agent run. |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs/{runId}` | Get a requester-owned run and bounded step summaries. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs/{runId}/cancel` | Cancel a queued, planning, or executing run. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/apply` | Legacy compatibility: apply a requester-owned preview created before generation was disabled. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/discard` | Legacy compatibility: discard a requester-owned preview created before generation was disabled. |

## Create Canvas Agent run

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs
```

Request:

```json
{
  "prompt": "로그인 관련 메모 찾아줘",
  "selectedShapeIds": ["shape:note-1", "shape:note-2"],
  "viewport": {
    "x": 0,
    "y": 0,
    "width": 1440,
    "height": 900
  },
  "presentationMode": "interactive",
  "toolHelpMode": false,
  "conversationContext": {
    "messages": [
      { "role": "user", "content": "인증 메모 찾아줘" },
      { "role": "assistant", "content": "관련 도형 2개를 찾았어요." }
    ],
    "lastTask": {
      "prompt": "인증 메모 찾아줘",
      "status": "completed",
      "summary": "관련 도형 2개를 찾았어요.",
      "draftId": null,
      "draftTitle": null
    }
  },
  "clientRequestId": "canvas-ai-20260710-0001"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | Trimmed user request, 1 to 32768 bytes. |
| `selectedShapeIds` | No | Current Canvas selection. Every id must belong to the path Canvas. |
| `viewport` | No | Current visible Canvas bounds used only to create minimal planning context. |
| `presentationMode` | No | `interactive` shows requester-only progress, pointer, highlight, and viewport focus on the Canvas surface. `background` creates the same read-only run without Canvas-local playback. Defaults to `interactive`. |
| `toolHelpMode` | No | When `true`, route the prompt to the built-in Canvas toolbar/help dictionary instead of Canvas content search or planner routing. Defaults to `false`. |
| `conversationContext` | No | Short-lived same-panel chat memory. `messages` contains up to 10 recent user/assistant messages, and `lastTask` can describe the previous Canvas Agent run for follow-up prompts. Legacy draft id/title fields remain nullable for compatibility. |
| `clientRequestId` | No | Stable retry idempotency key, up to 128 bytes. |

Server rules:

- The server checks Workspace membership and Canvas ownership before creating a run.
- The server captures the Canvas `latestOpSeq` as `canvasRevision`.
- Built-in tool/help matching is only deterministic when `toolHelpMode` is
  `true`. Normal Canvas AI chat requests continue through Canvas content
  search, semantic routing, or planner routing.
- `conversationContext` is advisory context only. The current `prompt` remains
  authoritative, and the server stores the context inside the run `context_json`
  without requiring a DB schema change.
- Repeating the same requester, Canvas, and `clientRequestId` returns the
  existing run and does not enqueue another job.
- Reusing a `clientRequestId` with different request content returns
  `409 CLIENT_REQUEST_ID_CONFLICT`.
- The App Server constructs a bounded shape summary before enqueueing an AI job;
  it must not send a complete raw Canvas snapshot by default.

Response: `202 Accepted`

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "canvas_agent_run_uuid",
      "workspaceId": "workspace_uuid",
      "canvasId": "canvas_uuid",
      "presentationMode": "interactive",
      "status": "queued",
      "prompt": "로그인 관련 메모 찾아줘",
      "message": "Canvas AI 요청을 준비하고 있습니다.",
      "createdAt": "2026-07-10T00:00:00.000Z",
      "completedAt": null
    }
  }
}
```

Main errors: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`,
`404 CANVAS_NOT_FOUND`, `409 CLIENT_REQUEST_ID_CONFLICT`,
`503 SERVICE_UNAVAILABLE`.

## Get Canvas Agent run

```http
GET /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs/{runId}
```

Only the requester can read a run. The response includes bounded summaries and
resource ids, not raw shape payloads or AI provider output.

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "canvas_agent_run_uuid",
      "workspaceId": "workspace_uuid",
      "canvasId": "canvas_uuid",
      "presentationMode": "interactive",
      "status": "completed",
      "prompt": "로그인 메모 찾아줘",
      "summary": "임베딩 검색으로 ‘로그인 메모’ 관련 도형 2개를 찾았습니다.",
      "canvasRevision": 103,
      "createdAt": "2026-07-10T00:00:00.000Z",
      "completedAt": null
    },
    "steps": [
      {
        "id": "canvas_agent_step_uuid",
        "order": 1,
        "actionName": "find_shapes",
        "status": "completed",
        "resourceRefs": ["shape:login", "shape:auth"],
        "completedAt": "2026-07-10T00:00:03.000Z"
      }
    ],
    "drafts": []
  }
}
```

Main errors: `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 CANVAS_AGENT_RUN_NOT_FOUND`.

## Cancel Canvas Agent run

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs/{runId}/cancel
```

Only the requester can cancel a non-terminal run. A cancelled run prevents the
App Server from executing future actions even if a previously queued AI Worker
job is delivered later.

Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "run": {
      "id": "canvas_agent_run_uuid",
      "status": "cancelled",
      "completedAt": "2026-07-10T00:00:02.000Z"
    }
  }
}
```

## Apply legacy Canvas Agent draft

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/apply
```

Request:

```json
{
  "clientOperationId": "canvas-ai-apply-20260710-0001"
}
```

New runs cannot create this preview. For compatibility, the requester can apply
only an existing `preview` draft. App Server validates the draft,
checks that referenced source shapes still exist, and persists resulting shapes
through the existing Canvas batch mutation flow.

If the source Canvas state is no longer compatible with the draft, the server
returns `409 CANVAS_AGENT_DRAFT_STALE`; it does not partially apply the draft.

Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "draft": {
      "id": "canvas_agent_draft_uuid",
      "status": "applied",
      "appliedShapeIds": ["shape:frame-1", "shape:note-3", "shape:arrow-1"],
      "appliedAt": "2026-07-10T00:00:05.000Z"
    },
    "latestOpSeq": 106
  }
}
```

Main errors: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`,
`404 CANVAS_AGENT_DRAFT_NOT_FOUND`, `409 CANVAS_AGENT_DRAFT_STALE`,
`409 CANVAS_AGENT_DRAFT_NOT_PREVIEW`.

## Discard legacy Canvas Agent draft

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/discard
```

New runs cannot create this preview. Only the requester can discard an existing
legacy `preview` draft. Discarding a draft does not change Canvas shapes.

Response: `200 OK`

```json
{
  "success": true,
  "data": {
    "draft": {
      "id": "canvas_agent_draft_uuid",
      "status": "discarded"
    }
  }
}
```

## Private progress display

The requesting Canvas client polls the run detail endpoint while a run is
non-terminal. A response may include `progress` with a message, highlighted
shape ids, and an optional target viewport. The client renders any virtual
pointer and selection highlight locally; it does not publish those
values through shared Canvas presence or store pointer coordinates in the DB.

## Initial action set

```text
find_shapes
select_shapes
focus_viewport
find_canvas_tool
finish
```

`connect_shapes` and `create_draft` are rejected by both AI Worker planning and
App Server execution. Legacy `apply_draft` and `discard_draft` remain
requester-only compatibility API operations, not AI Worker-planned actions.

New Canvas actions require an input/output schema, App Server validation and
executor, and documentation update. Canvas Agent actions must stay Canvas-only;
adding Calendar, Issue, PR, Meeting, or any external-domain read/write/Canvas
representation is out of scope for this API.
