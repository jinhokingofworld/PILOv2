# Freeform Canvas API

## 범위

Canvas API는 사용자가 직접 편집하는 자유형 캔버스를 담당한다.

- Workspace canvas 목록, 생성, 상세 조회
- 자유 도형 생성, 수정, 삭제
- 화면 위치 저장
- 캔버스 입장/퇴장 user state

PR 리뷰 canvas data, GitHub data, 회의, 캘린더 일정, realtime collaborative
editing은 이 문서의 범위가 아니다.

## 데이터 규칙

- `canvas` 테이블은 canvas metadata와 viewport 값을 저장한다.
- `canvas_freeform_shapes` 테이블은 사용자가 만든 shape data를 저장한다.
- Shape id는 client-generated text id다.
- 삭제는 `deleted_at`을 사용하는 soft delete다.
- 이 API의 `board_type`은 `freeform`이다. `review`는 PR 리뷰 화면 의미로 예약되어 있으며 여기서 관리하지 않는다.
- MVP에는 CRDT, cursor 공유, heartbeat, 동시 편집 conflict resolution이 없다.

## API 목록

| Method | Endpoint | 설명 |
| --- | --- | --- |
| `GET` | `/workspaces/{workspaceId}/canvases` | Workspace canvas 목록 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases` | Canvas 생성 |
| `GET` | `/workspaces/{workspaceId}/canvases/{canvasId}` | Canvas 상세와 활성 shape 조회 |
| `POST` | `/workspaces/{workspaceId}/canvases/{canvasId}/shapes` | Shape 생성 |
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

## View Settings

```json
{
  "zoom": 1,
  "viewportX": 0,
  "viewportY": 0
}
```

## MVP 제외

- 자유형 캔버스 실시간 협업
- Cursor 공유와 heartbeat
- 대용량 media storage 연동
- PR review session 실행
