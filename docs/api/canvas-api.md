# Freeform Canvas API

## Meeting recording activity capture

Canvas shape changes are not general Canvas Activity Log history. The only
recorded Canvas shape actions are safe semantic deltas received by the
Realtime server while the authenticated actor has exactly one active Meeting
Recording in the workspace. Changes outside a recording, changes received
after recording end, and changes with ambiguous active recordings are omitted.

Realtime sends the internal-only endpoint
`POST /api/v1/internal/canvas/recording-activities/batch` with the shared
`X-Realtime-Canvas-Activity-Token`. Each item contains `captureId`,
`recordingId`, `capturedAt` (Realtime receive time), `receiveSeq`, actor,
workspace/canvas/shape IDs, operation type, and bounded semantic fields only.
The endpoint is not a client API and rejects malformed or cross-workspace
data. App Server locks and validates the recording and participant session,
then calls `ActivityLogService.append(transaction, input)` and inserts
`meeting_recording_activity_links` in the same transaction. `captureId` is the
idempotency key for retries. Activity metadata never contains `recordingId`,
`captureId`, raw shape data, complete code, access tokens, or cursor data.

Text and code updates for the same recording, actor, canvas, and shape are
coalesced as one editing burst. The burst flushes after 3 seconds without a
new change and is force-flushed every 30 seconds during continuous editing.
The first `capturedAt` and `receiveSeq` are retained for each flushed burst.

## 범위

Canvas API는 사용자가 직접 편집하는 자유형 캔버스와 PR Review room에 연결된
Review Canvas의 사용자 편집 데이터를 담당한다.

- Workspace canvas 목록, 생성, 상세 조회
- 자유 도형 viewport 조회, 상세 조회, 생성, 수정, 삭제
- 화면 위치 저장
- 캔버스 입장/퇴장 user state
- 캔버스 shape operation catch-up과 realtime presence 계약
- Review Canvas metadata 조회와 사용자 shape operation 저장·복구

PR Review의 분석 결과, file decision, 위험도, Flow와 relation 원본, GitHub data, 회의,
캘린더 일정은 이 문서의 범위가 아니다.

## 데이터 규칙

- `canvas` 테이블은 canvas metadata와 viewport 값을 저장한다.
- `canvas.engine_type`은 Canvas 동작 엔진을 구분한다. `classic`은 기존 API
  batch/operation log 기반 Canvas이고, `tldraw_sync`는 별도 sync document
  기반 Canvas다.
- `canvas.source_canvas_id`는 기존 Canvas에서 새 엔진 Canvas를 시작한 경우 원본
  Canvas를 가리킨다. 기본 전환은 기존 shape를 복사하지 않는다.
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
- Canvas shape 중 `note`, `sticky-note`, `text`, `frame`, `pilo-code-block`,
  `arrow`, `line`의 생성·삭제와 text/title/code/language/frame name 같은 의미 변경은
  공통 `activity_logs`에 같은 transaction으로 append한다. geometry-only 변경,
  draw/highlight, viewport, presence, preview, retry/recovery는 기록하지 않는다.
- Canvas Activity Log는 Canvas operation에서 dedupe key와 App Server 발생 시각을
  만들며 client에게 Meeting/recording 식별자나 별도 Activity Log 값을 요구하지 않는다.
  metadata에는 raw tldraw shape, 원문 code/file, token, secret을 저장하지 않는다.
- `clientOperationId`는 frontend retry/idempotency 기준이다. Realtime canvas client는
  요청마다 stable `clientOperationId`를 보내야 한다. 기존 client, 다른 canvas engine,
  PR Review 호환을 위해 API level에서는 선택값으로 둔다. 없으면 서버가 값을 생성해서
  operation log에 저장한다. 같은 canvas, 같은 actor, 같은 `clientOperationId`가 다시 오면
  서버는 operation을 중복 생성하지 않고 기존 처리 결과를 반환한다. 클라이언트가 값을
  보내지 않아 서버가 생성한 요청은 retry idempotency를 완전하게 보장하지 않는다.
- `baseRevision`은 update/delete 계열 mutation의 낙관적 동시성 기준이다. 요청에
  `baseRevision`이 있고 현재 저장된 shape `revision`과 다르면 서버는 shape를 변경하지
  않고 `409 CONFLICT`를 반환한다. 기존 호환을 위해 값이 없으면 stale revision 검사를
  생략한다. classic Canvas의 현재 frontend와 realtime checkpoint는 동시 편집을
  서버 수신 순서대로 모두 반영하기 위해 `baseRevision`을 보내지 않는다.
- Workspace Canvas 목록과 생성 API는 `board_type=freeform`만 다룬다.
- Canvas ID를 지정하는 metadata, shape, operation, viewport API는 `freeform`과
  PR Review room에 연결된 `board_type=review` Canvas를 다룬다.
- Review Canvas 읽기는 active/completed room에서 허용한다. shape와 viewport mutation은
  active room에서만 허용하며 completed room은 read-only다.
- room에 연결되지 않은 `board_type=review` Canvas는 Canvas API로 접근할 수 없다.
- Canvas Agent는 `freeform` 전용이다. Review Canvas Agent 실행은 지원하지 않는다.
- Review Canvas realtime room은 연결된 room의 상태에 따라 권한을 계산한다. active room은
  read-write, completed room은 Presence만 허용하는 read-only로 입장한다.
- `classic` Canvas MVP에는 Yjs/CRDT, shape lock, viewer-only role, 복잡한 conflict UI가
  없다. 같은 shape를 여러 사용자가 조작해도 입력을 차단하지 않고
  `canvas:room:shape:patch`의 서버 수신 순서대로 history와 최종 상태를 결정한다.
  Presence와 preview는 다른 사용자의 선택·편집·중간 결과를 보여주기 위한 시각적
  상태이며 조작 권한이나 저장 순서를 결정하지 않는다.
- `tldraw_sync` Canvas는 classic shape table/operation log를 사용하지 않고 realtime-server의 `@tldraw/sync` room과 `canvas_sync_documents` snapshot 저장/복원을 사용하는 별도 engine이다. realtime-server URL/token이 없는 local fallback에서만 App Server sync-document API로 snapshot을 직접 저장/복원한다.

## Canvas 접근 정책

모든 Canvas API는 먼저 bearer session과 Workspace membership을 검증한다.

| Canvas 종류 | 목록·생성 | metadata·shape 조회 | shape·viewport mutation | Realtime room | Canvas Agent |
| --- | --- | --- | --- | --- | --- |
| `freeform` | 허용 | 허용 | 허용 | read-write | 허용 |
| active `review` room 연결 Canvas | 제외 | 허용 | 허용 | read-write | 제외 |
| completed `review` room 연결 Canvas | 제외 | 허용 | 거부 | read-only Presence | 제외 |
| room 미연결 `review` Canvas | 제외 | 거부 | 거부 | 거부 | 제외 |

Review Canvas 접근은 `canvas.workspace_id`와 `pr_review_rooms.workspace_id`가 같고
`pr_review_rooms.canvas_id`가 요청 Canvas를 가리키는 경우에만 허용한다. 다른 Workspace의
Canvas는 ID를 알고 있어도 조회할 수 없다.

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

`canvas_sync_documents`:

| 컬럼 | 역할 |
| --- | --- |
| `workspace_id` | Workspace 접근 검증과 조회 범위 |
| `canvas_id` | `engine_type=tldraw_sync` Canvas id. Canvas 삭제 시 함께 삭제된다. |
| `provider_type` | sync provider 구분. 현재는 `tldraw_sync`만 허용한다. |
| `snapshot` | tldraw editor snapshot JSON object. `null`이면 아직 저장된 문서가 없다는 뜻이다. |
| `version` | snapshot 저장 시 증가하는 문서 버전 |
| `updated_at` | 마지막 snapshot 저장 시각 |

`canvas_sync_documents` 제약/인덱스:

- `UNIQUE (canvas_id)`
- `CHECK (provider_type IN ('tldraw_sync'))`
- `CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object')`
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
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/engine-conversions` | 기존 Canvas를 보존하고 새 engine Canvas 생성 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}` | Canvas metadata와 저장된 viewport 조회 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}/sync-document` | `tldraw_sync` Canvas snapshot 조회 |
| `PUT` | `/workspaces/{workspaceId}/canvases/{canvasId}/sync-document` | `tldraw_sync` Canvas snapshot 저장 |
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
  "title": "Untitled canvas",
  "engineType": "classic"
}
```

서버는 `boardType`을 `freeform`으로 저장한다. `engineType`은 선택값이며 생략하면
`classic`이다. 지원 값은 `classic`, `tldraw_sync`다.

## Canvas engine 전환

```json
{
  "targetEngineType": "tldraw_sync",
  "copyShapes": false
}
```

전환 API는 기존 Canvas row를 직접 변경하지 않는다. 서버는 기존 Canvas를
`sourceCanvasId`로 참조하는 새 Canvas를 만들고, 새 Canvas는 비어 있는 상태로
시작한다. 현재 `copyShapes: true`는 지원하지 않는다.

## Canvas sync document

`engineType`이 `tldraw_sync`인 Canvas에서만 사용한다. `classic` Canvas는 기존 shape/batch/operation API를 계속 사용한다.

```text
GET /workspaces/{workspaceId}/canvases/{canvasId}/sync-document
PUT /workspaces/{workspaceId}/canvases/{canvasId}/sync-document
```

저장 요청:

```json
{
  "snapshot": {
    "document": {},
    "session": {}
  }
}
```

응답:

```json
{
  "canvasId": "canvas id",
  "workspaceId": "workspace id",
  "providerType": "tldraw_sync",
  "snapshot": {
    "document": {},
    "session": {}
  },
  "version": 1,
  "updatedAt": "2026-07-15T00:00:00.000Z"
}
```

정책:

- `snapshot`은 JSON object 또는 `null`만 허용한다.
- snapshot payload는 2MB 이하로 제한한다.
- 저장할 때마다 `version`을 1씩 증가시킨다.
- 이 endpoint는 tldraw sync engine의 문서 저장/복원 경계이며, classic Canvas의 shape revision/operation log와 섞지 않는다.

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
bookmark, embed, pilo-code-block, file_node, pr_review_file_node,
pr_review_relation_edge, group
```

`file_node`는 일반 자유형 shape type이다. `pr_review_file_node`와
`pr_review_relation_edge`는 Review Canvas 전용 시스템 shape다. 일반 Canvas mutation
API로 두 시스템 shape를 생성하거나 삭제할 수 없으며, PR Review materialization만 생성과
도메인 metadata 갱신을 담당한다. 새 분석 버전을 materialize할 때 기존 file node의
geometry는 유지하고 relation geometry는 현재 node 위치에서 다시 계산한다. 최초 Review Canvas
materialization은 PR Review가 저장한 `routePoints`를 사용해 orthogonal edge를 렌더링한다. 현재 버전에서
제외된 PR Review 시스템 shape는 soft delete하며 사용자 shape에는 영향을 주지 않는다.

`pr_review_file_node`의 사용자 mutation은 아래 geometry 필드만 허용한다.

- `parentShapeId`
- `x`, `y`
- `width`, `height`
- `zIndex`
- 위 geometry와 일치하는 `rawShape.x`, `rawShape.y`, `rawShape.parentId`,
  `rawShape.index`, `rawShape.props.w`, `rawShape.props.h`

`shapeType`, `title`, `textContent`, `rotation`과 `rawShape.props`의 PR Review 도메인
metadata는 기존 값과 같아야 한다. `pr_review_relation_edge`는 endpoint와 relation
metadata뿐 아니라 geometry도 사용자가 수정할 수 없다. 일반 shape를 시스템 shape로
변경하는 것도 허용하지 않는다. 위반 요청은 `403 FORBIDDEN`이다.

Review Canvas frontend는 진입 시 room에 연결된 `canvasId`로 저장된 시스템 Shape를
조회한다. File node 이동은 짧게 debounce한 뒤 단일 Shape 수정 API로 위 geometry만
저장하고, 요청에는 현재 `revision`을 `baseRevision`으로 포함한다. Relation edge는 사용자
mutation 대상이 아니므로 node 이동 중에는 클라이언트에서 geometry와 기본 orthogonal route만 다시 계산한다.
`409 CONFLICT`가 발생하면 Shape 상세 조회로 최신 revision과 geometry를 다시 받아
로컬 Shape를 복구한다.

## Canvas 상세 조회

Canvas 상세 조회는 canvas metadata와 저장된 viewport를 반환한다. 대용량 canvas에서
초기 진입 시 전체 shape를 우선 로드하지 않도록, 클라이언트는 초기 editor viewport
bounds를 계산한 뒤 shape summary 조회 API를 호출한다.

`classic` Canvas 클라이언트는 저장된 공용 viewport를 초기 카메라로 사용하지 않는다.
진입과 새로고침 시 Canvas 좌표 `(0, 0)`을 실제 editor viewport 중앙에 배치하고
zoom `1`로 시작한다. `viewSetting`과 Viewport 저장 API는 기존 API 호환을 위해
유지하며, Classic의 사용 중 pan/zoom은 로컬 UI 상태로만 반영한다.

```json
{
  "id": "canvas id",
  "workspaceId": "workspace id",
  "title": "Untitled canvas",
  "boardType": "freeform",
  "engineType": "classic",
  "engineVersion": 1,
  "sourceCanvasId": null,
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

## 단일 Shape 수정/삭제

```text
PATCH /workspaces/{workspaceId}/canvas-shapes/{shapeId}
DELETE /workspaces/{workspaceId}/canvas-shapes/{shapeId}
```

단일 수정 요청은 변경할 shape field와 함께 선택적으로 `clientOperationId`,
`baseRevision`을 보낸다. 단일 삭제 요청도 선택 body를 받을 수 있다.

```json
{
  "clientOperationId": "op_01H...",
  "baseRevision": 2
}
```

정책:

- `baseRevision`이 현재 shape `revision`과 같으면 mutation을 적용하고 새
  `revision`과 operation metadata를 응답한다.
- `baseRevision`이 현재 shape `revision`과 다르면 mutation을 적용하지 않고
  `409 CONFLICT`를 반환한다.
- `baseRevision`이 없으면 기존 client 호환을 위해 stale revision 검사를 생략한다.

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
- classic freeform Canvas frontend는 direct API fallback에서도 `baseRevision`을
  생략해 사용자 변경을 서버 수신 순서대로 반영한다. Review Canvas처럼 별도 충돌
  복구 정책이 필요한 호출자는 선택적으로 `baseRevision`을 계속 사용할 수 있다.
- 프론트 viewport/detail 조회는 `@tanstack/react-query` query key, cancellation,
  cache invalidation과 local dirty shape 방어를 함께 사용한다.
- 서버는 create/update 결과 shape와 delete 결과 metadata에 `contentHash`와
  `revision`, `opSeq`, `actorUserId`, `clientOperationId`를 포함한다.
- update/delete operation의 `baseRevision`이 현재 shape `revision`과 다르면 batch
  전체를 rollback하고 `409 CONFLICT`를 반환한다.
- 프론트에 batch method가 없으면 기존 단일 API로 fallback할 수 있다.
- batch endpoint 호출이 실패한 경우에는 단일 API로 재시도하지 않는다.

## Shape stale revision conflict

`baseRevision`이 현재 shape revision보다 오래된 update/delete 요청은 `409 CONFLICT`
로 거절한다. `latestOperation.actorUserId`는 frontend가 presence/user map에서 표시
이름을 찾기 위한 기준이다.

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Canvas shape has changed since the requested baseRevision",
    "details": {
      "reason": "STALE_SHAPE_REVISION",
      "shapeId": "shape_2",
      "baseRevision": 2,
      "currentRevision": 4,
      "latestShape": {
        "id": "shape_2",
        "revision": 4,
        "rawShape": {}
      },
      "latestOperation": {
        "operationType": "update",
        "opSeq": 103,
        "actorUserId": "user id",
        "baseRevision": 3,
        "resultRevision": 4
      }
    }
  }
}
```

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
canvas:room:shape:patch
canvas:shape:preview
canvas:shape:preview:clear
canvas:viewport:loaded
```

Server -> Client:

```text
canvas:joined
canvas:operation
canvas:sync:required
canvas:presence:update
canvas:presence:leave
canvas:room:shape:patch
canvas:shape:preview
canvas:shape:preview:clear
canvas:room:loaded-regions:update
canvas:room:shapes:hydrate
pr-review:room:deleted
canvas:error
```

Presence payload는 cursor page 좌표, `selectedShapeIds`, viewport, `sentAt`을 포함한다.
또한 realtime 편집 상태를 시각적으로 표시하기 위한 `editingShapeId`와
`editingMode`(`select`, `move`, `resize`, `text`, `code`, `draw`, `placement`,
`hand`)를 포함한다. 이 필드는 DB와 operation log에 저장하지 않는다.
Presence는 operation log에 저장하지 않고, disconnect/leave 또는 stale timeout으로 제거한다.
Presence의 선택·편집 정보는 다른 사용자의 입력을 차단하지 않는다.

`canvas:joined.shapeLocks`는 PR Review conflict draft의 기존 lock 복원을 위한
호환 필드다. classic Canvas는 이 필드를 조작 차단에 사용하지 않으며 classic Canvas용
shape lock claim/release 이벤트도 제공하지 않는다.

`canvas:joined` payload는 `readOnly` boolean을 포함한다. `freeform`과 active Review
Canvas는 `false`, completed Review Canvas는 `true`다. read-only room에서도
`canvas:presence:update`은 허용하지만 shape patch·preview event는 `canvas:error`의
`forbidden`으로 거부한다. active room이 접속 중 completed로 전환되는 lifecycle event와
클라이언트 상태 전환은 PR Review room lifecycle 단계에서 처리한다.

`pr-review:room:deleted`는 Review room과 연결 Canvas가 영구 삭제된 뒤에만 같은 Canvas
room으로 전송한다. payload는 `workspaceId`, `canvasId`, `reviewRoomId`를 포함하며, 수신한
클라이언트는 pending 편집을 중단하고 PR Review 목록으로 이동한다. 일반 freeform Canvas에는
전송하지 않는다.

classic Canvas에서 realtime roomState가 비활성화된 경우 최종 저장은 클라이언트가
App Server `/shapes/batch`를 직접 호출한다. realtime roomState가 활성화된 경우
클라이언트는 shape patch를 realtime-server에 보내고, realtime-server가 checkpoint로
App Server `/shapes/batch`를 호출한다. realtime-server는
`canvas_freeform_shapes`나 `canvas_shape_operations`를 직접 쓰지 않는다.
최종 DB transaction, revision/opSeq, operation log, activity log 작성 책임은 App Server가
계속 가진다.

`canvas:viewport:loaded`는 classic Canvas room-level lazy loading의 관측 이벤트다.
클라이언트가 App Server shape viewport 조회를 성공적으로 끝낸 뒤, 조회 bounds를
조회된 shape snapshot과 함께 realtime-server에 보고한다. realtime-server는 room 단위
`loadedRegions`와 shape cache를 메모리에 누적하고, `canvas:room:shapes:hydrate`로
같은 room에 공유한다. 새 사용자가 join하면 `canvas:joined.roomShapes`로 현재 room cache를
함께 받는다. `loadedRegions`와 room shape cache는 삭제 판단에 쓰지 않는다. shape가
roomState에 없다는 사실은 삭제가 아니라 아직 로딩되지 않았을 가능성으로 본다.
겹치는 loaded region은 roomState에서 병합하며, cached shape와 loaded region 수는
서버 메모리 보호를 위해 상한을 둔다.

`canvas:join` payload는 `initialViewportBounds`를 선택적으로 포함할 수 있다.
형태는 `canvas:viewport:loaded.bounds`와 같은 `{ x, y, width, height, margin }`이다.
classic Canvas room cache가 비어 있으면 realtime-server는 이 bounds로 App Server
viewport shape API를 best-effort 조회하고, 조회된 shape를 `canvas:joined.roomShapes`에
포함할 수 있다. 이 hydrate 실패는 room join을 거부하지 않으며, 클라이언트는 기존
viewport lazy loading을 fallback으로 계속 수행한다.

`canvas:room:shape:patch`는 DB 저장 전의 roomState patch 이벤트다. 클라이언트는
로컬 shape diff에서 upsert shape snapshot과 명시적 `deletedShapeIds`를 만들어 보낸다.
realtime-server는 room shape cache를 갱신하고 삭제는 tombstone으로 기록한 뒤 보낸
사용자를 포함한 같은 room 전체에 authoritative patch로 broadcast한다. 삭제는 이 이벤트의 `deletedShapeIds`처럼
명시적으로 전달된 경우에만 삭제로 본다.

클라이언트는 room patch와 operation catch-up을 Canvas 전체 snapshot hydrate로
재적용하지 않고 payload에 포함된 shape만 editor store에 증분 반영한다. 로컬에서
편집 중이거나 아직 저장·authoritative echo 확인이 끝나지 않은 shape의 원격
upsert/delete는 shape별 최신 변경만 보관했다가 로컬 편집과 저장이 끝난 뒤 적용한다.
원격 preview도 현재 로컬에서 편집 중인 동일 shape를 덮어쓰지 않으며, 연속 입력
preview는 최신 payload를 짧은 주기로 합쳐 전송한다.

classic Canvas realtime roomState가 활성화된 경우 클라이언트는 매 shape 변경마다
`/shapes/batch`를 직접 호출하지 않고, realtime-server가 dirty roomState를 checkpoint로
묶어 App Server `/shapes/batch`에 저장한다. checkpoint는 첫 dirty 변경 후 5분 주기,
새 사용자 입장 직전, 사용자 leave/disconnect, realtime-server 종료 시점에 실행한다.
shape patch가 추가될 때마다 5분 타이머를 다시 시작하지 않는다. App Server는 계속
DB transaction, revision/opSeq, operation log의 owner다.

일부 shape operation의 4xx 오류로 batch 전체가 rollback되면 realtime-server는 실패한
operation을 격리해 성공 가능한 operation부터 저장한다. 인증 실패, rate limit, App Server
장애처럼 batch 전체에 영향을 주는 오류는 operation별로 분할하지 않는다. checkpoint 실패
operation은 dirty 상태로 유지하며 다음 5분 checkpoint 또는 입장·퇴장 checkpoint에서
재시도한다.

`canvas:room:checkpoint`는 checkpoint 저장 상태를 같은 room에 알리는 서버 이벤트다.
payload는 `status`(`saving`, `saved`, `delayed`), `pendingOperations`, `updatedAt`을
포함한다. `delayed`는 저장 실패 또는 App Server 일시 오류로 dirty state가 남아 있으며
다음 checkpoint에서 재시도된다는 뜻이다.

## tldraw_sync Multiplayer Room 계약

`tldraw_sync` Canvas의 실제 multiplayer server는 realtime-server의 Canvas module에
붙인다. App Server는 REST API와 `canvas_sync_documents` persistence 경계를 유지하고,
긴 연결 상태를 소유하지 않는다.

room key:

```text
workspace:{workspaceId}:canvas:{canvasId}:tldraw-sync
```

접속 규칙:

- browser는 bearer session token과 `workspaceId`, `canvasId`를 전달한다.
- browser가 전달한 room key는 신뢰하지 않는다. realtime-server가 검증 후 key를 만든다.
- realtime-server는 bearer session, workspace membership, canvas ownership을 검증한다.
- 대상 Canvas는 `board_type = 'freeform'`이고 `engine_type = 'tldraw_sync'`여야 한다.
- `classic` Canvas와 Review Canvas는 이 room에 입장할 수 없다.
- 첫 authorized socket이 들어오면 room은 lazy하게 생성된다. 마지막 socket이 나가면
  in-memory room은 사라져도 된다.

persistence 규칙:

- room 생성 시 저장된 문서가 필요하면 `canvas_sync_documents.snapshot`을 복원 기준으로 삼는다.
- sync engine이 snapshot을 저장할 때도 `canvas_sync_documents`와 같은 검증·용량 제한·보안
  기준을 사용한다.
- tldraw sync 문서 상태를 `canvas_freeform_shapes`, `canvas_shape_operations`,
  classic `shapes/batch` 경로에 저장하지 않는다.
- realtime-server가 여러 instance로 동작하면 Redis adapter만으로 문서 병합 source of
  truth가 되지 않는다. sync engine용 shared persistence 또는 provider-level
  coordination이 별도로 필요하다.

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

- `classic` Canvas의 Yjs/CRDT 전환
- `classic` Canvas shape table과 `tldraw_sync` room snapshot의 자동 migration
- 복잡한 conflict UI
- DB 기반 hard shape lock
- public link 공유
- viewer-only role
- 대용량 media storage 연동
- PR review session 실행
