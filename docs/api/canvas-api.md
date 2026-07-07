# Freeform Canvas API

## 범위

Canvas API는 사용자가 직접 편집하는 자유형 캔버스를 담당한다.

- Workspace canvas 목록, 생성, 상세 조회
- 자유 도형 viewport 조회, 상세 조회, 생성, 수정, 삭제
- 화면 위치 저장
- 캔버스 입장/퇴장 user state

PR 리뷰 canvas data, GitHub data, 회의, 캘린더 일정, realtime collaborative
editing은 이 문서의 범위가 아니다.

## 데이터 규칙

- `canvas` 테이블은 canvas metadata와 viewport 값을 저장한다.
- `canvas_freeform_shapes` 테이블은 사용자가 만든 shape data를 저장한다.
- Shape id는 client-generated text id다.
- Shape 삭제 API는 `deleted_at`을 사용하는 soft delete다. Canvas 퇴장 API는 해당 canvas의 soft-deleted shape를 영구 삭제할 수 있다.
- 서버는 저장된 shape content 기준으로 `contentHash`를 계산한다. 기준 content는
  `shapeType`, `title`, `textContent`, `x`, `y`, `width`, `height`,
  `rotation`, `zIndex`, `rawShape`다.
- 서버는 shape 생성 시 `revision = 1`을 부여하고, 수정/삭제 시 revision을 1씩
  증가시킨다. MVP에서는 다중 사용자 conflict resolution을 제공하지 않지만,
  클라이언트는 `contentHash`와 `revision`으로 응답 최신성과 content 변경 여부를
  판단할 수 있다.
- 이 API의 `board_type`은 `freeform`이다. `review`는 PR 리뷰 화면 의미로 예약되어 있으며 여기서 관리하지 않는다.
- MVP에는 CRDT, cursor 공유, heartbeat, 동시 편집 conflict resolution이 없다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/canvases` | Workspace canvas 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases` | Canvas 생성 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}` | Canvas metadata와 저장된 viewport 조회 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes` | Viewport bounds 기준 shape summary 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes` | Shape 생성 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes/batch` | Shape 변경 batch 저장 |
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
  "shapeType": "pilo-sticky-note",
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
```

MVP `shapeType`은 DB check constraint 기준으로 아래 값을 지원한다.

```text
sticky-note, text, frame, draw, highlight, geo, arrow, line, image, video,
bookmark, embed, pilo-sticky-note, pilo-code-block, file_node, group
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

서버는 `x - margin`, `y - margin`, `x + width + margin`,
`y + height + margin`과 겹치는 활성 shape summary를 반환한다.

```json
[
  {
    "id": "shape_client_id",
    "canvasId": "canvas id",
    "shapeType": "pilo-sticky-note",
    "title": "Decision",
    "textContent": "Ship MVP with all-deny RLS",
    "x": 120,
    "y": 80,
    "width": 240,
    "height": 120,
    "rotation": 0,
    "zIndex": 10,
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
      "payload": {
        "id": "shape_1",
        "shapeType": "pilo-sticky-note",
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
      "payload": {
        "x": 360,
        "y": 160,
        "rawShape": {}
      }
    },
    {
      "type": "delete",
      "shapeId": "shape_3"
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
      "shapeType": "pilo-sticky-note",
      "title": "Decision",
      "textContent": "Ship MVP with all-deny RLS",
      "x": 120,
      "y": 80,
      "width": 240,
      "height": 120,
      "rotation": 0,
      "zIndex": 10,
      "rawShape": {},
      "contentHash": "a8f6f8b2c2d4...",
      "revision": 1,
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
      "revision": 4
    }
  ]
}
```

정책:

- `operations`는 최대 `100`개까지 허용한다.
- 서버는 같은 transaction 안에서 순서대로 처리하며, batch 전체 성공 또는 전체 실패로 동작한다.
- `create` payload의 `id`가 있으면 `shapeId`와 같아야 한다.
- 프론트는 500ms 동안 shape 변경 operation을 queue에 모은 뒤 shapeId 기준으로 merge한다.
- 프론트는 `p-queue`로 저장 요청을 직렬화하고, 실패한 pending operation을 버리지 않고
  `p-retry` retry/backoff 후 다시 보낸다.
- 프론트는 shape id별 `microdiff`로 변경 여부를 판단해 전체 canvas snapshot
  문자열 비교 의존을 줄인다.
- 프론트 viewport/detail 조회는 `@tanstack/react-query` query key, cancellation,
  cache invalidation과 local dirty shape 방어를 함께 사용한다.
- 서버는 create/update 결과 shape와 delete 결과 metadata에 `contentHash`와
  `revision`을 포함한다.
- 프론트에 batch method가 없으면 기존 단일 API로 fallback할 수 있다.
- batch endpoint 호출이 실패한 경우에는 단일 API로 재시도하지 않는다.

## DB 조회 정책

`canvas_freeform_shapes`는 viewport overlap 조회를 위해 `max_x`, `max_y` generated
column과 활성 shape viewport/order index를 가진다. 서버의 viewport summary 조회는
`x <= viewportRight`, `max_x >= viewportLeft`, `y <= viewportBottom`,
`max_y >= viewportTop`, `deleted_at IS NULL` 조건을 사용한다.

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
  "leftAt": null
}
```

`leave`는 현재 사용자의 `left_at`을 기록한 뒤, 같은 canvas에서
`deleted_at IS NOT NULL`인 shape를 영구 삭제한다. 이 cleanup은 사용자별 삭제자
기준이 아니라 canvas 기준이다.

```json
{
  "canvasId": "canvas id",
  "userId": "user id",
  "enteredAt": "2026-07-03T00:00:00.000Z",
  "leftAt": "2026-07-03T00:05:00.000Z",
  "permanentlyDeletedShapeCount": 3
}
```

## MVP 제외

- 자유형 캔버스 실시간 협업
- Cursor 공유와 heartbeat
- 대용량 media storage 연동
- PR review session 실행
