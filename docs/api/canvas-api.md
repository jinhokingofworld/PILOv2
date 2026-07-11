# Freeform Canvas API

## 범위

Canvas API는 사용자가 직접 편집하는 자유형 캔버스를 담당한다.

- Workspace canvas 목록, 생성, 상세 조회
- 자유 도형 viewport 조회, 상세 조회, 생성, 수정, 삭제
- 화면 위치 저장
- 캔버스 입장/퇴장 user state
- 캔버스 shape operation catch-up과 realtime presence 계약

PR 리뷰 canvas data, GitHub data, 회의, 캘린더 일정은 이 문서의 범위가 아니다.

## 데이터 규칙

- `canvas` 테이블은 canvas metadata와 viewport 값을 저장한다.
- `canvas.latest_op_seq`는 해당 canvas에서 마지막으로 확정된 shape operation 순번이다.
- `canvas_freeform_shapes` 테이블은 사용자가 만든 shape data를 저장한다.
- `canvas_freeform_shapes.parent_shape_id`는 Frame 내부 shape lazy loading을 위한
  즉시 부모 shape id다. 값이 `null`이면 Canvas 최상위 shape다.
  이 컬럼은 `016_canvas_shape_parent_relation.sql` migration에서 추가된다.
- `canvas_shape_operations` 테이블은 shape 변경 이력을 `opSeq` 순서로 저장한다. Socket.IO는 빠른 전달 통로이고, 누락 복구와 순서 기준은 이 operation log다.
- `canvas_user_states.last_seen_at`은 presence/session 활동 시각을 기록한다. cursor 좌표와 selection은 realtime-only 상태이며 DB에 저장하지 않는다.
- Shape id는 client-generated text id다.
- Shape 삭제 API는 `deleted_at`을 사용하는 soft delete다. Canvas 퇴장 API는 동시편집 catch-up을 깨지 않도록 soft-deleted shape를 즉시 영구 삭제하지 않는다.
- 서버는 저장된 shape content 기준으로 `contentHash`를 계산한다. 기준 content는
  `shapeType`, `parentShapeId`, `title`, `textContent`, `x`, `y`, `width`,
  `height`, `rotation`, `zIndex`, `rawShape`다.
- 서버는 shape 생성 시 `revision = 1`을 부여하고, 수정/삭제 시 revision을 1씩
  증가시킨다. 클라이언트는 `contentHash`와 `revision`으로 응답 최신성과 content
  변경 여부를 판단한다.
- 모든 create/update/delete/batch mutation은 shape row 변경, `canvas.latest_op_seq`
  증가, `canvas_shape_operations` insert를 같은 transaction 안에서 처리한다.
- `clientOperationId`는 frontend retry/idempotency 기준이다. Realtime canvas client는
  요청마다 stable `clientOperationId`를 보내야 한다. 기존 client, 다른 canvas engine,
  PR Review 호환을 위해 API level에서는 선택값으로 둔다. 없으면 서버가 값을 생성해서
  operation log에 저장한다. 같은 canvas, 같은 actor, 같은 `clientOperationId`가 다시 오면
  서버는 operation을 중복 생성하지 않고 기존 처리 결과를 반환한다. 클라이언트가 값을
  보내지 않아 서버가 생성한 요청은 retry idempotency를 완전하게 보장하지 않는다.
- 이 API의 `board_type`은 `freeform`이다. `review`는 PR 리뷰 화면 의미로 예약되어 있으며 여기서 관리하지 않는다.
- MVP에는 tldraw sync, Yjs/CRDT, shape lock, viewer-only role, 복잡한 conflict UI가 없다.

## DB Schema 추가

`canvas` 추가 컬럼:

| 컬럼 | 역할 |
| --- | --- |
| `latest_op_seq` | 해당 canvas에서 마지막으로 확정된 operation 순번. mutation transaction에서 canvas row를 `FOR UPDATE`로 잠그고 증가시킨다. |

`canvas_freeform_shapes` 추가 컬럼:

| 컬럼 | 역할 |
| --- | --- |
| `parent_shape_id` | Frame 내부 shape lazy loading을 위한 즉시 부모 shape id. 최상위 shape는 `null`이다. |

`canvas_shape_operations`:

| 컬럼 | 역할 |
| --- | --- |
| `id` | operation row 고유 id |
| `workspace_id` | Workspace 접근 검증과 조회 범위 |
| `canvas_id` | operation이 속한 canvas |
| `shape_id` | 대상 shape의 client-generated id. operation log가 shape cleanup보다 오래 남을 수 있으므로 shape FK로 묶지 않는다. |
| `actor_user_id` | operation을 만든 사용자. client payload가 아니라 bearer session에서 얻은 user id |
| `operation_type` | `create`, `update`, `delete` 중 하나 |
| `op_seq` | canvas 안에서 단조 증가하는 operation 순번 |
| `client_operation_id` | operation idempotency key. realtime client가 보내지 않으면 서버가 생성해서 저장 |
| `base_revision` | 클라이언트가 알고 있던 저장 전 shape revision. 없을 수 있다. |
| `result_revision` | operation 적용 후 shape revision |
| `content_hash` | operation 적용 후 shape content hash |
| `payload` | MVP snapshot payload. create/update는 최신 rawShape snapshot, delete는 삭제 metadata |
| `created_at` | operation 생성 시각 |

`canvas_shape_operations` 제약/인덱스:

- `UNIQUE (canvas_id, op_seq)`
- `UNIQUE (canvas_id, actor_user_id, client_operation_id)`
- `INDEX (canvas_id, created_at)`
- `INDEX (shape_id)`
- `INDEX (actor_user_id)`
- `INDEX (workspace_id, canvas_id)`

`canvas_freeform_shapes` 추가 인덱스:

- `INDEX canvas_freeform_shapes(canvas_id, parent_shape_id) WHERE deleted_at IS NULL`

`canvas_user_states` 추가 컬럼:

| 컬럼 | 역할 |
| --- | --- |
| `last_seen_at` | Canvas presence/session의 마지막 활동 시각. cursor 좌표와 selection은 저장하지 않는다. |

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/canvases` | Workspace canvas 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases` | Canvas 생성 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}` | Canvas metadata와 저장된 viewport 조회 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes` | Viewport bounds 기준 shape summary 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes` | Shape 생성 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes/batch` | Shape 변경 batch 저장 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}/operations` | `afterSeq` 이후 shape operation catch-up |
| `GET` | `/workspaces/{workspaceId}/canvas-shapes/{shapeId}` | Shape 상세 조회 |
| `PATCH` | `/workspaces/{workspaceId}/canvas-shapes/{shapeId}` | Shape 수정 |
| `DELETE` | `/workspaces/{workspaceId}/canvas-shapes/{shapeId}` | Shape soft delete |
| `PUT` | `/workspaces/{workspaceId}/canvases/{canvasId}/view-settings` | Viewport 저장 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/enter` | 현재 사용자 입장 기록 |
| `PATCH` | `/workspaces/{workspaceId}/canvases/{canvasId}/leave` | 현재 사용자 퇴장 기록 |

## Canvas 생성

```json
{
  "title": "Untitled canvas"
}
```

서버는 별도 확장이 생기기 전까지 `boardType`을 `freeform`으로 저장한다.

## Shape Payload

```json
{
  "id": "shape_client_id",
  "parentShapeId": null,
  "shapeType": "note",
  "title": "Decision",
  "textContent": "Ship MVP with all-deny RLS",
  "x": 120,
  "y": 80,
  "width": 240,
  "height": 120,
  "rotation": 0,
  "zIndex": 10,
  "childShapeCount": 0,
  "rawShape": {}
}
```

`parentShapeId`는 Frame 안에 들어있는 shape의 즉시 부모 Frame shape id다. 최상위
shape는 `null`이다. `childShapeCount`는 Frame summary 표시를 위한 값이며,
Frame이 아닌 shape에서는 `0` 또는 생략할 수 있다.
클라이언트는 tldraw page parent id(`page:*`)를 `parentShapeId`로 보내지 않고
최상위 shape처럼 `null`로 정규화한다.

Frame과 Code Block 접힘 상태는 별도 컬럼이 아니라 `rawShape.meta`에 저장한다.
Frame은 `piloFrameCollapsed`, Code Block은 `piloCodeBlockCollapsed`를 사용한다.

```json
{
  "rawShape": {
    "meta": {
      "piloFrameCollapsed": true,
      "piloCodeBlockCollapsed": true
    }
  }
}
```

MVP `shapeType`은 DB check constraint 기준으로 아래 값을 지원한다.

```text
sticky-note, note, text, frame, draw, highlight, geo, arrow, line, image, video,
bookmark, embed, pilo-code-block, file_node, group
```

`file_node`는 여기서는 일반 자유형 shape type이다. PR Review graph는
`canvas_freeform_shapes`에 저장하지 않는다.

## Canvas 상세 조회

Canvas 상세 조회는 canvas metadata와 저장된 viewport를 반환한다. 대용량 canvas에서
초기 진입 시 전체 shape를 우선 로드하지 않도록, 클라이언트는 `viewSetting` 기준
viewport bounds를 계산한 뒤 shape summary 조회 API를 호출한다.

```json
{
  "id": "canvas id",
  "workspaceId": "workspace id",
  "title": "Untitled canvas",
  "boardType": "freeform",
  "zoom": 1,
  "viewportX": 0,
  "viewportY": 0,
  "latestOpSeq": 103,
  "shapeCount": 42,
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "viewSetting": {
    "zoom": 1,
    "viewportX": 0,
    "viewportY": 0
  },
  "shapes": [],
  "userState": null
}
```

## Viewport Shape Summary 조회

```text
GET /workspaces/{workspaceId}/canvases/{canvasId}/shapes?x=-120&y=80&width=1440&height=900&margin=320
```

Query:

- `x`: viewport page bounds left
- `y`: viewport page bounds top
- `width`: viewport page bounds width
- `height`: viewport page bounds height
- `margin`: viewport 주변 추가 로드 여백. 생략하면 `0`
- `parentShapeId`: 특정 Frame의 직접 내부 shape를 조회할 때 사용한다. 이 값이
  있으면 `x`, `y`, `width`, `height`, `margin`은 생략할 수 있다.

서버는 `x - margin`, `y - margin`, `x + width + margin`,
`y + height + margin`과 겹치는 활성 최상위 shape summary를 반환한다. 기본 viewport
조회에서는 Frame 자체와 최상위 shape만 반환하고, Frame 내부 shape는 반환하지 않는다.

Frame을 펼칠 때는 아래처럼 `parentShapeId`로 해당 Frame의 직접 내부 shape를
lazy load한다.

```text
GET /workspaces/{workspaceId}/canvases/{canvasId}/shapes?parentShapeId=frame_shape_id
```

```json
[
  {
    "id": "shape_client_id",
    "canvasId": "canvas id",
    "parentShapeId": null,
    "shapeType": "note",
    "title": "Decision",
    "textContent": "Ship MVP with all-deny RLS",
    "x": 120,
    "y": 80,
    "width": 240,
    "height": 120,
    "rotation": 0,
    "zIndex": 10,
    "childShapeCount": 0,
    "rawShape": {},
    "contentHash": "a8f6f8b2c2d4...",
    "revision": 3,
    "createdAt": "2026-07-03T00:00:00.000Z",
    "updatedAt": "2026-07-03T00:00:00.000Z",
    "deletedAt": null
  }
]
```

## Shape 상세 조회

```text
GET /workspaces/{workspaceId}/canvas-shapes/{shapeId}
```

클라이언트는 shape 클릭 시 zoom 기준 이상일 때만 상세 조회를 호출한다. zoom 기준
이하에서 클릭한 경우에는 선택/강조만 처리하고 상세 조회를 보내지 않는다. zoom 기준
이하로 내려갔다가 다시 확대되어도 자동 조회하지 않으며, 사용자가 shape를 다시
클릭해야 한다.

응답은 `Shape Payload`와 같은 full shape data다. 이미 클라이언트 cache에 full
detail이 있으면 cache를 우선 사용할 수 있다.

응답에는 `contentHash`와 `revision`이 포함된다. 클라이언트는 늦게 도착한 detail
응답이 현재 선택 또는 local dirty shape 상태와 맞지 않으면 반영하지 않는다.

## Shape Batch 저장

```text
POST /workspaces/{workspaceId}/canvases/{canvasId}/shapes/batch
```

이 API는 짧은 시간에 여러 shape 변경이 생겼을 때 API 호출 수를 줄이는 최적화
endpoint다. 단일 shape 생성/수정/삭제 API는 fallback, 테스트, 디버깅, 단일 작업만
지원하는 클라이언트를 위해 유지한다.

요청:

```json
{
  "operations": [
    {
      "type": "create",
      "shapeId": "shape_1",
      "clientOperationId": "op_01H...",
      "payload": {
        "id": "shape_1",
        "parentShapeId": null,
        "shapeType": "note",
        "title": "Decision",
        "textContent": "Ship MVP with all-deny RLS",
        "x": 120,
        "y": 80,
        "width": 240,
        "height": 120,
        "rotation": 0,
        "zIndex": 10,
        "rawShape": {}
      }
    },
    {
      "type": "update",
      "shapeId": "shape_2",
      "clientOperationId": "op_01H...",
      "baseRevision": 2,
      "payload": {
        "parentShapeId": "frame_shape_id",
        "x": 360,
        "y": 160,
        "rawShape": {}
      }
    },
    {
      "type": "delete",
      "shapeId": "shape_3",
      "clientOperationId": "op_01H...",
      "baseRevision": 3
    }
  ]
}
```

응답:

```json
{
  "created": 1,
  "updated": 1,
  "deleted": 1,
  "shapes": [
    {
      "id": "shape_1",
      "canvasId": "canvas id",
      "parentShapeId": null,
      "shapeType": "note",
      "title": "Decision",
      "textContent": "Ship MVP with all-deny RLS",
      "x": 120,
      "y": 80,
      "width": 240,
      "height": 120,
      "rotation": 0,
      "zIndex": 10,
      "childShapeCount": 0,
      "rawShape": {},
      "contentHash": "a8f6f8b2c2d4...",
      "revision": 1,
      "operationType": "create",
      "opSeq": 101,
      "actorUserId": "user id",
      "clientOperationId": "op_01H...",
      "createdAt": "2026-07-03T00:00:00.000Z",
      "updatedAt": "2026-07-03T00:00:00.000Z",
      "deletedAt": null
    }
  ],
  "deletedShapes": [
    {
      "id": "shape_3",
      "deleted": true,
      "deletedAt": "2026-07-03T00:05:00.000Z",
      "contentHash": "f1e2d3c4...",
      "revision": 4,
      "operationType": "delete",
      "opSeq": 103,
      "actorUserId": "user id",
      "clientOperationId": "op_01H..."
    }
  ]
}
```

정책:

- `operations`는 최대 `100`개까지 허용한다.
- 서버는 같은 transaction 안에서 순서대로 처리하며, batch 전체 성공 또는 전체 실패로 동작한다.
- batch 안의 각 operation은 배열 순서대로 연속 `opSeq`를 받는다.
- Realtime canvas client는 각 operation에 stable `clientOperationId`를 보낸다. API
  level에서는 선택값으로 두며, 없으면 서버가 생성해서 응답에 포함한다. 같은 actor가 같은
  canvas에서 같은 `clientOperationId`를 재시도하면 operation log를 중복 생성하지 않는다.
- `create` payload의 `id`가 있으면 `shapeId`와 같아야 한다.
- 프론트는 500ms 동안 shape 변경 operation을 queue에 모은 뒤 shapeId 기준으로 merge한다.
- 프론트는 `p-queue`로 저장 요청을 직렬화하고, 실패한 pending operation을 버리지 않고
  `p-retry` retry/backoff 후 다시 보낸다.
- 프론트는 shape id별 `microdiff`로 변경 여부를 판단해 전체 canvas snapshot
  문자열 비교 의존을 줄인다.
- 프론트 viewport/detail 조회는 `@tanstack/react-query` query key, cancellation,
  cache invalidation과 local dirty shape 방어를 함께 사용한다.
- 서버는 create/update 결과 shape와 delete 결과 metadata에 `contentHash`와
  `revision`, `opSeq`, `actorUserId`, `clientOperationId`를 포함한다.
- 프론트에 batch method가 없으면 기존 단일 API로 fallback할 수 있다.
- batch endpoint 호출이 실패한 경우에는 단일 API로 재시도하지 않는다.

## Operations Catch-up

```text
GET /workspaces/{workspaceId}/canvases/{canvasId}/operations?afterSeq=101
```

Query:

- `afterSeq`: 클라이언트가 마지막으로 적용한 `opSeq`. 생략하면 `0`.

응답은 `opSeq` 오름차순으로 반환한다.

```json
{
  "latestOpSeq": 103,
  "operations": [
    {
      "id": "operation id",
      "workspaceId": "workspace id",
      "canvasId": "canvas id",
      "shapeId": "shape_2",
      "operationType": "update",
      "opSeq": 102,
      "actorUserId": "user id",
      "clientOperationId": "op_01H...",
      "baseRevision": 2,
      "resultRevision": 3,
      "contentHash": "a8f6f8b2c2d4...",
      "payload": {
        "shape": {
          "id": "shape_2",
          "rawShape": {}
        }
      },
      "createdAt": "2026-07-03T00:00:00.000Z"
    }
  ]
}
```

정책:

- 서버는 workspace/canvas 접근 권한을 검증한다.
- `opSeq`는 canvas별로 단조 증가한다.
- `create`/`update` payload는 최신 shape snapshot 중심이다.
- `delete` payload는 `shapeId`, `deletedAt`, `resultRevision`, `contentHash`를 포함한다.
- 클라이언트는 Socket.IO `canvas:operation`에서 gap을 감지하면 이 endpoint로 누락분을 보정한다.
- `actorUserId`가 현재 사용자와 같으면 echo event로 보고 remote apply 대신
  `clientOperationId` 기준 reconcile만 수행한다.

Note: if a shape is already soft-deleted or no longer exists in the shape table,
catch-up returns prior `create`/`update` log entries for that shape as `delete`
operations with the original `opSeq`. This preserves contiguous `opSeq`
catch-up while preventing deleted shapes from being resurrected after refresh
or reconnect.

## Socket.IO Canvas Events

Socket.IO는 source of truth가 아니라 접속 중인 사용자에게 operation과 presence를 빠르게 전달하는 통로다.

Client -> Server:

```text
canvas:join
canvas:leave
canvas:presence:update
```

Server -> Client:

```text
canvas:joined
canvas:operation
canvas:sync:required
canvas:presence:update
canvas:presence:leave
canvas:error
```

Presence payload는 cursor page 좌표, `selectedShapeIds`, viewport, `sentAt`을 포함한다.
또한 soft lock UI를 위해 realtime-only 편집 의도 필드 `editingShapeId`와
`editingMode`(`select`, `move`, `resize`, `text`, `code`, `draw`, `placement`,
`hand`)를 포함한다. 이 필드는 DB와 operation log에 저장하지 않는다.
Presence는 operation log에 저장하지 않고, disconnect/leave 또는 stale timeout으로 제거한다.

## DB 조회 정책

`canvas_freeform_shapes`는 viewport overlap 조회를 위해 `max_x`, `max_y` generated
column과 활성 shape viewport/order index를 가진다. 또한 Frame 내부 shape lazy
loading을 위해 `canvas_id, parent_shape_id` active index를 가진다.

서버의 viewport summary 조회는
`x <= viewportRight`, `max_x >= viewportLeft`, `y <= viewportBottom`,
`max_y >= viewportTop`, `deleted_at IS NULL`, `parent_shape_id IS NULL` 조건을
사용한다. `parentShapeId` 조회는 `parent_shape_id`가 요청한 shape id와 같은 활성
shape를 반환한다.

`canvas_shape_operations`는 reconnect/catch-up을 위해 `canvas_id, op_seq` 순서
조회 index와 `canvas_id, actor_user_id, client_operation_id` unique 제약을 가진다.
operation log cleanup은 request/leave 흐름에서 수행하지 않고, 후속 background
정책으로 분리한다.

Background cleanup permanently deletes rows from `canvas_freeform_shapes` every
10 minutes when `deleted_at IS NOT NULL`. The `canvas_shape_operations` log can
outlive those shape rows, so operation catch-up must continue to synthesize
delete operations for missing shape rows.

## View Settings

```json
{
  "zoom": 1,
  "viewportX": 0,
  "viewportY": 0
}
```

## Canvas 입장/퇴장

```text
POST /workspaces/{workspaceId}/canvases/{canvasId}/enter
PATCH /workspaces/{workspaceId}/canvases/{canvasId}/leave
```

`enter`는 현재 사용자의 `canvas_user_states` row를 upsert한다. 재입장 시
`entered_at`을 현재 시각으로 갱신하고 `left_at`을 `null`로 되돌린다.

```json
{
  "canvasId": "canvas id",
  "userId": "user id",
  "enteredAt": "2026-07-03T00:00:00.000Z",
  "leftAt": null,
  "lastSeenAt": "2026-07-03T00:00:00.000Z"
}
```

`leave`는 현재 사용자의 `left_at`과 `last_seen_at`을 기록한다. 동시편집 catch-up을
깨지 않기 위해 `leave` 요청에서 soft-deleted shape나 operation log를 즉시 영구
삭제하지 않는다.

```json
{
  "canvasId": "canvas id",
  "userId": "user id",
  "enteredAt": "2026-07-03T00:00:00.000Z",
  "leftAt": "2026-07-03T00:05:00.000Z",
  "lastSeenAt": "2026-07-03T00:05:00.000Z"
}
```

## MVP 제외

- tldraw sync, Yjs/CRDT
- 복잡한 conflict UI
- shape lock
- public link 공유
- viewer-only role
- 대용량 media storage 연동
- PR review session 실행
