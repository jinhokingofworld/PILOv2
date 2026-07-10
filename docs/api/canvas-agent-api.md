# Canvas Agent API

## Scope

Canvas Agent API creates and tracks asynchronous AI work that is limited to one
Workspace Canvas. It supports finding Canvas shapes, moving the current user's
viewport, preparing design or code-block drafts, and applying or discarding a
draft.

Canvas Agent is restricted to Canvas actions. Calendar, Issue, PR, Meeting,
and every other external-domain resource are excluded from this API: it does
not read, create, update, delete, or represent them as Canvas shapes.

## Ownership and boundaries

- Canvas domain owns this API and `canvas_agent_*` tables.
- App Server validates Workspace and Canvas access, validates each action, and
  performs persisted Canvas mutations through `CanvasService`.
- AI Worker only chooses the next bounded Canvas action. It must not directly
  mutate Canvas tables or call Canvas domain services.
- The schema reserves `parentAgentRunId` for a future general-Agent-to-Canvas
  delegation path. That integration is not exposed by this API yet, and it must
  remain Canvas-only when added.
- The requester alone can read, cancel, apply, or discard their Canvas Agent
  runs and drafts.
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
- Canvas Agent has no confirmation table. A draft is not persisted to the
  Canvas until its requester calls the apply endpoint.
- A successfully applied GPT draft may create one `pending` personal expression
  memory. It becomes eligible for automatic local routing only after the same
  user explicitly approves it.
- A run is retained for 7 days and a preview draft for 24 hours.

## Processing model

```text
Frontend -> App Server Canvas Agent API -> Canvas Agent run + SQS job
  -> AI Worker: one next-action decision
  -> App Server: validate and execute Canvas action
  -> result saved to run/step, optionally enqueue next bounded step
  -> draft preview or completed result
```

For a shape-finding request, Canvas Agent uses this bounded cost-saving route:

```text
exact title/text ILIKE match
  -> local multilingual embedding + Canvas-only pgvector search when ILIKE has no match
  -> GPT Planner only when retrieval is absent or ambiguous
```

- The embedding Worker indexes only `shape_type`, `title`, and `text_content`.
  It never embeds full `raw_shape`, layout, bindings, styles, or provider data.
- Active expression memories are per-user and per-Workspace. They are never
  shared with other Workspace members.
- The configured local model is `intfloat/multilingual-e5-small` (384
  dimensions). Queries use `query: ` and indexed Canvas text uses `passage: `.
- The default local-route thresholds are shape similarity `0.78`, intent
  similarity `0.90`, and winner margin `0.08`. A missing or ambiguous local
  match falls through to GPT Planner.

- Each AI Worker decision can choose exactly one action.
- App Server limits a run to its configured maximum number of steps.
- Deterministic actions such as selecting known shape ids or moving a viewport
  can skip AI Worker planning.
- A draft is generated from `CanvasDraftSpec`; the AI Worker must not generate
  raw Tldraw shapes.

## Deterministic keyword route

Before AI Worker planning, App Server may route clear Canvas-only requests by
keyword. This route is intentionally limited to actions that are cheap and
safe to infer without provider reasoning.

| Intent | Keywords and examples | Action |
| --- | --- | --- |
| Find a Canvas toolbar tool | `도구`, `툴`, `툴바`, `기능`, `버튼`, `아이콘`, `어디`, `위치`, `찾아줘`, `보여줘`, `알려줘`, `사용법`, `어떻게` plus a known tool name<br>`메모 도구 어디 있어?`, `색상 변경 기능 알려줘`, `프레임은 어떻게 써?` | `find_canvas_tool` with `progress.toolTarget` |
| Find Canvas shapes | `찾아줘`, `찾아`, `검색`, `어디`, `위치`, `어딨어`, `보여줘`, `보여`, `하이라이트`, `강조`<br>`ERD 찾아줘`, `JWT 관련 메모 보여줘`, `온보딩 화면 강조해줘` | `find_shapes` |
| Move to a shape area | `이동`, `가줘`, `줌인`, `확대`, `가운데로`, `포커스`<br>`ERD 쪽으로 가줘`, `로그인 플로우 가운데로 보여줘` | `find_shapes` with `focusResult: true`, or `focus_viewport` for selected shapes |
| Select or highlight shapes | `선택`, `잡아줘`, `골라줘`, `체크`, `하이라이트`, `강조`<br>`JWT 관련 도형 선택해줘`, `와이어프레임 카드들 골라줘` | `select_shapes` |
| Organize selected shapes | `정리`, `묶어`, `그룹`, `프레임`, `보기 좋게`, `정돈`, `배열`, `정렬`, `구조`, `깔끔`<br>`선택한 메모들 정리해줘`, `이 카드들 프레임으로 묶어줘` | `create_draft` with `kind: organize` |
| Design or diagram draft | `초안`, `만들어`, `그려`, `다이어그램`, `플로우`, `흐름`, `구조도`, `관계도`, `사용자 여정`, `와이어프레임`, `화면 설계`<br>`로그인 흐름 다이어그램 만들어줘`, `대시보드 와이어프레임 초안 만들어줘` | AI Worker planner chooses a Canvas draft action |
| Code block draft | `코드`, `예시 코드`, `샘플 코드`, `구현 예시`, `함수`, `컴포넌트`, `API 예시`, `타입`, `인터페이스`<br>`JWT 검증 예시 코드 만들어줘`, `React 버튼 컴포넌트 코드 블록으로 만들어줘` | AI Worker planner chooses `create_code_block` |

External-domain words can still appear as ordinary Canvas text search terms.
For example, `이슈 메모 찾아줘` may search Canvas shape text. Requests that
ask Canvas AI to fetch, list, create, update, or represent external-domain data
are rejected in the deterministic route. Examples: `캘린더 일정 불러와`,
`PR 목록 가져와`, `회의록 조회해서 캔버스에 보여줘`.

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
| `draft_ready` | A requester-only preview draft is ready. |
| `completed` | The requested work finished. |
| `failed` | The run cannot continue because of an unrecoverable error. |
| `cancelled` | The requester cancelled the run. |
| `expired` | The retention period elapsed. |

### CanvasAgentDraft status

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
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs/{runId}/intent-examples` | Create a pending personal expression-memory candidate from a completed planner result. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/apply` | Apply a requester-owned preview draft to the Canvas. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/discard` | Discard a requester-owned preview draft. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-intent-examples/{intentExampleId}/approve` | Activate a prepared pending personal expression memory. |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/agent-intent-examples/{intentExampleId}/reject` | Reject a pending personal expression memory. |

## Create Canvas Agent run

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-runs
```

Request:

```json
{
  "prompt": "선택한 메모를 발표용 흐름도로 정리해줘",
  "selectedShapeIds": ["shape:note-1", "shape:note-2"],
  "viewport": {
    "x": 0,
    "y": 0,
    "width": 1440,
    "height": 900
  },
  "toolHelpMode": false,
  "clientRequestId": "canvas-ai-20260710-0001"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | Trimmed user request, 1 to 32768 bytes. |
| `selectedShapeIds` | No | Current Canvas selection. Every id must belong to the path Canvas. |
| `viewport` | No | Current visible Canvas bounds used only to create minimal planning context. |
| `toolHelpMode` | No | When `true`, route the prompt to the built-in Canvas toolbar/help dictionary instead of Canvas content search or planner routing. Defaults to `false`. |
| `clientRequestId` | No | Stable retry idempotency key, up to 128 bytes. |

Server rules:

- The server checks Workspace membership and Canvas ownership before creating a run.
- The server captures the Canvas `latestOpSeq` as `canvasRevision`.
- Built-in tool/help matching is only deterministic when `toolHelpMode` is
  `true`. Normal Canvas AI chat requests continue through Canvas content
  search, semantic routing, or planner routing.
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
      "status": "queued",
      "prompt": "선택한 메모를 발표용 흐름도로 정리해줘",
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
      "status": "draft_ready",
      "prompt": "선택한 메모를 발표용 흐름도로 정리해줘",
      "summary": "메모 2개를 발표용 흐름도 초안으로 정리했습니다.",
      "canvasRevision": 103,
      "createdAt": "2026-07-10T00:00:00.000Z",
      "completedAt": null
    },
    "steps": [
      {
        "id": "canvas_agent_step_uuid",
        "order": 1,
        "actionName": "create_draft",
        "status": "completed",
        "resourceRefs": ["canvas_agent_draft_uuid"],
        "completedAt": "2026-07-10T00:00:03.000Z"
      }
    ],
    "drafts": [
      {
        "id": "canvas_agent_draft_uuid",
        "status": "preview",
        "summary": "문제 → 해결 → 기대 효과 흐름",
        "expiresAt": "2026-07-11T00:00:03.000Z"
      }
    ],
    "intentExamples": [
      {
        "id": "canvas_agent_intent_example_uuid",
        "intent": "create_draft",
        "status": "pending",
        "embeddingStatus": "completed",
        "createdAt": "2026-07-10T00:00:05.000Z",
        "reviewedAt": null,
        "expiresAt": "2026-08-09T00:00:05.000Z"
      }
    ],
    "canRememberIntent": false
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

## Apply Canvas Agent draft

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/apply
```

Request:

```json
{
  "clientOperationId": "canvas-ai-apply-20260710-0001"
}
```

The requester can apply only a `preview` draft. App Server validates the draft,
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

When the applied draft came from a GPT Planner action that can safely be reused,
the response additionally contains a pending `intentExample`. For a completed
non-draft planner result, `GET` returns `canRememberIntent: true` until the
requester calls the run intent-example endpoint. The client polls until
`embeddingStatus` becomes `completed`, then the requester may approve or
reject it. A pending or rejected example never affects routing.

Main errors: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`,
`404 CANVAS_AGENT_DRAFT_NOT_FOUND`, `409 CANVAS_AGENT_DRAFT_STALE`,
`409 CANVAS_AGENT_DRAFT_NOT_PREVIEW`.

## Review personal expression memory

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-intent-examples/{intentExampleId}/approve
```

Only the requester who created the candidate can approve it. The server permits
approval only while the candidate is `pending` and its local embedding is
prepared. Otherwise it returns `409 CANVAS_AGENT_INTENT_NOT_READY` or
`409 CANVAS_AGENT_INTENT_NOT_REVIEWABLE`.

```json
{
  "success": true,
  "data": {
    "intentExample": {
      "id": "canvas_agent_intent_example_uuid",
      "intent": "create_draft",
      "status": "active",
      "embeddingStatus": "completed"
    }
  }
}
```

Use the same path with `/reject` to permanently reject the pending candidate.

## Discard Canvas Agent draft

```http
POST /api/v1/workspaces/{workspaceId}/canvases/{canvasId}/agent-drafts/{draftId}/discard
```

Only the requester can discard a `preview` draft. Discarding a draft does not
change Canvas shapes.

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
pointer, selection highlight, and preview locally; it does not publish those
values through shared Canvas presence or store pointer coordinates in the DB.

## Initial action set

```text
find_shapes
select_shapes
focus_viewport
create_draft
create_code_block
find_canvas_tool
finish
```

`apply_draft` and `discard_draft` are requester-only API operations, not AI
Worker-planned actions.

New Canvas actions require an input/output schema, App Server validation and
executor, and documentation update. Canvas Agent actions must stay Canvas-only;
adding Calendar, Issue, PR, Meeting, or any external-domain read/write/Canvas
representation is out of scope for this API.
