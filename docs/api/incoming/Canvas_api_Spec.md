## 5. API 명세

### 5.0 공통 API 호출 기준

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <pilo_access_token>`
- 요청/응답 Body가 있는 API는 이 명세에 모두 명시한다.
- 페이지네이션이 필요한 API는 기본적으로 `page`/`limit` 방식을 사용하며, 기본 `limit`은 `10`이다.
- PR 목록을 조회하는 API가 추가될 경우 Open PR만 조회한다.
- PR 목록 정렬 기준은 GitHub `updated_at` 내림차순이다.
- `changedFilesCount`는 GitHub PR 변경 파일 수이며, 리뷰 세션의 `totalFileCount`도 같은 값을 사용한다.
- GitHub Review 제출은 로그인한 PILO 사용자의 `users.github_access_token_encrypted` 토큰으로 수행한다.
- GitHub 연동 정보는 별도 `github_accounts` 테이블 없이 `users` 테이블에 둔다.
- 리뷰 세션은 MVP 기준 임시 데이터다. 사용자가 리뷰 화면을 나가면 세션과 관련 리뷰 데이터는 삭제된다.
- GitHub line comment는 지원하지 않는다. PILO 내부 파일별 comment는 GitHub Review 제출 시 `reviewBody`에 포함한다.
- Merge 기능은 구현하지 않는다. API는 conflict 여부 조회와 표시까지만 담당한다.

인증 헤더 예시:

```
Authorization: Bearer <pilo_access_token>
```

### 5.1 워크스페이스 캔버스 목록 조회

```
GET /api/v1/workspaces/:workspaceId/canvas-boards
```

목적:

- 특정 워크스페이스에 속한 캔버스 목록을 조회한다.
- 프론트는 이 목록에서 처음 열 캔버스를 선택한다.

응답:

```json
[
  {
    "id": "canvas id",
    "workspaceId": "workspace id",
    "title": "Untitled canvas",
    "boardType": "freeform",
    "zoom": 1,
    "viewportX": 0,
    "viewportY": 0,
    "shapeCount": 0,
    "updatedAt": "2026-07-03T00:00:00.000Z"
  }
]
```

### 5.2 캔버스 생성

```
POST /api/v1/workspaces/:workspaceId/canvas-boards
```

목적:

- 워크스페이스 안에 새 캔버스를 만든다.

요청:

```json
{
  "title": "Untitled canvas",
  "boardType": "freeform"
}
```

응답:

```json
{
  "id": "canvas id",
  "workspaceId": "workspace id",
  "title": "Untitled canvas",
  "boardType": "freeform",
  "zoom": 1,
  "viewportX": 0,
  "viewportY": 0,
  "shapeCount": 0,
  "updatedAt": "2026-07-03T00:00:00.000Z"
}
```

### 5.3 캔버스 상세 조회

```
GET /api/v1/canvas-boards/:boardId
```

목적:

- 캔버스 1개와 그 안의 활성 도형, 현재 사용자 상태를 조회한다.

응답:

```json
{
  "id": "canvas id",
  "workspaceId": "workspace id",
  "title": "Untitled canvas",
  "boardType": "freeform",
  "zoom": 1,
  "viewportX": 0,
  "viewportY": 0,
  "shapeCount": 0,
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

도형 응답 예시:

```json
{
  "id": "shape id",
  "canvasId": "canvas id",
  "shapeType": "text",
  "title": "Optional title",
  "textContent": "Optional text",
  "x": 100,
  "y": 120,
  "width": 240,
  "height": 120,
  "rotation": 0,
  "zIndex": 1,
  "rawShape": {},
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "deletedAt": null
}
```

### 5.4 도형 생성

```
POST /api/v1/canvas-boards/:boardId/shapes
```

목적:

- 새로 만들어진 도형을 저장한다.

요청:

```json
{
  "id": "shape id",
  "shapeType": "sticky-note",
  "title": null,
  "textContent": "",
  "x": 100,
  "y": 120,
  "width": 156,
  "height": 148,
  "rotation": 0,
  "zIndex": 1,
  "rawShape": {}
}
```

응답:

```json
{
  "id": "shape id",
  "canvasId": "canvas id",
  "shapeType": "sticky-note",
  "title": null,
  "textContent": "",
  "x": 100,
  "y": 120,
  "width": 156,
  "height": 148,
  "rotation": 0,
  "zIndex": 1,
  "rawShape": {},
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:00:00.000Z",
  "deletedAt": null
}
```

### 5.5 도형 수정

```
PATCH /api/v1/canvas-shapes/:shapeId
```

목적:

- 도형 이동, 크기 변경, 텍스트 수정, 회전, 스타일 변경 후 최신 상태를 저장한다.

요청:

```json
{
  "shapeType": "text",
  "title": "Account plan",
  "textContent": "Write MVP notes",
  "x": 180,
  "y": 240,
  "width": 300,
  "height": 80,
  "rotation": 0,
  "zIndex": 3,
  "rawShape": {}
}
```

응답:

```json
{
  "id": "shape id",
  "canvasId": "canvas id",
  "shapeType": "text",
  "title": "Account plan",
  "textContent": "Write MVP notes",
  "x": 180,
  "y": 240,
  "width": 300,
  "height": 80,
  "rotation": 0,
  "zIndex": 3,
  "rawShape": {},
  "createdAt": "2026-07-03T00:00:00.000Z",
  "updatedAt": "2026-07-03T00:05:00.000Z",
  "deletedAt": null
}
```

### 5.6 도형 삭제

```
DELETE /api/v1/canvas-shapes/:shapeId
```

목적:

- 도형을 소프트 삭제한다.

서버 동작:

- `deleted_at = now()`로 저장한다.
- 일반 캔버스 상세 조회에서는 삭제된 도형을 내려주지 않는다.
- 사용자가 캔버스에서 나갈 때 정책에 따라 영구 삭제할 수 있다.

응답:

```json
{
  "id": "shape id",
  "deleted": true
}
```

### 5.7 화면 위치 저장

```
PUT /api/v1/canvas-boards/:boardId/view-settings
```

목적:

- 줌과 카메라 위치를 저장한다.

요청:

```json
{
  "zoom": 1.2,
  "viewportX": -120,
  "viewportY": 80
}
```

응답:

```json
{
  "zoom": 1.2,
  "viewportX": -120,
  "viewportY": 80
}
```

### 5.8 캔버스 입장

```
POST /api/v1/canvas-boards/:boardId/enter
```

목적:

- 현재 사용자가 캔버스에 들어왔음을 저장한다.

서버 동작:

- `(canvas_id, user_id)` row가 이미 있으면 재사용한다.
- `entered_at = now()`로 갱신한다.
- `left_at = null`로 초기화한다.

응답:

```json
{
  "id": "state id",
  "canvasId": "canvas id",
  "userId": "user id",
  "enteredAt": "2026-07-03T00:00:00.000Z",
  "leftAt": null
}
```

### 5.9 캔버스 퇴장

```
PATCH /api/v1/canvas-boards/:boardId/leave
```

목적:

- 현재 사용자가 캔버스에서 나갔음을 저장한다.

서버 동작:

- `left_at = now()`로 갱신한다.
- MVP 정리 정책이 있다면 해당 캔버스의 소프트 삭제 도형을 영구 삭제한다.

응답:

```json
{
  "id": "state id",
  "canvasId": "canvas id",
  "userId": "user id",
  "enteredAt": "2026-07-03T00:00:00.000Z",
  "leftAt": "2026-07-03T00:30:00.000Z"
}
```
